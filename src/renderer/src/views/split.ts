import { pdfService, formatFileSize } from '../services/pdfService'
import * as pdfjsLib from 'pdfjs-dist'
import { showNotification, navigateTo } from '../router'
import type { PdfFileInfo } from '../../../shared/types'

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// ── Module state ──
let currentFilePath: string | null = null
let currentFileName: string = ''
let totalPageCount = 0
let selectedPages: Set<number> = new Set()

export function renderSplit(container: HTMLElement, payload?: any): void {
  const isRestoring = payload?.restoreState && currentFilePath

  if (!isRestoring) {
    currentFilePath = null
    currentFileName = ''
    totalPageCount = 0
    selectedPages = new Set()
  }

  container.innerHTML = `
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          <path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/>
        </svg>
        <h3>Separar PDF</h3>
        <p>Toca para seleccionar un PDF</p>
        <button id="open-btn" class="btn-primary" style="margin-top: 1rem; display: none;">Seleccionar PDF</button>
      </div>
    </div>

    <!-- Thumbnails scroll area (visible when file loaded) -->
    <div id="thumbnails-scroll" class="thumbnails-scroll" style="display:none">
      <div class="document-toolbar">
        <div class="document-toolbar-info">
          <div id="file-name" class="document-toolbar-name"></div>
          <div class="document-toolbar-meta">
            <span id="file-meta"></span>
          </div>
        </div>
        <div class="document-toolbar-actions">
          <button type="button" id="change-file-btn" class="btn-secondary" style="padding: 6px 12px; font-size: 0.82rem;">Cambiar</button>
          <button type="button" id="close-file-btn" class="btn-icon" title="Cerrar PDF" aria-label="Cerrar PDF" style="color: var(--text-muted);">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1rem;">
        Toca las páginas que deseas extraer al nuevo PDF.
      </p>
      <div id="thumbnails-grid" class="thumbnails-grid"></div>
    </div>

    <!-- Action bar (visible when file loaded) -->
    <div id="action-bar" class="action-bar" style="display:none">
      <span id="selection-info" class="page-info">0 seleccionadas</span>
      <div class="action-buttons">
        <button id="select-all-btn" class="btn-secondary">Seleccionar todas</button>
        <button id="invert-btn" class="btn-secondary">Invertir selección</button>
        <button id="extract-btn" class="btn-primary" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Guardar PDF
        </button>
      </div>
    </div>
  `

  setupEventListeners()

  // Handle chaining or restoring
  if (payload && payload.fileInfo) {
    loadPdf(payload.fileInfo)
  } else if (isRestoring && currentFilePath) {
    loadPdf({
      filePath: currentFilePath,
      fileName: currentFileName,
      pageCount: totalPageCount,
      fileSizeBytes: 0,
      isEncrypted: false
    })
  }
}

function setupEventListeners(): void {
  const dropZone = document.getElementById('drop-zone')!
  dropZone.addEventListener('click', handleOpenFile)

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()
    dropZone.classList.add('dragover')
  })

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
  })

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
    
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const fileArray = Array.from(files) as File[]
      const pdfFiles = fileArray.filter(f => f.name.toLowerCase().endsWith('.pdf'))
        
      if (pdfFiles.length > 0) {
        const infos = await pdfService.processDroppedFiles([pdfFiles[0]])
        if (infos && infos.length > 0) {
          await loadPdf(infos[0])
        }
      }
    }
  })

  // Extract button
  document.getElementById('extract-btn')?.addEventListener('click', handleExtract)
  document.getElementById('select-all-btn')?.addEventListener('click', handleSelectAll)
  document.getElementById('invert-btn')?.addEventListener('click', handleInvertSelection)

  // Document toolbar actions
  document.getElementById('change-file-btn')?.addEventListener('click', handleOpenFile)
  document.getElementById('close-file-btn')?.addEventListener('click', () => handleSplitBack())
}

export function handleSplitBack(): boolean {
  if (!currentFilePath) return false

  if (selectedPages.size > 0) {
    pdfService
      .promptConfirmDialog({
        title: '¿Cerrar PDF?',
        message: 'Se desmarcarán las páginas seleccionadas para extraer.',
        confirmText: 'Cerrar',
        isDanger: true
      })
      .then((confirmed) => {
        if (confirmed) {
          resetSplit()
        }
      })
    return true
  }

  resetSplit()
  return true
}

export function resetSplit(): void {
  currentFilePath = null
  currentFileName = ''
  totalPageCount = 0
  selectedPages.clear()

  const dropZone = document.getElementById('drop-zone')
  const thumbnailsScroll = document.getElementById('thumbnails-scroll')
  const actionBar = document.getElementById('action-bar')
  const grid = document.getElementById('thumbnails-grid')

  if (dropZone) dropZone.style.display = 'flex'
  if (thumbnailsScroll) thumbnailsScroll.style.display = 'none'
  if (actionBar) actionBar.style.display = 'none'
  if (grid) grid.innerHTML = ''
}

async function handleOpenFile(): Promise<void> {
  const fileInfo = await pdfService.openPdfDialog()
  if (fileInfo) {
    await loadPdf(fileInfo)
  }
}

async function loadPdf(fileInfo: PdfFileInfo): Promise<void> {
  currentFilePath = fileInfo.filePath
  currentFileName = fileInfo.fileName
  totalPageCount = fileInfo.pageCount
  selectedPages.clear()
  updateSelectionInfo()

  const nameEl = document.getElementById('file-name')
  if (nameEl) nameEl.textContent = fileInfo.fileName

  const metaEl = document.getElementById('file-meta')
  if (metaEl) {
    const sizeStr = fileInfo.fileSizeBytes ? ` · ${formatFileSize(fileInfo.fileSizeBytes)}` : ''
    metaEl.textContent = `${fileInfo.pageCount} páginas${sizeStr}`
  }

  if (fileInfo.isEncrypted) {
    showNotification('Este PDF tiene restricciones de seguridad.', 'warning')
  }

  document.getElementById('drop-zone')!.style.display = 'none'
  document.getElementById('thumbnails-scroll')!.style.display = 'block'
  document.getElementById('action-bar')!.style.display = 'flex'

  await renderThumbnails(fileInfo.filePath, fileInfo.pageCount)
}

async function renderThumbnails(filePath: string, pageCount: number): Promise<void> {
  const grid = document.getElementById('thumbnails-grid')!

  grid.innerHTML = `
    <div class="loading-container" style="grid-column: 1 / -1">
      <div class="spinner"></div>
      <span class="loading-text">Cargando páginas...</span>
    </div>
  `

  try {
    const arrayBuffer = await pdfService.readPdfFile(filePath)
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer)
    }).promise

    grid.innerHTML = ''

    for (let i = 0; i < pageCount; i++) {
      const page = await pdf.getPage(i + 1)
      const desiredWidth = 320
      const originalViewport = page.getViewport({ scale: 1 })
      const scale = desiredWidth / originalViewport.width
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport }).promise

      const card = document.createElement('div')
      card.className = 'thumbnail-card selectable'
      card.dataset.pageIndex = String(i)

      const imageDiv = document.createElement('div')
      imageDiv.className = 'thumbnail-image'
      imageDiv.appendChild(canvas)

      const label = document.createElement('div')
      label.className = 'thumbnail-label'
      label.textContent = `Pág. ${i + 1}`

      card.appendChild(imageDiv)
      card.appendChild(label)
      
      card.addEventListener('click', () => {
        const pageIdx = parseInt(card.dataset.pageIndex!, 10)
        if (selectedPages.has(pageIdx)) {
          selectedPages.delete(pageIdx)
          card.classList.remove('selected')
        } else {
          selectedPages.add(pageIdx)
          card.classList.add('selected')
        }
        updateSelectionInfo()
      })

      grid.appendChild(card)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    grid.innerHTML = `
      <div class="loading-container" style="grid-column: 1 / -1; flex-direction: column; gap: 16px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <p style="color: var(--error)">Error al cargar las páginas: ${message}</p>
        <button class="btn-secondary" id="retry-btn">Reintentar</button>
      </div>
    `
    document.getElementById('retry-btn')?.addEventListener('click', handleOpenFile)
  }
}

function updateSelectionInfo(): void {
  const count = selectedPages.size
  const infoSpan = document.getElementById('selection-info')!
  const btn = document.getElementById('extract-btn') as HTMLButtonElement
  if (count === 0) {
    infoSpan.textContent = 'Selecciona las páginas a extraer'
    btn.disabled = true
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Guardar PDF
    `
  } else {
    infoSpan.textContent = `${count} seleccionadas`
    btn.disabled = false
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Guardar PDF (${count} pág)
    `
  }
}

function handleSelectAll(): void {
  const grid = document.getElementById('thumbnails-grid')!
  const cards = grid.querySelectorAll('.thumbnail-card')
  const isAllSelected = selectedPages.size === totalPageCount

  if (isAllSelected) {
    selectedPages.clear()
    cards.forEach(card => card.classList.remove('selected'))
  } else {
    for (let i = 0; i < totalPageCount; i++) {
      selectedPages.add(i)
    }
    cards.forEach(card => card.classList.add('selected'))
  }
  
  updateSelectionInfo()
}

function handleInvertSelection(): void {
  const grid = document.getElementById('thumbnails-grid')!
  const cards = grid.querySelectorAll('.thumbnail-card')
  
  for (let i = 0; i < totalPageCount; i++) {
    if (selectedPages.has(i)) {
      selectedPages.delete(i)
    } else {
      selectedPages.add(i)
    }
  }

  cards.forEach((card, i) => {
    if (selectedPages.has(i)) {
      card.classList.add('selected')
    } else {
      card.classList.remove('selected')
    }
  })

  updateSelectionInfo()
}

async function handleExtract(): Promise<void> {
  if (!currentFilePath || selectedPages.size === 0) return

  const btn = document.getElementById('extract-btn') as HTMLButtonElement
  const originalHtml = btn.innerHTML
  
  document.querySelectorAll('#action-bar button').forEach((b) => ((b as HTMLButtonElement).disabled = true))
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Preparando...`

  try {
    const indices = Array.from(selectedPages)
    const tempResult = await pdfService.extractPages(currentFilePath, indices, undefined, true)

    if (!tempResult.success || !tempResult.outputPath) {
      showNotification(tempResult.error || 'Error al extraer páginas', 'error')
      return
    }

    const fileInfo = await pdfService.getFileInfo(tempResult.outputPath)
    const fileSize = fileInfo ? formatFileSize(fileInfo.fileSizeBytes) : ''

    const base = currentFileName ? currentFileName.replace(/\.pdf$/i, '') : 'documento'
    const defaultName = `${base}_extraido.pdf`

    const dialogResult = await pdfService.promptSaveDialog({
      defaultName,
      title: 'Guardar PDF Extraído',
      fileSize,
      currentView: 'split'
    })

    if (!dialogResult) return // user cancelled

    if (dialogResult.action === 'save') {
      const copied = await pdfService.copyFile(tempResult.outputPath, dialogResult.fileName)
      if (copied) {
        showNotification(`PDF guardado correctamente como ${dialogResult.fileName} (${tempResult.pageCount} páginas)`, 'success')
      } else {
        showNotification('Error al guardar el archivo', 'error')
      }
    } else if (dialogResult.action === 'chain') {
      if (fileInfo) {
        showNotification('Redirigiendo...', 'success')
        navigateTo(dialogResult.targetView, {
          fileInfo,
          returnTo: { view: 'split', payload: { restoreState: true } }
        })
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    showNotification(`Error: ${message}`, 'error')
  } finally {
    document.querySelectorAll('#action-bar button').forEach((b) => ((b as HTMLButtonElement).disabled = false))
    btn.innerHTML = originalHtml
  }
}



