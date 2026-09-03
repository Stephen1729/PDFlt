import { PDFDocument } from 'pdf-lib'
import { readFile, writeFile } from 'fs/promises'
import { OperationResult } from '../../shared/types'

export async function extractPages(
  filePath: string,
  selectedIndices: number[],
  outputPath: string
): Promise<OperationResult> {
  try {
    if (!selectedIndices || selectedIndices.length === 0) {
      return { success: false, error: 'No pages selected for extraction' }
    }

    const pdfBytes = await readFile(filePath)
    const originalPdf = await PDFDocument.load(pdfBytes)

    const newPdf = await PDFDocument.create()
    const copiedPages = await newPdf.copyPages(originalPdf, selectedIndices)

    for (const page of copiedPages) {
      newPdf.addPage(page)
    }

    const newPdfBytes = await newPdf.save()
    await writeFile(outputPath, newPdfBytes)

    return {
      success: true,
      outputPath,
      pageCount: newPdf.getPageCount()
    }
  } catch (error: any) {
    console.error('Error extracting pages:', error)
    return {
      success: false,
      error: error.message || 'Unknown error occurred while extracting pages'
    }
  }
}

