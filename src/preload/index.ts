import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, ElectronAPI } from '../shared/types'

/**
 * Secure bridge between renderer and main process.
 * Exposes only typed, specific functions — no raw IPC access.
 */
const electronAPI: ElectronAPI = {
  getFilePath: (file: File) => webUtils.getPathForFile(file),

  openPdfDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_PDF),

  openMultiplePdfDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_MULTIPLE_PDFS),

  processDroppedFiles: (paths: string[]) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_DROPPED_FILES, paths),

  getFileInfo: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_FILE_INFO, filePath),

  readPdfFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.READ_PDF, filePath),

  reorderPages: (filePath: string, newOrder: number[], toTemp?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.REORDER_PAGES, filePath, newOrder, toTemp),

  mergePdfs: (filePaths: string[], toTemp?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.MERGE_PDFS, filePaths, toTemp),

  extractPages: (filePath: string, selectedIndices: number[], toTemp?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_PAGES, filePath, selectedIndices, toTemp),

  saveFileDialog: (defaultName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_DIALOG, defaultName)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

