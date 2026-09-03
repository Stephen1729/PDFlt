import { readFile } from 'fs/promises'
import { PDFDocument } from 'pdf-lib'

export interface ValidationResult {
  valid: boolean
  error?: string
  pageCount?: number
  isEncrypted?: boolean
}

/**
 * Validates a PDF file before processing.
 * Checks: magic bytes, parseable by pdf-lib, not empty, encryption status.
 */
export async function validatePdf(filePath: string): Promise<ValidationResult> {
  let fileBuffer: Buffer

  try {
    fileBuffer = await readFile(filePath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Error al leer el archivo: ${message}` }
  }

  // Check file isn't empty
  if (fileBuffer.length === 0) {
    return { valid: false, error: 'El archivo está vacío.' }
  }

  // Check magic bytes (%PDF)
  const header = fileBuffer.subarray(0, 5).toString('ascii')
  if (!header.startsWith('%PDF')) {
    return {
      valid: false,
      error: 'El archivo no es un PDF válido (cabecera incorrecta).'
    }
  }

  // Try to load with pdf-lib
  try {
    const pdfDoc = await PDFDocument.load(fileBuffer, {
      ignoreEncryption: true
    })

    const pageCount = pdfDoc.getPageCount()
    if (pageCount === 0) {
      return { valid: false, error: 'El PDF no contiene páginas.' }
    }

    // Check if encrypted by trying to load without ignoring encryption
    let isEncrypted = false
    try {
      await PDFDocument.load(fileBuffer, { ignoreEncryption: false })
    } catch {
      isEncrypted = true
    }

    return { valid: true, pageCount, isEncrypted }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('encrypt') || message.includes('password')) {
      return {
        valid: false,
        error: 'El PDF está protegido con contraseña. No se puede procesar.',
        isEncrypted: true
      }
    }
    return { valid: false, error: `No se pudo leer el PDF: ${message}` }
  }
}

/**
 * Validates a PDF output file after processing.
 * Checks that the file is valid and has the expected page count.
 */
export async function validateOutputPdf(
  outputPath: string,
  expectedPageCount: number
): Promise<ValidationResult> {
  const result = await validatePdf(outputPath)

  if (!result.valid) {
    return {
      valid: false,
      error: `El archivo resultante es inválido: ${result.error}`
    }
  }

  if (result.pageCount !== expectedPageCount) {
    return {
      valid: false,
      error: `Error de verificación: se esperaban ${expectedPageCount} páginas pero el resultado tiene ${result.pageCount}.`
    }
  }

  return result
}

