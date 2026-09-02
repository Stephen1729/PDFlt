import * as pdfjsLib from 'pdfjs-dist'
import { showNotification } from '../router'
import type { PdfFileInfo } from '../../../shared/types'

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// ── Module state ──
let currentFilePath: string | null = null
let totalPageCount = 0
let selectedPages: Set<number> = new Set()

export function renderSplit(container: HTMLElement): void {
  // Reset state
  currentFilePath = null
  totalPageCount = 0
  selectedPages = new Set()

  container.innerHTML = `
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          <path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/>
        </svg>
        <h3>Separar PDF</h3>
        <p>Arrastra tu PDF aquí o haz clic para seleccionar</p>
        <button id="open-btn" class="btn-primary" style="margin-top: 1rem;">Seleccionar PDF</button>
      </div>
    </div>

    <!-- Thumbnails scroll area (visible when file loaded) -->
    <div id="thumbnails-scroll" class="thumbnails-scroll" style="display:none">
      <div class="thumbnails-header">
        <h2 id="file-name" style="margin-bottom: 4px;"></h2>
        <p style="color: var(--text-muted); font-size: 0.9rem;">
          Haz clic en las páginas que deseas extraer al nuevo PDF.
        </p>
      </div>
      <div id="thumbnails-grid" class="thumbnails-grid"></div>
    </div>

    <!-- Action bar (visible when file loaded) -->
    <div id="action-bar" class="action-bar" style="display:none">
      <span id="selection-info" class="page-info">0 seleccionadas</span>
      <div class="action-buttons">
        <button id="select-all-btn" class="btn-secondary">Seleccionar todas</button>
        <button id="extract-btn" class="btn-primary" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Guardar PDF
        </button>
        <div class="chain-actions">
          <span style="color:var(--text-muted); font-size: 0.85rem">o continuar en:</span>
          <button id="split-to-merge" class="btn-secondary" title="Unir" disabled>➡️ Unir</button>
          <button id="split-to-reorder" class="btn-secondary" title="Reordenar" disabled>➡️ Reordenar</button>
          <button id="split-to-compress" class="btn-secondary" title="Comprimir" disabled>➡️ Comprimir</button>
        </div>
      </div>
    </div>
  `

  setupEventListeners()

  // Handle chaining
  if (payload && payload.fileInfo) {
    loadPdf(payload.fileInfo)
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
      const paths = Array.from(files)
        .map(f => window.electronAPI.getFilePath(f))
        .filter(p => p && p.toLowerCase().endsWith('.pdf'))
        
      if (paths.length > 0) {
        const infos = await window.electronAPI.processDroppedFiles([paths[0]])
        if (infos && infos.length > 0) {
          await loadPdf(infos[0])
        }
      }
    }
  })

  // Extract buttons
  document.getElementById('extract-btn')?.addEventListener('click', () => handleExtract(false))
  document.getElementById('split-to-merge')?.addEventListener('click', () => handleExtract(true, 'merge'))
  document.getElementById('split-to-reorder')?.addEventListener('click', () => handleExtract(true, 'reorder'))
  document.getElementById('split-to-compress')?.addEventListener('click', () => handleExtract(true, 'compress'))
  document.getElementById('split-all-btn')?.addEventListener('click', handleSelectAll)
}

async function handleOpenFile(): Promise<void> {
  const fileInfo = await window.electronAPI.openPdfDialog()
  if (fileInfo) {
    await loadPdf(fileInfo)
  }
}

async function loadPdf(fileInfo: PdfFileInfo): Promise<void> {
  currentFilePath = fileInfo.filePath
  totalPageCount = fileInfo.pageCount
  selectedPages.clear()
  updateSelectionInfo()

  document.getElementById('file-name')!.textContent = fileInfo.fileName

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
    const arrayBuffer = await window.electronAPI.readPdfFile(filePath)
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer)
    }).promise

    grid.innerHTML = ''

    for (let i = 0; i < pageCount; i++) {
      const page = await pdf.getPage(i + 1)
      const desiredWidth = 160
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
      <div class="loading-container" style="grid-column: 1 / -1">
        <span style="font-size: 2rem">⚠️</span>
        <p style="color: var(--error)">Error al cargar: ${message}</p>
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
  const chainBtns = document.querySelectorAll('.chain-actions button')

  if (count === 0) {
    infoSpan.textContent = 'Selecciona las páginas a extraer'
    btn.disabled = true
    chainBtns.forEach(b => (b as HTMLButtonElement).disabled = true)
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
    chainBtns.forEach(b => (b as HTMLButtonElement).disabled = false)
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

async function handleExtract(toTemp: boolean, targetView?: any): Promise<void> {
  if (!currentFilePath || selectedPages.size === 0) return

  const btnId = toTemp ? `split-to-${targetView}` : 'extract-btn'
  const btn = document.getElementById(btnId) as HTMLButtonElement
  const originalHtml = btn.innerHTML
  
  document.querySelectorAll('#action-bar button').forEach(b => (b as HTMLButtonElement).disabled = true)
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div>`

  try {
    const indices = Array.from(selectedPages)
    const result = await window.electronAPI.extractPages(currentFilePath, indices, toTemp)

    if (result.success && result.outputPath) {
      if (toTemp && targetView) {
        const fileInfo = await window.electronAPI.getFileInfo(result.outputPath)
        if (fileInfo) {
          showNotification('Redirigiendo...', 'success')
          navigateTo(targetView, { fileInfo })
        }
      } else {
        showNotification(`Extraído exitosamente (${result.pageCount} páginas)`, 'success')
      }
    } else if (result.error !== 'Operación cancelada') {
      showNotification(result.error || 'Error desconocido', 'error')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    showNotification(`Error: ${message}`, 'error')
  } finally {
    document.querySelectorAll('#action-bar button').forEach(b => (b as HTMLButtonElement).disabled = false)
    btn.innerHTML = originalHtml
  }
}

