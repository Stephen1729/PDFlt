import { pdfService } from '../services/pdfService'
import * as pdfjsLib from 'pdfjs-dist'
import Sortable from 'sortablejs'
import { navigateTo, showNotification } from '../router'
import type { PdfFileInfo } from '../../../shared/types'

// Configure pdf.js worker
// Use new URL() + import.meta.url so Vite resolves and bundles the worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// â”€â”€ Module state â”€â”€
let currentFilePath: string | null = null
let currentPageOrder: number[] = []
let originalPageCount = 0

/**
 * Renders the reorder view:
 * - Drop zone (when no file loaded)
 * - Thumbnail grid with drag-and-drop (when file loaded)
 * - Action bar with save/reset
 */
export function renderReorder(container: HTMLElement, payload?: any): void {
  // Reset state
  currentFilePath = null
  currentPageOrder = []
  originalPageCount = 0

  container.innerHTML = `
    <div class="view-header">
      <h2>Reordenar páginas</h2>
      <span id="file-name" class="file-name"></span>
    </div>

    <!-- Drop zone (visible when no file) -->
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <p>Toca para seleccionar un PDF</p>
      </div>
    </div>

    <!-- Thumbnails (visible when file loaded) -->
    <div id="thumbnails-scroll" class="thumbnails-scroll" style="display:none">
      <div id="thumbnails-grid" class="thumbnails-grid"></div>
    </div>

    <!-- Action bar -->
    <div id="action-bar" class="action-bar" style="display:none">
      <span id="page-info" class="page-info">0 páginas</span>
      <div class="action-buttons">
        <button id="reset-btn" class="btn-secondary">Restablecer orden</button>
        <button id="save-btn" class="btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Guardar PDF
        </button>
        <div class="chain-actions">
          <span style="color:var(--text-muted); font-size: 0.85rem">o continuar en:</span>
          <button id="reorder-to-merge" class="btn-secondary" title="Unir">Unir</button>
          <button id="reorder-to-split" class="btn-secondary" title="Separar">Separar</button>
          <button id="reorder-to-compress" class="btn-secondary" title="Comprimir">Comprimir</button>
        </div>
      </div>
    </div>
  `

  setupEventListeners()

  // Handle chaining from Merge
  if (payload && payload.fileInfo) {
    loadPdf(payload.fileInfo)
  }
}

function setupEventListeners(): void {
  // Drop zone click â†’ open file dialog
  const dropZone = document.getElementById('drop-zone')!
  dropZone.addEventListener('click', handleOpenFile)

  // Drag-and-drop visual feedback
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

  // Reset button
  document.getElementById('reset-btn')!.addEventListener('click', handleReset)

  // Save buttons
  document.getElementById('save-btn')?.addEventListener('click', () => handleSave(false))
  document.getElementById('reorder-to-merge')?.addEventListener('click', () => handleSave(true, 'merge'))
  document.getElementById('reorder-to-split')?.addEventListener('click', () => handleSave(true, 'split'))
  document.getElementById('reorder-to-compress')?.addEventListener('click', () => handleSave(true, 'compress'))
}

async function handleOpenFile(): Promise<void> {
  const fileInfo = await pdfService.openPdfDialog()
  if (fileInfo) {
    await loadPdf(fileInfo)
  }
}

async function loadPdf(fileInfo: PdfFileInfo): Promise<void> {
  currentFilePath = fileInfo.filePath
  originalPageCount = fileInfo.pageCount
  currentPageOrder = Array.from({ length: fileInfo.pageCount }, (_, i) => i)

  // Update header
  document.getElementById('file-name')!.textContent = fileInfo.fileName

  // Show encrypted warning
  if (fileInfo.isEncrypted) {
    showNotification(
      'Este PDF tiene restricciones de seguridad. El resultado podrÃ­a no preservar todas las protecciones.',
      'warning'
    )
  }

  // Switch from drop zone to thumbnails view
  document.getElementById('drop-zone')!.style.display = 'none'
  document.getElementById('thumbnails-scroll')!.style.display = 'block'
  document.getElementById('action-bar')!.style.display = 'flex'

  // Update page info
  document.getElementById('page-info')!.textContent = `${fileInfo.pageCount} páginas`

  // Render thumbnails
  await renderThumbnails(fileInfo.filePath, fileInfo.pageCount)
}

async function renderThumbnails(filePath: string, pageCount: number): Promise<void> {
  const grid = document.getElementById('thumbnails-grid')!

  // Show loading
  grid.innerHTML = `
    <div class="loading-container" style="grid-column: 1 / -1">
      <div class="spinner"></div>
      <span class="loading-text">Cargando páginas...</span>
    </div>
  `

  try {
    // Read file bytes from main process
    const arrayBuffer = await pdfService.readPdfFile(filePath)

    // Load with pdf.js
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer)
    }).promise

    grid.innerHTML = ''

    // Render each page thumbnail progressively
    for (let i = 0; i < pageCount; i++) {
      const page = await pdf.getPage(i + 1) // pdf.js uses 1-based indices

      // Calculate scale to fit ~320px width for high DPI crispness
      const desiredWidth = 320
      const originalViewport = page.getViewport({ scale: 1 })
      const scale = desiredWidth / originalViewport.width
      const viewport = page.getViewport({ scale })

      // Create canvas and render
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport }).promise

      // Create thumbnail card
      const card = document.createElement('div')
      card.className = 'thumbnail-card'
      card.dataset.pageIndex = String(i)
      card.dataset.originalIndex = String(i)

      const imageDiv = document.createElement('div')
      imageDiv.className = 'thumbnail-image'
      imageDiv.appendChild(canvas)

      const label = document.createElement('div')
      label.className = 'thumbnail-label'
      label.textContent = `PÃ¡g. ${i + 1}`

      card.appendChild(imageDiv)
      card.appendChild(label)
      grid.appendChild(card)
    }

    // Initialize SortableJS for drag-and-drop reordering
    Sortable.create(grid, {
      animation: 200,
      ghostClass: 'thumbnail-ghost',
      chosenClass: 'thumbnail-chosen',
      dragClass: 'thumbnail-drag',
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      onEnd: updatePageOrder
    })
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

/**
 * Called after each drag-and-drop. Reads the DOM order and updates currentPageOrder.
 */
function updatePageOrder(): void {
  const grid = document.getElementById('thumbnails-grid')!
  const cards = grid.querySelectorAll('.thumbnail-card')

  currentPageOrder = Array.from(cards).map((card) =>
    parseInt((card as HTMLElement).dataset.pageIndex!, 10)
  )

  // Check if order has changed from original
  const isOriginalOrder = currentPageOrder.every((val, idx) => val === idx)
  const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement
  resetBtn.disabled = isOriginalOrder

  // Update page info to show if reordered
  const pageInfo = document.getElementById('page-info')!
  if (isOriginalOrder) {
    pageInfo.textContent = `${originalPageCount} páginas`
  } else {
    pageInfo.textContent = `${originalPageCount} páginas · orden modificado`
  }
}

/**
 * Resets thumbnail order to original.
 */
function handleReset(): void {
  const grid = document.getElementById('thumbnails-grid')!
  const cards = Array.from(grid.querySelectorAll('.thumbnail-card'))

  // Sort cards by their original page index
  cards.sort((a, b) => {
    const ai = parseInt((a as HTMLElement).dataset.pageIndex!, 10)
    const bi = parseInt((b as HTMLElement).dataset.pageIndex!, 10)
    return ai - bi
  })

  // Re-append in sorted order
  cards.forEach((card) => grid.appendChild(card))

  // Reset state
  currentPageOrder = Array.from({ length: originalPageCount }, (_, i) => i)
  updatePageOrder()
}

/**
 * Saves the reordered PDF.
 */
async function handleSave(toTemp: boolean, targetView?: any): Promise<void> {
  if (!currentFilePath) return

  // Removed check for isOriginalOrder because if chaining, they might just want to pass the file through unchanged

  const btnId = toTemp ? `reorder-to-${targetView}` : 'save-btn'
  const saveBtn = document.getElementById(btnId) as HTMLButtonElement
  const originalText = saveBtn.innerHTML
  
  document.querySelectorAll('#action-bar button').forEach(b => (b as HTMLButtonElement).disabled = true)
  saveBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div>`

  try {
    const result = await pdfService.reorderPages(currentFilePath, currentPageOrder, toTemp)

    if (result.success && result.outputPath) {
      if (toTemp && targetView) {
        const fileInfo = await pdfService.getFileInfo(result.outputPath)
        if (fileInfo) {
          showNotification('Redirigiendo...', 'success')
          navigateTo(targetView, { fileInfo })
        }
      } else {
        showNotification(`PDF guardado correctamente (${result.pageCount} páginas)`, 'success')
      }
    } else if (result.error !== 'OperaciÃ³n cancelada') {
      showNotification(result.error || 'Error desconocido al guardar', 'error')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    showNotification(`Error: ${message}`, 'error')
  } finally {
    document.querySelectorAll('#action-bar button').forEach(b => (b as HTMLButtonElement).disabled = false)
    saveBtn.innerHTML = originalText
  }
}



