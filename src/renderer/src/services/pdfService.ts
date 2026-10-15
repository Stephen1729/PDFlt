import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Capacitor } from '@capacitor/core'
import { PDFDocument } from 'pdf-lib'
import type { PdfFileInfo, OperationResult, PageDimension } from '../../../shared/types'
import { openNativePdf } from './nativePdfService'

// Utilities for generating random temporary names
const generateTempName = () => `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`

// Store file data in memory as binary Uint8Array for maximum speed & 1/4 RAM footprint
const fileCache = new Map<string, Uint8Array>()

/**
 * Fast chunked Base64 conversion for writing to Filesystem when binary bridge is unavailable
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  const chunkSize = 8192
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)) as any)
  }
  return btoa(binary)
}

/**
 * Fast Base64 decoding into Uint8Array
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const cleanB64 = b64.includes(',') ? b64.split(',')[1] : b64
  const binary = atob(cleanB64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Reads binary bytes from a PickedFile without passing Base64 strings through the Capacitor plugin bridge
 */
async function loadPickedFileBytes(file: PickedFile): Promise<Uint8Array | null> {
  // 1. Web file.blob (Native ArrayBuffer in browser / desktop preview)
  if (file.blob) {
    try {
      const buffer = await file.blob.arrayBuffer()
      return new Uint8Array(buffer)
    } catch (blobErr) {
      console.warn('file.blob.arrayBuffer failed:', blobErr)
    }
  }

  // 2. Android native file.path via convertFileSrc + fetch (Direct binary asset stream)
  if (file.path) {
    try {
      const convertedSrc = Capacitor.convertFileSrc(file.path)
      const res = await fetch(convertedSrc)
      if (res.ok) {
        const buffer = await res.arrayBuffer()
        return new Uint8Array(buffer)
      }
    } catch (fetchErr) {
      console.warn('convertFileSrc fetch failed, trying Filesystem fallback:', fetchErr)
    }

    // Fallback: Filesystem.readFile
    try {
      const fsRes = await Filesystem.readFile({ path: file.path })
      if (typeof fsRes.data === 'string') {
        return base64ToUint8Array(fsRes.data)
      }
    } catch (fsErr) {
      console.warn('Filesystem.readFile fallback failed:', fsErr)
    }
  }

  // 3. Fallback if file.data was provided
  if (file.data) {
    return base64ToUint8Array(file.data)
  }

  return null
}

export const pdfService = {
  async openPdfDialog(): Promise<PdfFileInfo | null> {
    try {
      const result = await FilePicker.pickFiles({
        types: ['application/pdf'],
        limit: 1,
        readData: false
      })
      if (!result.files || result.files.length === 0) return null
      
      const file = result.files[0]
      const bytes = await loadPickedFileBytes(file)
      if (!bytes) return null
      
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const filePath = file.path || file.name
      fileCache.set(filePath, bytes)

      return {
        filePath,
        fileName: file.name,
        pageCount: doc.getPageCount(),
        fileSizeBytes: file.size || bytes.byteLength,
        isEncrypted: doc.isEncrypted
      }
    } catch (e) {
      console.error(e)
      return null
    }
  },

  async openMultiplePdfDialog(): Promise<PdfFileInfo[] | null> {
    try {
      const result = await FilePicker.pickFiles({
        types: ['application/pdf'],
        limit: 0,
        readData: false
      })
      if (!result.files || result.files.length === 0) return null
      
      const infos: PdfFileInfo[] = []
      for (const file of result.files) {
        const bytes = await loadPickedFileBytes(file)
        if (!bytes) continue
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const filePath = file.path || file.name
        fileCache.set(filePath, bytes)
        
        infos.push({
          filePath,
          fileName: file.name,
          pageCount: doc.getPageCount(),
          fileSizeBytes: file.size || bytes.byteLength,
          isEncrypted: doc.isEncrypted
        })
      }
      return infos
    } catch (e) {
      console.error(e)
      return null
    }
  },

  async processDroppedFiles(files: File[]): Promise<PdfFileInfo[]> {
    const infos: PdfFileInfo[] = []
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) continue
      
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      fileCache.set(file.name, bytes)
      
      infos.push({
        filePath: file.name,
        fileName: file.name,
        pageCount: doc.getPageCount(),
        fileSizeBytes: file.size,
        isEncrypted: doc.isEncrypted
      })
    }
    return infos
  },

  async getFileInfo(filePath: string): Promise<PdfFileInfo | null> {
    const bytes = fileCache.get(filePath)
    if (!bytes) return null
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    return {
      filePath,
      fileName: filePath.split('/').pop() || 'document.pdf',
      pageCount: doc.getPageCount(),
      fileSizeBytes: bytes.byteLength,
      isEncrypted: doc.isEncrypted
    }
  },

  async readPdfFile(filePath: string): Promise<ArrayBuffer> {
    const bytes = fileCache.get(filePath)
    if (!bytes) throw new Error('File not found in cache')
    return (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  },

  clearTempFiles(): void {
    for (const key of fileCache.keys()) {
      if (key.startsWith('temp_')) {
        fileCache.delete(key)
      }
    }
  },

  releaseFile(filePath: string): void {
    fileCache.delete(filePath)
  },

  clearAllCache(): void {
    fileCache.clear()
  },

  async mergePdfs(filePaths: string[], customName?: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const mergedPdf = await PDFDocument.create()
      
      for (const path of filePaths) {
        const bytes = fileCache.get(path)
        if (!bytes) throw new Error(`Missing file data for ${path}`)
        const pdfDoc = await PDFDocument.load(bytes)
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices())
        copiedPages.forEach(p => mergedPdf.addPage(p))
      }
      
      const resultBytes = await mergedPdf.save({ useObjectStreams: true })
      return await saveResult(resultBytes, customName || 'PDFlt_unido.pdf', toTemp, mergedPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async reorderPages(filePath: string, newOrder: number[], customName?: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const bytes = fileCache.get(filePath)
      if (!bytes) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(bytes)
      const newPdf = await PDFDocument.create()
      
      const copiedPages = await newPdf.copyPages(sourcePdf, newOrder)
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const resultBytes = await newPdf.save({ useObjectStreams: true })
      return await saveResult(resultBytes, customName || 'PDFlt_reordenado.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async extractPages(filePath: string, selectedIndices: number[], customName?: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const bytes = fileCache.get(filePath)
      if (!bytes) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(bytes)
      const newPdf = await PDFDocument.create()
      
      const copiedPages = await newPdf.copyPages(sourcePdf, selectedIndices)
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const resultBytes = await newPdf.save({ useObjectStreams: true })
      return await saveResult(resultBytes, customName || 'PDFlt_extraido.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async compressStructural(filePath: string, toTemp?: boolean): Promise<OperationResult> {
    try {
      const bytes = fileCache.get(filePath)
      if (!bytes) throw new Error('File not found')
      const sourcePdf = await PDFDocument.load(bytes)
      const newPdf = await PDFDocument.create()
      
      // Basic structural compression
      const copiedPages = await newPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
      copiedPages.forEach(p => newPdf.addPage(p))
      
      const resultBytes = await newPdf.save({ useObjectStreams: true })
      return await saveResult(resultBytes, 'PDFlt_comprimido.pdf', toTemp, newPdf.getPageCount(), bytes.byteLength)
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async assembleCompressedPdf(images: (string | Uint8Array)[], dimensions: PageDimension[], toTemp?: boolean): Promise<OperationResult> {
    try {
      const newPdf = await PDFDocument.create()
      
      for (let i = 0; i < images.length; i++) {
        const item = images[i]
        const dim = dimensions[i]
        
        let img: any
        if (typeof item === 'string') {
          const b64Data = item.includes(',') ? item.split(',')[1] : item
          img = await newPdf.embedJpg(b64Data)
        } else {
          img = await newPdf.embedJpg(item)
        }
        
        const page = newPdf.addPage([dim.width, dim.height])
        page.drawImage(img, {
          x: 0,
          y: 0,
          width: dim.width,
          height: dim.height
        })
      }
      
      const resultBytes = await newPdf.save({ useObjectStreams: true })
      return await saveResult(resultBytes, 'PDFlt_comprimido.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },
  promptSaveDialog,
  promptConfirmDialog,
  
  async createPdfFromImages(
    imagesBase64: string[],
    customName?: string,
    toTemp?: boolean,
    options?: { fitToImage?: boolean }
  ): Promise<OperationResult> {
    try {
      const newPdf = await PDFDocument.create()
      const fitToImage = options?.fitToImage ?? true
      
      for (const b64 of imagesBase64) {
        const b64Data = b64.includes(',') ? b64.split(',')[1] : b64
        
        let img
        if (b64.startsWith('data:image/png') || b64Data.startsWith('iVBORw0KGgo')) {
          try {
            img = await newPdf.embedPng(b64Data)
          } catch {
            img = await newPdf.embedJpg(b64Data)
          }
        } else {
          try {
            img = await newPdf.embedJpg(b64Data)
          } catch {
            img = await newPdf.embedPng(b64Data)
          }
        }
        
        if (fitToImage) {
          // Normalize to standard document dimensions (A4 reference: 595.28 pt portrait, 841.89 pt landscape)
          const isLandscape = img.width > img.height
          const baseWidth = isLandscape ? 841.89 : 595.28
          const scale = baseWidth / img.width
          const pageWidth = baseWidth
          const pageHeight = Math.round(img.height * scale * 100) / 100

          const page = newPdf.addPage([pageWidth, pageHeight])
          page.drawImage(img, {
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight
          })
        } else {
          const A4_WIDTH = 595.28
          const A4_HEIGHT = 841.89
          
          const isLandscape = img.width > img.height
          const pageWidth = isLandscape ? A4_HEIGHT : A4_WIDTH
          const pageHeight = isLandscape ? A4_WIDTH : A4_HEIGHT
          
          const page = newPdf.addPage([pageWidth, pageHeight])
          
          const margin = 20
          const availWidth = pageWidth - margin * 2
          const availHeight = pageHeight - margin * 2
          
          const scale = Math.min(availWidth / img.width, availHeight / img.height)
          const imgWidth = img.width * scale
          const imgHeight = img.height * scale
          
          const x = (pageWidth - imgWidth) / 2
          const y = (pageHeight - imgHeight) / 2
          
          page.drawImage(img, {
            x,
            y,
            width: imgWidth,
            height: imgHeight
          })
        }
      }
      
      const resultBytes = await newPdf.save({ useObjectStreams: true })
      return await saveResult(resultBytes, customName || 'PDFlt_escaneo.pdf', toTemp, newPdf.getPageCount())
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  async copyFile(
    sourcePath: string,
    destinationPath: string,
    customDirectory?: string,
    directoryHandle?: any
  ): Promise<boolean> {
    try {
      let bytes = fileCache.get(sourcePath)
      if (!bytes) {
        try {
          const res = await Filesystem.readFile({ path: sourcePath, directory: Directory.Documents })
          if (typeof res.data === 'string') {
            bytes = base64ToUint8Array(res.data)
          }
        } catch {
          // not found in filesystem
        }
      }
      if (!bytes) return false

      const fileName = destinationPath.toLowerCase().endsWith('.pdf') ? destinationPath : `${destinationPath}.pdf`

      // 1. If web directoryHandle was chosen via showDirectoryPicker (Web / Desktop)
      if (directoryHandle && typeof directoryHandle.getFileHandle === 'function') {
        try {
          const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(bytes)
          await writable.close()
          fileCache.set(fileName, bytes)
          return true
        } catch (dirErr) {
          console.warn('directoryHandle write failed:', dirErr)
        }
      }

      // 2. If Android / native custom directory path was chosen
      const b64 = uint8ArrayToBase64(bytes)
      if (customDirectory) {
        try {
          const target = customDirectory.endsWith('/') ? `${customDirectory}${fileName}` : `${customDirectory}/${fileName}`
          await Filesystem.writeFile({
            path: target,
            data: b64
          })
          fileCache.set(fileName, bytes)
          return true
        } catch (custErr) {
          console.warn('Custom directory write failed, falling back to Documents:', custErr)
        }
      }

      // 3. Default: write to Directory.Documents
      try {
        await Filesystem.writeFile({
          path: fileName,
          data: b64,
          directory: Directory.Documents
        })
        fileCache.set(fileName, bytes)
        return true
      } catch (fsErr) {
        // Fallback for browser preview download
        const blob = new Blob([bytes as any], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        fileCache.set(fileName, bytes)
        return true
      }
    } catch (e) {
      console.error(e)
      return false
    }
  },

  sharePdf,
  openPdf,
  promptSuccessModal
}

export type ChainViewTarget = 'scan' | 'compress' | 'merge' | 'split' | 'reorder'

export interface SaveModalOptions {
  defaultName: string
  title?: string
  fileSize?: string
  currentView?: ChainViewTarget
}

export type SaveModalResult =
  | {
      action: 'save'
      fileName: string
      customDirectory?: string
      directoryHandle?: any
      destinationName?: string
    }
  | { action: 'chain'; targetView: ChainViewTarget }
  | null

export function formatFileSize(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

interface ChainButtonDef {
  id: ChainViewTarget
  label: string
  icon: string
}

const ALL_CHAIN_BUTTONS: ChainButtonDef[] = [
  {
    id: 'compress',
    label: 'Comprimir',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
  },
  {
    id: 'merge',
    label: 'Unir',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="13" height="13" rx="2"/><path d="M4 8v11a2 2 0 0 0 2 2h11"/></svg>`
  },
  {
    id: 'split',
    label: 'Separar',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>`
  },
  {
    id: 'reorder',
    label: 'Reordenar',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`
  }
]

export function promptSaveDialog(options: SaveModalOptions): Promise<SaveModalResult> {
  return new Promise((resolve) => {
    const { defaultName, title = 'Guardar PDF', fileSize, currentView } = options
    const initialBase = defaultName.replace(/\.pdf$/i, '').trim() || 'documento'

    let chosenDirectory: string | undefined
    let chosenDirectoryHandle: any = null
    let destinationDisplayName = 'Documentos'

    // Filter chain actions: exclude the current tool and tools not applicable
    const chainButtons = ALL_CHAIN_BUTTONS.filter((btn) => {
      if (btn.id === currentView) return false
      // For scanner, reorder is already available on Stage 2 grid
      if (currentView === 'scan' && btn.id === 'reorder') return false
      return true
    })

    const overlay = document.createElement('div')
    overlay.className = 'save-modal-overlay'
    overlay.innerHTML = `
      <div class="save-modal-card">
        <div class="save-modal-header">
          <h3>${title}</h3>
          <button class="save-modal-close btn-icon" title="Cerrar" style="width: 32px; height: 32px; padding: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="save-modal-body">
          ${
            fileSize
              ? `
            <div class="save-modal-size-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span>Tamaño del archivo: <strong>${fileSize}</strong></span>
            </div>
          `
              : ''
          }

          <label for="save-filename-input">Nombre del archivo:</label>
          <div class="save-modal-input-group">
            <input type="text" id="save-filename-input" value="${initialBase}" autocomplete="off" autocapitalize="none" spellcheck="false" />
            <span class="save-modal-ext">.pdf</span>
          </div>

          <div style="margin-top: 14px;">
            <label style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted); display: block; margin-bottom: 6px;">Guardar en:</label>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <span id="save-location-display" style="font-size: 0.84rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Documentos</span>
              </div>
              <button type="button" id="save-change-folder-btn" class="btn-secondary" style="padding: 4px 10px; font-size: 0.78rem; border-radius: 6px; flex-shrink: 0; height: 28px;">
                Cambiar
              </button>
            </div>
          </div>

          ${
            chainButtons.length > 0
              ? `
            <div class="save-modal-chain-section">
              <div class="save-modal-chain-title">o continuar editando en:</div>
              <div class="save-modal-chain-buttons">
                ${chainButtons
                  .map(
                    (btn) => `
                  <button type="button" class="save-modal-chain-btn" data-target="${btn.id}">
                    ${btn.icon}
                    <span>${btn.label}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>
        <div class="save-modal-footer">
          <button id="save-modal-cancel" class="btn-secondary">Cancelar</button>
          <button id="save-modal-confirm" class="btn-primary">Guardar</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    const input = overlay.querySelector('#save-filename-input') as HTMLInputElement
    const confirmBtn = overlay.querySelector('#save-modal-confirm') as HTMLButtonElement
    const cancelBtn = overlay.querySelector('#save-modal-cancel') as HTMLButtonElement
    const closeBtn = overlay.querySelector('.save-modal-close') as HTMLButtonElement
    const locationDisplay = overlay.querySelector('#save-location-display') as HTMLElement
    const changeFolderBtn = overlay.querySelector('#save-change-folder-btn') as HTMLButtonElement

    changeFolderBtn?.addEventListener('click', async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const res = await FilePicker.pickDirectory()
          if (res && res.path) {
            chosenDirectory = res.path
            const cleanPath = res.path.replace(/\/+$/, '')
            const parts = cleanPath.split(/[/|\\]/).filter(Boolean)
            destinationDisplayName = decodeURIComponent(parts[parts.length - 1] || 'Carpeta seleccionada')
            if (locationDisplay) locationDisplay.textContent = destinationDisplayName
          }
        } else if (typeof (window as any).showDirectoryPicker === 'function') {
          const handle = await (window as any).showDirectoryPicker()
          if (handle) {
            chosenDirectoryHandle = handle
            destinationDisplayName = handle.name || 'Carpeta seleccionada'
            if (locationDisplay) locationDisplay.textContent = destinationDisplayName
          }
        }
      } catch (pickerErr: any) {
        console.debug('Folder picking cancelled or dismissed:', pickerErr)
      }
    })

    let isClosed = false
    const close = (result: SaveModalResult) => {
      if (isClosed) return
      isClosed = true
      overlay.remove()
      resolve(result)
    }

    const confirm = () => {
      let val = input.value.trim()
      val = val.replace(/[\\/:*?"<>|]/g, '').trim()
      val = val.replace(/\.pdf$/i, '').trim()
      if (!val) val = initialBase
      close({
        action: 'save',
        fileName: `${val}.pdf`,
        customDirectory: chosenDirectory,
        directoryHandle: chosenDirectoryHandle,
        destinationName: destinationDisplayName
      })
    }

    confirmBtn.addEventListener('click', confirm)
    cancelBtn.addEventListener('click', () => close(null))
    closeBtn.addEventListener('click', () => close(null))

    overlay.querySelectorAll('.save-modal-chain-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const target = (btn as HTMLElement).dataset.target as ChainViewTarget
        if (target) {
          close({ action: 'chain', targetView: target })
        }
      })
    })

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      }
    })

    setTimeout(() => {
      input.focus()
      input.select()
    }, 50)
  })
}

async function saveResult(
  data: Uint8Array | string,
  defaultName: string,
  toTemp?: boolean,
  pageCount?: number,
  originalSize?: number
): Promise<OperationResult> {
  const fileName = toTemp
    ? generateTempName()
    : defaultName.toLowerCase().endsWith('.pdf')
      ? defaultName
      : `${defaultName}.pdf`
  
  const bytes = typeof data === 'string' ? base64ToUint8Array(data) : data

  if (toTemp) {
    // Save to cache as binary Uint8Array instead of filesystem
    fileCache.set(fileName, bytes)
    return {
      success: true,
      outputPath: fileName,
      pageCount,
      originalSize,
      compressedSize: bytes.byteLength
    }
  }

  // Save via Capacitor Filesystem
  const b64 = uint8ArrayToBase64(bytes)
  try {
    await Filesystem.writeFile({
      path: fileName,
      data: b64,
      directory: Directory.Documents // Saves to Documents folder
    })
    
    fileCache.set(fileName, bytes)
    return {
      success: true,
      outputPath: fileName,
      pageCount,
      originalSize,
      compressedSize: bytes.byteLength
    }
  } catch (e: any) {
    // Fallback for browser preview (npm run dev)
    try {
      const blob = new Blob([bytes as any], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      fileCache.set(fileName, bytes)
      return {
        success: true,
        outputPath: fileName,
        pageCount,
        originalSize,
        compressedSize: bytes.byteLength
      }
    } catch {
      return { success: false, error: e.message }
    }
  }
}

export interface ConfirmModalOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDanger?: boolean
}

export function promptConfirmDialog(options: ConfirmModalOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'save-modal-overlay'

    overlay.innerHTML = `
      <div class="save-modal-card" style="max-width: 360px;">
        <div class="save-modal-header">
          <h3>${options.title}</h3>
          <button type="button" class="save-modal-close btn-icon" aria-label="Cerrar" style="width: 32px; height: 32px; padding: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="save-modal-body">
          <p style="color: var(--text-secondary); font-size: 0.95rem; margin: 0; line-height: 1.45;">${options.message}</p>
        </div>
        <div class="save-modal-footer" style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
          <button id="confirm-modal-cancel" class="btn-secondary" style="padding: 8px 16px;">${options.cancelText || 'Cancelar'}</button>
          <button id="confirm-modal-ok" class="btn-primary" style="padding: 8px 16px; ${options.isDanger ? 'background: var(--error); box-shadow: 0 4px 12px var(--error-soft);' : ''}">${options.confirmText || 'Aceptar'}</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    let isClosed = false
    const closeDialog = (result: boolean) => {
      if (isClosed) return
      isClosed = true
      overlay.remove()
      resolve(result)
    }

    overlay.querySelector('#confirm-modal-ok')?.addEventListener('click', () => closeDialog(true))
    overlay.querySelector('#confirm-modal-cancel')?.addEventListener('click', () => closeDialog(false))
    overlay.querySelector('.save-modal-close')?.addEventListener('click', () => closeDialog(false))
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog(false)
    })
  })
}

export async function sharePdf(fileName: string): Promise<boolean> {
  const bytes = fileCache.get(fileName)
  try {
    const uriResult = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Documents
    })
    
    await Share.share({
      title: fileName,
      text: `${fileName} - PDFlt`,
      url: uriResult.uri,
      dialogTitle: 'Compartir PDF'
    })
    return true
  } catch (err) {
    console.warn('Native share failed or dismissed, falling back:', err)
    if (bytes && typeof navigator !== 'undefined') {
      try {
        const file = new File([bytes as any], fileName, { type: 'application/pdf' })
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: fileName
          })
          return true
        }
      } catch (webShareErr) {
        console.warn('Web share failed:', webShareErr)
      }

      // Download fallback
      try {
        const blob = new Blob([bytes as any], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return true
      } catch (downloadErr) {
        console.warn('Download fallback failed:', downloadErr)
      }
    }
    return false
  }
}

export async function openPdf(fileName: string): Promise<void> {
  const bytes = fileCache.get(fileName)

  // 1. Android Native Platform: use native Intent.ACTION_VIEW via NativePdfPlugin
  if (Capacitor.isNativePlatform()) {
    try {
      let targetUri: string | null = null

      // Check if file is in Documents (where saved files are written)
      try {
        const docUri = await Filesystem.getUri({
          path: fileName,
          directory: Directory.Documents
        })
        if (docUri && docUri.uri) {
          targetUri = docUri.uri
        }
      } catch (docErr) {
        console.debug('File not found in Documents folder:', docErr)
      }

      // If not in Documents but bytes exist in memory, write temporarily to Cache to open
      if (!targetUri && bytes) {
        try {
          const b64 = uint8ArrayToBase64(bytes)
          await Filesystem.writeFile({
            path: fileName,
            data: b64,
            directory: Directory.Cache
          })
          const cacheUri = await Filesystem.getUri({
            path: fileName,
            directory: Directory.Cache
          })
          if (cacheUri && cacheUri.uri) {
            targetUri = cacheUri.uri
          }
        } catch (cacheErr) {
          console.debug('Could not write temporary file to Cache:', cacheErr)
        }
      }

      // Launch native Android PDF viewer chooser
      if (targetUri) {
        const opened = await openNativePdf(targetUri)
        if (opened) return
      }
    } catch (nativeErr) {
      console.warn('Native openPdf failed:', nativeErr)
    }

    // Fallback on native: share sheet if opening failed
    await sharePdf(fileName)
    return
  }

  // 2. Web / Browser fallback: open Blob URL in new window/tab
  if (bytes) {
    try {
      const blob = new Blob([bytes as any], { type: 'application/pdf' })
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank')
      return
    } catch (e) {
      console.warn('Could not open blob URL:', e)
    }
  }

  // 3. Final fallback
  await sharePdf(fileName)
}

export interface SuccessModalOptions {
  fileName: string
  fileSize?: string
  pageCount?: number
  outputPath?: string
  destinationName?: string
}

export function promptSuccessModal(options: SuccessModalOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'save-modal-overlay'

    overlay.innerHTML = `
      <div class="save-modal-card" style="max-width: 380px; text-align: center; padding: 24px 20px;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--success-soft); color: var(--success); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; box-shadow: 0 0 20px rgba(52, 211, 153, 0.25);">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; letter-spacing: -0.01em;">¡PDF guardado con éxito!</h3>
        
        <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin: 16px 0; text-align: left; display: flex; align-items: center; gap: 12px;">
          <div style="width: 38px; height: 38px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
          <div style="flex: 1; overflow: hidden; min-width: 0;">
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${options.fileName}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 5px;">
              <span>${options.pageCount ? `${options.pageCount} pág · ` : ''}${options.fileSize ? `${options.fileSize} · ` : ''}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Guardado en ${options.destinationName || 'Documentos'}</span>
            </div>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 6px;">
          <button id="success-share-btn" class="btn-primary" style="width: 100%; justify-content: center; padding: 11px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
            Compartir PDF
          </button>

          <button id="success-open-btn" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            Abrir PDF
          </button>

          <button id="success-done-btn" class="btn-secondary" style="width: 100%; justify-content: center; padding: 8px; border-color: transparent; background: transparent; color: var(--text-muted);">
            Listo
          </button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    let isClosed = false
    const closeDialog = () => {
      if (isClosed) return
      isClosed = true
      overlay.remove()
      resolve()
    }

    overlay.querySelector('#success-share-btn')?.addEventListener('click', async () => {
      await sharePdf(options.fileName)
    })

    overlay.querySelector('#success-open-btn')?.addEventListener('click', async () => {
      await openPdf(options.fileName)
    })

    overlay.querySelector('#success-done-btn')?.addEventListener('click', () => {
      closeDialog()
    })

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog()
      }
    })
  })
}
