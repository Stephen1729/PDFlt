export interface PdfFileInfo {
  filePath: string
  fileName: string
  pageCount: number
  fileSizeBytes: number
  isEncrypted: boolean
}

export interface OperationResult {
  success: boolean
  outputPath?: string
  error?: string
  pageCount?: number
  originalSize?: number
  compressedSize?: number
}

export interface PageDimension {
  width: number
  height: number
}

export type CompressionLevel = 'extreme' | 'recommended' | 'basic'
