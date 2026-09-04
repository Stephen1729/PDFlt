import { FilePicker } from '@capawesome/capacitor-file-picker'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { PDFDocument } from 'pdf-lib'
import type { PdfFileInfo, OperationResult, PageDimension } from '../../../shared/types'

// Utilities for generating random temporary names
const generateTempName = () => `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`

// Store file data in memory for fast access (path -> base64)
const fileCache = new Map<string, string>()

export const pdfService = {
  async openPdfDialog(): Promise<PdfFileInfo | null> {
    try {
      const result = await FilePicker.pickFiles({
        types: ['application/pdf'],
        multiple: false,
        readData: true
      })
      if (!result.files || result.files.length === 0) return null
      
      const file = result.files[0]
      const b64 = file.data
      if (!b64) return null
      
      const doc = await PDFDocument.load(b64, { ignoreEncryption: true })
      const filePath = file.path || file.name
      fileCache.set(filePath, b64)

      return {
        filePath,
        fileName: file.name,
        pageCount: doc.getPageCount(),
        fileSizeBytes: file.size || (b64.length * 0.75),
        isEncrypted: doc.isEncrypted
      }
    } catch (e) {
      console.error(e)
      return null
    }
  },

  async openMultiplePdfDialog(): Promise<PdfFileInfo[] | null> {
    try {
      const result = await FilePicker.pickFiles({
        types: ['application/pdf'],
        multiple: true,
        readData: true
      })
      if (!result.files || result.files.length === 0) return null
      
      const infos: PdfFileInfo[] = []
      for (const file of result.files) {
        const b64 = file.data
        if (!b64) continue
        const doc = await PDFDocument.load(b64, { ignoreEncryption: true })
        const filePath = file.path || file.name
        fileCache.set(filePath, b64)
        
        infos.push({
          filePath,
          fileName: file.name,
          pageCount: doc.getPageCount(),
          fileSizeBytes: file.size || (b64.length * 0.75),
          isEncrypted: doc.isEncrypted
        })
      }
      return infos
    } catch (e) {
      console.error(e)
      return null
    }
  },

  getFilePath(file: File): string {
    return file.name
  },

  async processDroppedFiles(files: File[]): Promise<PdfFileInfo[]> {
    const infos: PdfFileInfo[] = []
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) continue
      
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1])
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      
      const doc = await PDFDocument.load(b64, { ignoreEncryption: true })
      fileCache.set(file.name, b64)
      
      infos.push({
        filePath: file.name,
        fileName: file.name,
        pageCount: doc.getPageCount(),
        fileSizeBytes: file.size,
        isEncrypted: doc.isEncrypted
      })
    }
    return infos
  },

  async getFileInfo(filePath: string): Promise<PdfFileInfo | null> {
    // If it's in cache
    const b64 = fileCache.get(filePath)
    if (!b64) return null
    const doc = await PDFDocument.load(b64, { ignoreEncryption: true })
    return {
      filePath,
      fileName: filePath.split('/').pop() || 'document.pdf',
      pageCount: doc.getPageCount(),
      fileSizeBytes: b64.length * 0.75,
      isEncrypted: doc.isEncrypted
    }
  },

  async readPdfFileBase64(filePath: string): Promise<string> {
    return fileCache.get(filePath) || ''
  },

  async readPdfFile(filePath: string): Promise<ArrayBuffer> {
    const b64 = fileCache.get(filePath)
    if (!b64) throw new Error('File not found in cache')
    // Fast base64 to ArrayBuffer conversion using fetch
    const response = await fetch(`data:application/pdf;base64,${b64}`)
    return await response.arrayBuffer()
  },

  async mergePdfs(filePaths: string[], toTemp?: boolean): Promise<OperationResult> {
    try {
      const mergedPdf = await PDFDocument.create()
      
      for (const path of filePaths) {
        const b64 = fileCache.get(path)
        if (!b64) throw new Error(`Missing file data for ${path}`)
        const pdfDoc = await PDFDocument.load(b64)
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices())
        copiedPages.forEach(p => mergedPdf.addPage(p))
      }
      
      const b64Result = await mergedPdf.saveAsBase64()
      return await saveResult(b64Result, 'merged.pdf', toTemp, mergedPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async reorderPages(filePath: string, newOrder: number[], toTemp?: boolean): Promise<OperationResult> {
    try {
      const b64 = fileCache.get(filePath)
      if (!b64) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(b64)
      const newPdf = await PDFDocument.create()
      
      const copiedPages = await newPdf.copyPages(sourcePdf, newOrder)
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const b64Result = await newPdf.saveAsBase64()
      return await saveResult(b64Result, 'reordered.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async extractPages(filePath: string, selectedIndices: number[], toTemp?: boolean): Promise<OperationResult> {
    try {
      const b64 = fileCache.get(filePath)
      if (!b64) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(b64)
      const newPdf = await PDFDocument.create()
      
      const copiedPages = await newPdf.copyPages(sourcePdf, selectedIndices)
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const b64Result = await newPdf.saveAsBase64()
      return await saveResult(b64Result, 'split.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async compressStructural(filePath: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const b64 = fileCache.get(filePath)
      if (!b64) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(b64)
      const newPdf = await PDFDocument.create()
      
      // Basic structural compression
      const copiedPages = await newPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const b64Result = await newPdf.saveAsBase64({ useObjectStreams: true })
      return await saveResult(b64Result, 'compressed.pdf', toTemp, newPdf.getPageCount(), b64.length * 0.75)
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async assembleCompressedPdf(imagesBase64: string[], dimensions: PageDimension[], toTemp?: boolean): Promise<OperationResult> {
    try {
      const newPdf = await PDFDocument.create()
      
      for (let i = 0; i < imagesBase64.length; i++) {
        const b64 = imagesBase64[i]
        const dim = dimensions[i]
        
        // Strip the data:image/jpeg;base64, prefix if present
        const b64Data = b64.includes(',') ? b64.split(',')[1] : b64
        const img = await newPdf.embedJpg(b64Data)
        
        const page = newPdf.addPage([dim.width, dim.height])
        page.drawImage(img, {
          x: 0,
          y: 0,
          width: dim.width,
          height: dim.height
        })
      }
      
      const b64Result = await newPdf.saveAsBase64({ useObjectStreams: true })
      return await saveResult(b64Result, 'compressed.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },
  
  async saveFileDialog(defaultName: string): Promise<string | null> {
    return defaultName
  },
  
  async copyFile(sourcePath: string, destinationPath: string): Promise<boolean> {
    // We already have the file in cache, just save it using Filesystem!
    try {
      const b64 = fileCache.get(sourcePath)
      if (!b64) return false
      
      await Filesystem.writeFile({
        path: destinationPath,
        data: b64,
        directory: Directory.Documents
      })
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  }
}

async function saveResult(b64: string, defaultName: string, toTemp?: boolean, pageCount?: number, originalSize?: number): Promise<OperationResult> {
  const fileName = toTemp ? generateTempName() : `PDFlt_${defaultName}`
  
  if (toTemp) {
    // Save to cache instead of filesystem
    fileCache.set(fileName, b64)
    return { success: true, outputPath: fileName, pageCount }
  }

  // Save via Capacitor Filesystem
  try {
    await Filesystem.writeFile({
      path: fileName,
      data: b64,
      directory: Directory.Documents // Saves to Documents folder
    })
    
    return {
      success: true,
      outputPath: fileName,
      pageCount,
      originalSize,
      compressedSize: b64.length * 0.75
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
