import { app, BrowserWindow, shell, Menu } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'PDFToolkit',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Remove default menu bar (cleaner look)
  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in system browser, not in the app
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In dev, load from Vite dev server; in prod, load the built file
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

