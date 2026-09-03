import { PDFDocument } from 'pdf-lib'
import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { OperationResult, PageDimension } from '../../shared/types'

/**
 * Saves a Uint8Array to the final destination (either a temp file or via user dialog).
 */
async function saveToDestination(
  pdfBytes: Uint8Array,
  pageCount: number,
  originalSize: number,
  toTemp?: boolean,
  suggestedName: string = 'comprimido.pdf'
): Promise<OperationResult> {
  const compressedSize = pdfBytes.length

  if (toTemp) {
    const tempName = `chain_compress_${Date.now()}.pdf`
    const tempPath = path.join(app.getPath('temp'), tempName)
    await fs.promises.writeFile(tempPath, pdfBytes)
    return {
      success: true,
      outputPath: tempPath,
      pageCount,
      originalSize,
      compressedSize
    }
  }

  const { filePath: savePath, canceled } = await dialog.showSaveDialog({
    title: 'Guardar PDF comprimido',
    defaultPath: suggestedName,
    filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
  })

  if (canceled || !savePath) {
    return { success: false, error: 'Operación cancelada' }
  }

  await fs.promises.writeFile(savePath, pdfBytes)
  return {
    success: true,
    outputPath: savePath,
    pageCount,
    originalSize,
    compressedSize
  }
}

/**
 * Structural compression: Cleans up unreferenced objects, orphan streams,
 * and saves with useObjectStreams: true. Preserves vector text 100%.
 */
export async function compressStructural(filePath: string, toTemp?: boolean): Promise<OperationResult> {
  try {
    const fileBuffer = await fs.promises.readFile(filePath)
    const originalSize = fileBuffer.length
    const originalName = path.basename(filePath, '.pdf')
    
    // Load without updating metadata to drop incremental history
    const srcDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false })
    const pageCount = srcDoc.getPageCount()
    
    // Copy to a fresh document to purge orphan objects
    const newDoc = await PDFDocument.create()
    const copiedPages = await newDoc.copyPages(srcDoc, srcDoc.getPageIndices())
    copiedPages.forEach((page) => newDoc.addPage(page))

    // Save with compression
    const pdfBytes = await newDoc.save({ useObjectStreams: true })
    
    return saveToDestination(pdfBytes, pageCount, originalSize, toTemp, `${originalName}-ligero.pdf`)
  } catch (error) {
    console.error('Error in compressStructural:', error)
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Assembles a new PDF from compressed JPEG base64 strings provided by the renderer canvas.
 * Preserves the exact physical page dimensions of the original document.
 */
export async function assembleCompressedPdf(
  imagesBase64: string[],
  dimensions: PageDimension[],
  toTemp?: boolean
): Promise<OperationResult> {
  try {
    let originalSize = 0 // Handled in renderer size comparison
    const newDoc = await PDFDocument.create()

    for (let i = 0; i < imagesBase64.length; i++) {
      const base64Data = imagesBase64[i].replace(/^data:image\/jpeg;base64,/, "")
      const imgBuffer = Buffer.from(base64Data, 'base64')
      
      const jpgImage = await newDoc.embedJpg(imgBuffer)
      const dim = dimensions[i]
      
      // Add page with original physical dimensions
      const page = newDoc.addPage([dim.width, dim.height])
      
      // Draw image scaled to fit the original physical dimension exactly
      page.drawImage(jpgImage, {
        x: 0,
        y: 0,
        width: dim.width,
        height: dim.height
      })
    }

    const pdfBytes = await newDoc.save({ useObjectStreams: true })
    const pageCount = imagesBase64.length

    return saveToDestination(pdfBytes, pageCount, originalSize, toTemp, 'pdf-comprimido.pdf')
  } catch (error) {
    console.error('Error in assembleCompressedPdf:', error)
    return { success: false, error: (error as Error).message }
  }
}

