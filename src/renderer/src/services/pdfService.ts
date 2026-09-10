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
        limit: 1,
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
        limit: 0,
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
    
    const binaryString = window.atob(b64)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  },

  async mergePdfs(filePaths: string[], customName?: string, toTemp?: boolean): Promise<OperationResult> {
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
      return await saveResult(b64Result, customName || 'PDFlt_unido.pdf', toTemp, mergedPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async reorderPages(filePath: string, newOrder: number[], customName?: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const b64 = fileCache.get(filePath)
      if (!b64) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(b64)
      const newPdf = await PDFDocument.create()
      
      const copiedPages = await newPdf.copyPages(sourcePdf, newOrder)
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const b64Result = await newPdf.saveAsBase64()
      return await saveResult(b64Result, customName || 'PDFlt_reordenado.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async extractPages(filePath: string, selectedIndices: number[], customName?: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const b64 = fileCache.get(filePath)
      if (!b64) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(b64)
      const newPdf = await PDFDocument.create()
      
      const copiedPages = await newPdf.copyPages(sourcePdf, selectedIndices)
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const b64Result = await newPdf.saveAsBase64()
      return await saveResult(b64Result, customName || 'PDFlt_extraido.pdf', toTemp, newPdf.getPageCount())
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
      return await saveResult(b64Result, 'PDFlt_comprimido.pdf', toTemp, newPdf.getPageCount(), b64.length * 0.75)
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
      return await saveResult(b64Result, 'PDFlt_comprimido.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },
  
  async saveFileDialog(
    defaultName: string,
    title = 'Guardar PDF',
    fileSize?: string,
    currentView?: ChainViewTarget
  ): Promise<string | null> {
    return await promptSaveFileName(defaultName, title, fileSize, currentView)
  },

  async promptSaveDialog(options: SaveModalOptions): Promise<SaveModalResult> {
    return await promptSaveDialog(options)
  },
  
  async createPdfFromImages(
    imagesBase64: string[],
    customName?: string,
    toTemp?: boolean,
    options?: { fitToImage?: boolean }
  ): Promise<OperationResult> {
    try {
      const newPdf = await PDFDocument.create()
      const fitToImage = options?.fitToImage ?? true
      
      for (const b64 of imagesBase64) {
        const b64Data = b64.includes(',') ? b64.split(',')[1] : b64
        
        let img
        if (b64.startsWith('data:image/png') || b64Data.startsWith('iVBORw0KGgo')) {
          try {
            img = await newPdf.embedPng(b64Data)
          } catch {
            img = await newPdf.embedJpg(b64Data)
          }
        } else {
          try {
            img = await newPdf.embedJpg(b64Data)
          } catch {
            img = await newPdf.embedPng(b64Data)
          }
        }
        
        if (fitToImage) {
          // Normalize to standard document dimensions (A4 reference: 595.28 pt portrait, 841.89 pt landscape)
          // Preserves exact aspect ratio, eliminates white margins, and ensures uniform sizing across pages
          const isLandscape = img.width > img.height
          const baseWidth = isLandscape ? 841.89 : 595.28
          const scale = baseWidth / img.width
          const pageWidth = baseWidth
          const pageHeight = Math.round(img.height * scale * 100) / 100

          const page = newPdf.addPage([pageWidth, pageHeight])
          page.drawImage(img, {
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight
          })
        } else {
          // Standard A4 dimensions in points with margin
          const A4_WIDTH = 595.28
          const A4_HEIGHT = 841.89
          
          const isLandscape = img.width > img.height
          const pageWidth = isLandscape ? A4_HEIGHT : A4_WIDTH
          const pageHeight = isLandscape ? A4_WIDTH : A4_HEIGHT
          
          const page = newPdf.addPage([pageWidth, pageHeight])
          
          const margin = 20
          const availWidth = pageWidth - margin * 2
          const availHeight = pageHeight - margin * 2
          
          const scale = Math.min(availWidth / img.width, availHeight / img.height)
          const imgWidth = img.width * scale
          const imgHeight = img.height * scale
          
          const x = (pageWidth - imgWidth) / 2
          const y = (pageHeight - imgHeight) / 2
          
          page.drawImage(img, {
            x,
            y,
            width: imgWidth,
            height: imgHeight
          })
        }
      }
      
      const b64Result = await newPdf.saveAsBase64({ useObjectStreams: true })
      return await saveResult(b64Result, customName || 'PDFlt_escaneo.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

    async copyFile(sourcePath: string, destinationPath: string): Promise<boolean> {
    try {
      let b64 = fileCache.get(sourcePath)
      if (!b64) {
        try {
          const res = await Filesystem.readFile({ path: sourcePath, directory: Directory.Documents })
          b64 = typeof res.data === 'string' ? res.data : ''
        } catch {
          // not found in filesystem
        }
      }
      if (!b64) return false
      
      const fileName = destinationPath.toLowerCase().endsWith('.pdf') ? destinationPath : `${destinationPath}.pdf`

      try {
        await Filesystem.writeFile({
          path: fileName,
          data: b64,
          directory: Directory.Documents
        })
        fileCache.set(fileName, b64)
        return true
      } catch (fsErr) {
        // Fallback for browser preview download
        const a = document.createElement('a')
        a.href = `data:application/pdf;base64,${b64}`
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        fileCache.set(fileName, b64)
        return true
      }
    } catch (e) {
      console.error(e)
      return false
    }
  }
}

export type ChainViewTarget = 'scan' | 'compress' | 'merge' | 'split' | 'reorder'

export interface SaveModalOptions {
  defaultName: string
  title?: string
  fileSize?: string
  currentView?: ChainViewTarget
}

export type SaveModalResult =
  | { action: 'save'; fileName: string }
  | { action: 'chain'; targetView: ChainViewTarget }
  | null

export function formatFileSize(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

interface ChainButtonDef {
  id: ChainViewTarget
  label: string
  icon: string
}

const ALL_CHAIN_BUTTONS: ChainButtonDef[] = [
  {
    id: 'compress',
    label: 'Comprimir',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.29 7 12 12 20.71 7"></polyline><line x1="12" y1="22" x2="12" y2="12"></line></svg>`
  },
  {
    id: 'merge',
    label: 'Unir',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`
  },
  {
    id: 'split',
    label: 'Separar',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>`
  },
  {
    id: 'reorder',
    label: 'Reordenar',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`
  }
]

export function promptSaveDialog(options: SaveModalOptions): Promise<SaveModalResult> {
  return new Promise((resolve) => {
    const { defaultName, title = 'Guardar PDF', fileSize, currentView } = options
    const initialBase = defaultName.replace(/\.pdf$/i, '').trim() || 'documento'

    // Filter chain actions: exclude the current tool and tools not applicable
    const chainButtons = ALL_CHAIN_BUTTONS.filter((btn) => {
      if (btn.id === currentView) return false
      // For scanner, reorder is already available on Stage 2 grid
      if (currentView === 'scan' && btn.id === 'reorder') return false
      return true
    })

    const overlay = document.createElement('div')
    overlay.className = 'save-modal-overlay'
    overlay.innerHTML = `
      <div class="save-modal-card">
        <div class="save-modal-header">
          <h3>${title}</h3>
          <button class="save-modal-close btn-icon" title="Cerrar" style="width: 32px; height: 32px; padding: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="save-modal-body">
          ${
            fileSize
              ? `
            <div class="save-modal-size-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span>Tamaño del archivo: <strong>${fileSize}</strong></span>
            </div>
          `
              : ''
          }

          <label for="save-filename-input">Nombre del archivo:</label>
          <div class="save-modal-input-group">
            <input type="text" id="save-filename-input" value="${initialBase}" autocomplete="off" autocapitalize="none" spellcheck="false" />
            <span class="save-modal-ext">.pdf</span>
          </div>

          ${
            chainButtons.length > 0
              ? `
            <div class="save-modal-chain-section">
              <div class="save-modal-chain-title">o continuar editando en:</div>
              <div class="save-modal-chain-buttons">
                ${chainButtons
                  .map(
                    (btn) => `
                  <button type="button" class="save-modal-chain-btn" data-target="${btn.id}">
                    ${btn.icon}
                    <span>${btn.label}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>
        <div class="save-modal-footer">
          <button id="save-modal-cancel" class="btn-secondary">Cancelar</button>
          <button id="save-modal-confirm" class="btn-primary">Guardar</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    const input = overlay.querySelector('#save-filename-input') as HTMLInputElement
    const confirmBtn = overlay.querySelector('#save-modal-confirm') as HTMLButtonElement
    const cancelBtn = overlay.querySelector('#save-modal-cancel') as HTMLButtonElement
    const closeBtn = overlay.querySelector('.save-modal-close') as HTMLButtonElement

    let isClosed = false
    const close = (result: SaveModalResult) => {
      if (isClosed) return
      isClosed = true
      overlay.remove()
      resolve(result)
    }

    const confirm = () => {
      let val = input.value.trim()
      val = val.replace(/[\\/:*?"<>|]/g, '').trim()
      val = val.replace(/\.pdf$/i, '').trim()
      if (!val) val = initialBase
      close({ action: 'save', fileName: `${val}.pdf` })
    }

    confirmBtn.addEventListener('click', confirm)
    cancelBtn.addEventListener('click', () => close(null))
    closeBtn.addEventListener('click', () => close(null))

    overlay.querySelectorAll('.save-modal-chain-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const target = (btn as HTMLElement).dataset.target as ChainViewTarget
        if (target) {
          close({ action: 'chain', targetView: target })
        }
      })
    })

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      }
    })

    setTimeout(() => {
      input.focus()
      input.select()
    }, 50)
  })
}

export async function promptSaveFileName(
  defaultName: string,
  title = 'Guardar PDF',
  fileSize?: string,
  currentView?: ChainViewTarget
): Promise<string | null> {
  const result = await promptSaveDialog({ defaultName, title, fileSize, currentView })
  return result?.action === 'save' ? result.fileName : null
}

async function saveResult(
  b64: string,
  defaultName: string,
  toTemp?: boolean,
  pageCount?: number,
  originalSize?: number
): Promise<OperationResult> {
  const fileName = toTemp
    ? generateTempName()
    : defaultName.toLowerCase().endsWith('.pdf')
      ? defaultName
      : `${defaultName}.pdf`
  
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
    
    fileCache.set(fileName, b64)
    return {
      success: true,
      outputPath: fileName,
      pageCount,
      originalSize,
      compressedSize: b64.length * 0.75
    }
  } catch (e: any) {
    // Fallback for browser preview (npm run dev)
    try {
      const a = document.createElement('a')
      a.href = `data:application/pdf;base64,${b64}`
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      fileCache.set(fileName, b64)
      return {
        success: true,
        outputPath: fileName,
        pageCount,
        originalSize,
        compressedSize: b64.length * 0.75
      }
    } catch {
      return { success: false, error: e.message }
    }
  }
}
