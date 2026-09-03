import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import { IPC_CHANNELS, PdfFileInfo, OperationResult } from '../shared/types'
import { validatePdf } from './pdf/validator'
import { reorderPdfPages } from './pdf/reorder'
import { mergePdfs } from './pdf/merge'
import { extractPages } from './pdf/extract'
import { compressStructural, assembleCompressedPdf } from './pdf/compress'
import { autoUpdater } from 'electron-updater'
import { copyFile } from 'fs/promises'

export function registerIpcHandlers(): void {
  // ── Open file dialog → validate PDF → return info ──
  ipcMain.handle(IPC_CHANNELS.OPEN_PDF, async (): Promise<PdfFileInfo | null> => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      title: 'Seleccionar PDF',
      filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const validation = await validatePdf(filePath)

    if (!validation.valid) {
      dialog.showErrorBox('PDF inválido', validation.error || 'No se pudo leer el archivo.')
      return null
    }

    const fileStats = await stat(filePath)

    return {
      filePath,
      fileName: basename(filePath),
      pageCount: validation.pageCount!,
      fileSizeBytes: fileStats.size,
      isEncrypted: validation.isEncrypted || false
    }
  })

  // ── Read PDF file as ArrayBuffer for renderer thumbnail rendering ──
  ipcMain.handle(IPC_CHANNELS.READ_PDF, async (_event, filePath: string): Promise<ArrayBuffer> => {
    const buffer = await readFile(filePath)
    // Convert Node.js Buffer to ArrayBuffer for IPC transfer
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  // ── Reorder pages → ask save location → process → verify ──
  ipcMain.handle(
    IPC_CHANNELS.REORDER_PAGES,
    async (_event, filePath: string, newOrder: number[], toTemp?: boolean): Promise<OperationResult> => {
      if (toTemp) {
        const tempPath = join(app.getPath('temp'), `reordenado_${Date.now()}.pdf`)
        return reorderPdfPages(filePath, newOrder, tempPath)
      }

      const window = BrowserWindow.getFocusedWindow()
      if (!window) return { success: false, error: 'No hay ventana activa' }

      // Ask where to save
      const saveResult = await dialog.showSaveDialog(window, {
        title: 'Guardar PDF reordenado',
        defaultPath: filePath.replace(/\.pdf$/i, '_reordenado.pdf'),
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'Operación cancelada' }
      }

      return reorderPdfPages(filePath, newOrder, saveResult.filePath)
    }
  )

  // ── Generic save file dialog ──
  ipcMain.handle(
    IPC_CHANNELS.SAVE_DIALOG,
    async (_event, defaultName: string): Promise<string | null> => {
      const window = BrowserWindow.getFocusedWindow()
      if (!window) return null

      const result = await dialog.showSaveDialog(window, {
        title: 'Guardar archivo',
        defaultPath: defaultName,
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
      })

      return result.canceled ? null : result.filePath || null
    }
  )

  // ── Open multiple PDF files ──
  ipcMain.handle(IPC_CHANNELS.OPEN_MULTIPLE_PDFS, async (): Promise<PdfFileInfo[] | null> => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      title: 'Seleccionar PDFs',
      filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filesInfo: PdfFileInfo[] = []
    
    for (const filePath of result.filePaths) {
      const validation = await validatePdf(filePath)

      if (!validation.valid) {
        dialog.showErrorBox('PDF inválido', `El archivo ${basename(filePath)} no se pudo leer.`)
        continue
      }

      const fileStats = await stat(filePath)
      filesInfo.push({
        filePath,
        fileName: basename(filePath),
        pageCount: validation.pageCount!,
        fileSizeBytes: fileStats.size,
        isEncrypted: validation.isEncrypted || false
      })
    }

    return filesInfo.length > 0 ? filesInfo : null
  })

  // ── Process Dropped Files ──
  ipcMain.handle(
    IPC_CHANNELS.PROCESS_DROPPED_FILES,
    async (_event, filePaths: string[]): Promise<PdfFileInfo[]> => {
      const filesInfo: PdfFileInfo[] = []
      
      for (const filePath of filePaths) {
        const validation = await validatePdf(filePath)

        if (!validation.valid) {
          dialog.showErrorBox('PDF inválido', `El archivo ${basename(filePath)} no se pudo leer.`)
          continue
        }

        const fileStats = await stat(filePath)
        filesInfo.push({
          filePath,
          fileName: basename(filePath),
          pageCount: validation.pageCount!,
          fileSizeBytes: fileStats.size,
          isEncrypted: validation.isEncrypted || false
        })
      }

      return filesInfo
    }
  )

  // ── Get Single File Info ──
  ipcMain.handle(
    IPC_CHANNELS.GET_FILE_INFO,
    async (_event, filePath: string): Promise<PdfFileInfo | null> => {
      const validation = await validatePdf(filePath)
      if (!validation.valid) return null

      const fileStats = await stat(filePath)
      return {
        filePath,
        fileName: basename(filePath),
        pageCount: validation.pageCount!,
        fileSizeBytes: fileStats.size,
        isEncrypted: validation.isEncrypted || false
      }
    }
  )

  // ── Merge PDFs ──
  ipcMain.handle(
    IPC_CHANNELS.MERGE_PDFS,
    async (_event, filePaths: string[], toTemp?: boolean): Promise<OperationResult> => {
      if (toTemp) {
        const tempPath = join(app.getPath('temp'), `unido_${Date.now()}.pdf`)
        return mergePdfs(filePaths, tempPath)
      }

      const window = BrowserWindow.getFocusedWindow()
      if (!window) return { success: false, error: 'No hay ventana activa' }

      const saveResult = await dialog.showSaveDialog(window, {
        title: 'Guardar PDF unido',
        defaultPath: 'unido.pdf',
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'Operación cancelada' }
      }

      return mergePdfs(filePaths, saveResult.filePath)
    }
  )

  // ── Extract Pages ──
  ipcMain.handle(
    IPC_CHANNELS.EXTRACT_PAGES,
    async (_event, filePath: string, selectedIndices: number[], toTemp?: boolean): Promise<OperationResult> => {
      const sortedIndices = [...selectedIndices].sort((a, b) => a - b)
      
      if (toTemp) {
        const tempPath = join(app.getPath('temp'), `extraido_${Date.now()}.pdf`)
        return extractPages(filePath, sortedIndices, tempPath)
      }

      const window = BrowserWindow.getFocusedWindow()
      if (!window) return { success: false, error: 'No hay ventana activa' }

      const saveResult = await dialog.showSaveDialog(window, {
        title: 'Guardar PDF extraído',
        defaultPath: filePath.replace(/\.pdf$/i, '_extraido.pdf'),
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'Operación cancelada' }
      }

      return extractPages(filePath, sortedIndices, saveResult.filePath)
    }
  )

  // ── Compress Structural ──
  ipcMain.handle(
    IPC_CHANNELS.COMPRESS_STRUCTURAL,
    async (_event, filePath: string, toTemp?: boolean): Promise<OperationResult> => {
      return compressStructural(filePath, toTemp)
    }
  )

  // ── Assemble Compressed PDF ──
  ipcMain.handle(
    IPC_CHANNELS.ASSEMBLE_COMPRESSED_PDF,
    async (_event, imagesBase64: string[], dimensions: any[], toTemp?: boolean): Promise<OperationResult> => {
      return assembleCompressedPdf(imagesBase64, dimensions, toTemp)
    }
  )

  // ── Copy File (from temp to user destination) ──
  ipcMain.handle(
    IPC_CHANNELS.COPY_FILE,
    async (_event, source: string, destination: string): Promise<boolean> => {
      try {
        const { copyFile } = require('fs/promises')
        await copyFile(source, destination)
        return true
      } catch (err) {
        console.error('Error copying file:', err)
        return false
      }
    }
  )
  // ── Updater Handlers ──
  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => {
    return app.getVersion()
  })

  // Disable auto-download so the user controls when to download
  autoUpdater.autoDownload = false

  // Pipe updater events to the renderer
  const sendUpdateEvent = (event: string, data?: any) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      windows[0].webContents.send(IPC_CHANNELS.UPDATE_EVENT, { type: event, data })
    }
  }

  autoUpdater.on('checking-for-update', () => sendUpdateEvent('checking'))
  autoUpdater.on('update-available', (info) => sendUpdateEvent('available', info))
  autoUpdater.on('update-not-available', (info) => sendUpdateEvent('not-available', info))
  autoUpdater.on('error', (err) => sendUpdateEvent('error', err.message))
  autoUpdater.on('download-progress', (progressObj) => sendUpdateEvent('progress', progressObj))
  autoUpdater.on('update-downloaded', (info) => sendUpdateEvent('downloaded', info))

  ipcMain.handle(IPC_CHANNELS.CHECK_UPDATES, async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (error: any) {
      sendUpdateEvent('error', error.message)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_UPDATE, async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (error: any) {
      sendUpdateEvent('error', error.message)
    }
  })

  ipcMain.handle(IPC_CHANNELS.INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall(false, true)
  })
}
