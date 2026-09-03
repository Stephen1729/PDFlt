// Shared type definitions for IPC communication between main/preload/renderer

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

export const IPC_CHANNELS = {
  OPEN_PDF: 'pdf:open-file',
  OPEN_MULTIPLE_PDFS: 'pdf:open-multiple-files',
  PROCESS_DROPPED_FILES: 'pdf:process-dropped-files',
  GET_FILE_INFO: 'pdf:get-file-info',
  READ_PDF: 'pdf:read-file',
  REORDER_PAGES: 'pdf:reorder-pages',
  MERGE_PDFS: 'pdf:merge-pdfs',
  EXTRACT_PAGES: 'pdf:extract-pages',
  COMPRESS_STRUCTURAL: 'pdf:compress-structural',
  ASSEMBLE_COMPRESSED_PDF: 'pdf:assemble-compressed',
  COPY_FILE: 'pdf:copy-file',
  SAVE_DIALOG: 'dialog:save-file',
  GET_APP_VERSION: 'app:get-version',
  CHECK_UPDATES: 'app:check-updates',
  DOWNLOAD_UPDATE: 'app:download-update',
  INSTALL_UPDATE: 'app:install-update',
  UPDATE_EVENT: 'app:update-event'
} as const

export interface ElectronAPI {
  getFilePath: (file: File) => string
  openPdfDialog: () => Promise<PdfFileInfo | null>
  openMultiplePdfDialog: () => Promise<PdfFileInfo[] | null>
  processDroppedFiles: (paths: string[]) => Promise<PdfFileInfo[]>
  getFileInfo: (filePath: string) => Promise<PdfFileInfo | null>
  readPdfFile: (filePath: string) => Promise<ArrayBuffer>
  reorderPages: (filePath: string, newOrder: number[], toTemp?: boolean) => Promise<OperationResult>
  mergePdfs: (filePaths: string[], toTemp?: boolean) => Promise<OperationResult>
  extractPages: (filePath: string, selectedIndices: number[], toTemp?: boolean) => Promise<OperationResult>
  compressStructural: (filePath: string, toTemp?: boolean) => Promise<OperationResult>
  assembleCompressedPdf: (imagesBase64: string[], dimensions: PageDimension[], toTemp?: boolean) => Promise<OperationResult>
  copyFile: (source: string, destination: string) => Promise<boolean>
  saveFileDialog: (defaultName: string) => Promise<string | null>
  
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateEvent: (callback: (event: any) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

