import { PDFDocument } from 'pdf-lib'
import { readFile, writeFile } from 'fs/promises'
import { OperationResult } from '../../shared/types'

export async function mergePdfs(filePaths: string[], outputPath: string): Promise<OperationResult> {
  try {
    if (!filePaths || filePaths.length === 0) {
      return { success: false, error: 'No files provided for merging' }
    }

    // Create a new blank PDF
    const mergedPdf = await PDFDocument.create()
    
    // Copy pages from each input PDF
    for (const filePath of filePaths) {
      const pdfBytes = await readFile(filePath)
      const pdfDoc = await PDFDocument.load(pdfBytes)
      const pageIndices = pdfDoc.getPageIndices()
      
      const copiedPages = await mergedPdf.copyPages(pdfDoc, pageIndices)
      
      for (const page of copiedPages) {
        mergedPdf.addPage(page)
      }
    }
    
    const mergedPdfBytes = await mergedPdf.save()
    await writeFile(outputPath, mergedPdfBytes)
    
    return {
      success: true,
      outputPath,
      pageCount: mergedPdf.getPageCount()
    }
  } catch (error: any) {
    console.error('Error merging PDFs:', error)
    return {
      success: false,
      error: error.message || 'Unknown error occurred while merging PDFs'
    }
  }
}

