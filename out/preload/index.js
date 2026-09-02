"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  OPEN_PDF: "pdf:open-file",
  OPEN_MULTIPLE_PDFS: "pdf:open-multiple-files",
  PROCESS_DROPPED_FILES: "pdf:process-dropped-files",
  READ_PDF: "pdf:read-file",
  REORDER_PAGES: "pdf:reorder-pages",
  MERGE_PDFS: "pdf:merge-pdfs",
  EXTRACT_PAGES: "pdf:extract-pages",
  SAVE_DIALOG: "dialog:save-file"
};
const electronAPI = {
  getFilePath: (file) => electron.webUtils.getPathForFile(file),
  openPdfDialog: () => electron.ipcRenderer.invoke(IPC_CHANNELS.OPEN_PDF),
  openMultiplePdfDialog: () => electron.ipcRenderer.invoke(IPC_CHANNELS.OPEN_MULTIPLE_PDFS),
  processDroppedFiles: (paths) => electron.ipcRenderer.invoke(IPC_CHANNELS.PROCESS_DROPPED_FILES, paths),
  readPdfFile: (filePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.READ_PDF, filePath),
  reorderPages: (filePath, newOrder) => electron.ipcRenderer.invoke(IPC_CHANNELS.REORDER_PAGES, filePath, newOrder),
  mergePdfs: (filePaths) => electron.ipcRenderer.invoke(IPC_CHANNELS.MERGE_PDFS, filePaths),
  extractPages: (filePath, selectedIndices) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_PAGES, filePath, selectedIndices),
  saveFileDialog: (defaultName) => electron.ipcRenderer.invoke(IPC_CHANNELS.SAVE_DIALOG, defaultName)
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
