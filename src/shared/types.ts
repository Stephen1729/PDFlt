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
}

export const IPC_CHANNELS = {
  OPEN_PDF: 'pdf:open-file',
  OPEN_MULTIPLE_PDFS: 'pdf:open-multiple-files',
  PROCESS_DROPPED_FILES: 'pdf:process-dropped-files',
  GET_FILE_INFO: 'pdf:get-file-info',
  READ_PDF: 'pdf:read-file',
  REORDER_PAGES: 'pdf:reorder-pages',
  MERGE_PDFS: 'pdf:merge-pdfs',
  EXTRACT_PAGES: 'pdf:extract-pages',
  SAVE_DIALOG: 'dialog:save-file'
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
  saveFileDialog: (defaultName: string) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

