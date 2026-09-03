import { readFile, writeFile } from 'fs/promises'
import { PDFDocument } from 'pdf-lib'
import { OperationResult } from '../../shared/types'
import { validatePdf, validateOutputPdf } from './validator'

/**
 * Reorders pages of a PDF file.
 *
 * NEVER modifies the original file. Creates a brand new PDF with pages
 * copied in the specified order, then validates the output.
 *
 * @param inputPath  - Path to the source PDF (read only)
 * @param newOrder   - Array of 0-based page indices in desired order
 * @param outputPath - Where to save the reordered PDF
 */
export async function reorderPdfPages(
  inputPath: string,
  newOrder: number[],
  outputPath: string
): Promise<OperationResult> {
  try {
    // ── Step 1: Validate input ──
    const inputValidation = await validatePdf(inputPath)
    if (!inputValidation.valid) {
      return { success: false, error: inputValidation.error }
    }

    // ── Step 2: Load source PDF ──
    const sourceBytes = await readFile(inputPath)
    const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
    const totalPages = sourcePdf.getPageCount()

    // ── Step 3: Validate the order array ──
    if (newOrder.length !== totalPages) {
      return {
        success: false,
        error: `El orden tiene ${newOrder.length} elementos pero el PDF tiene ${totalPages} páginas.`
      }
    }

    const seen = new Set<number>()
    for (const index of newOrder) {
      if (index < 0 || index >= totalPages) {
        return {
          success: false,
          error: `Índice de página inválido: ${index}. Rango válido: 0–${totalPages - 1}.`
        }
      }
      if (seen.has(index)) {
        return {
          success: false,
          error: `Índice duplicado: ${index}. Cada página debe aparecer exactamente una vez.`
        }
      }
      seen.add(index)
    }

    // ── Step 4: Create new PDF with reordered pages ──
    const newPdf = await PDFDocument.create()
    const copiedPages = await newPdf.copyPages(sourcePdf, newOrder)

    for (const page of copiedPages) {
      newPdf.addPage(page)
    }

    // ── Step 5: Save ──
    const newPdfBytes = await newPdf.save()
    await writeFile(outputPath, newPdfBytes)

    // ── Step 6: Verify output ──
    const outputValidation = await validateOutputPdf(outputPath, totalPages)
    if (!outputValidation.valid) {
      return { success: false, error: outputValidation.error }
    }

    return {
      success: true,
      outputPath,
      pageCount: totalPages
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Error al reordenar: ${message}` }
  }
}

