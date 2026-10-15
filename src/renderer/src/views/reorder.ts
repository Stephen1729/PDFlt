import { pdfService, formatFileSize } from '../services/pdfService'
import * as pdfjsLib from 'pdfjs-dist'
import Sortable from 'sortablejs'
import { navigateTo, showNotification } from '../router'
import type { PdfFileInfo } from '../../../shared/types'
import { isNativePdfSupported, renderNativeThumbnail, clearNativePdfCache } from '../services/nativePdfService'

// Configure pdf.js worker
// Use new URL() + import.meta.url so Vite resolves and bundles the worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// ── Module state ──
let currentFilePath: string | null = null
let currentFileName: string = ''
let currentPageOrder: number[] = []
let originalPageCount = 0
let currentObserver: IntersectionObserver | null = null

/**
 * Renders the reorder view:
 * - Drop zone (when no file loaded)
 * - Thumbnail grid with drag-and-drop (when file loaded)
 * - Action bar with save/reset
 */
export function renderReorder(container: HTMLElement, payload?: any): void {
  const isRestoring = payload?.restoreState && currentFilePath

  if (!isRestoring) {
    currentFilePath = null
    currentFileName = ''
    currentPageOrder = []
    originalPageCount = 0
  }

  container.innerHTML = `
    <!-- Drop zone (visible when no file) -->
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
        </svg>
        <h3>Reordenar páginas</h3>
        <p>Toca para seleccionar un PDF</p>
      </div>
    </div>

    <!-- Thumbnails (visible when file loaded) -->
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
        Mantén presionada una página y deslízala para reordenar.
      </p>
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
  // Drop zone click → open file dialog
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

  // Save button
  document.getElementById('save-btn')?.addEventListener('click', handleSave)

  // Document toolbar actions
  document.getElementById('change-file-btn')?.addEventListener('click', handleOpenFile)
  document.getElementById('close-file-btn')?.addEventListener('click', () => handleReorderBack())
}

export async function canLeaveReorder(): Promise<boolean> {
  if (!currentFilePath) {
    return true
  }
  const isOrderChanged = currentPageOrder.some((p, i) => p !== i)
  if (isOrderChanged) {
    const confirmed = await pdfService.promptConfirmDialog({
      title: '¿Descartar cambios?',
      message: 'Se perderá el orden personalizado de las páginas si cambias de herramienta.',
      confirmText: 'Descartar y salir',
      cancelText: 'Continuar editando',
      isDanger: true
    })
    if (confirmed) {
      resetReorder()
      return true
    }
    return false
  }
  resetReorder()
  return true
}

export function handleReorderBack(): boolean {
  if (!currentFilePath) return false

  const isOrderChanged = currentPageOrder.some((p, i) => p !== i)
  if (isOrderChanged) {
    pdfService
      .promptConfirmDialog({
        title: '¿Descartar cambios?',
        message: 'Se perderá el orden personalizado de las páginas.',
        confirmText: 'Descartar',
        isDanger: true
      })
      .then((confirmed) => {
        if (confirmed) {
          resetReorder()
        }
      })
    return true
  }

  resetReorder()
  return true
}

export function resetReorder(): void {
  if (currentObserver) {
    currentObserver.disconnect()
    currentObserver = null
  }
  currentFilePath = null
  currentFileName = ''
  currentPageOrder = []
  originalPageCount = 0
  clearNativePdfCache().catch(() => {})

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
  originalPageCount = fileInfo.pageCount
  currentPageOrder = Array.from({ length: fileInfo.pageCount }, (_, i) => i)

  // Update header
  const nameEl = document.getElementById('file-name')
  if (nameEl) nameEl.textContent = fileInfo.fileName

  const metaEl = document.getElementById('file-meta')
  if (metaEl) {
    const sizeStr = fileInfo.fileSizeBytes ? ` · ${formatFileSize(fileInfo.fileSizeBytes)}` : ''
    metaEl.textContent = `${fileInfo.pageCount} páginas${sizeStr}`
  }

  // Show encrypted warning
  if (fileInfo.isEncrypted) {
    showNotification(
      'Este PDF tiene restricciones de seguridad. El resultado podría no preservar todas las protecciones.',
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
  const scrollContainer = document.getElementById('thumbnails-scroll')

  if (currentObserver) {
    currentObserver.disconnect()
    currentObserver = null
  }

  // Show loading
  grid.innerHTML = `
    <div class="loading-container" style="grid-column: 1 / -1">
      <div class="spinner"></div>
      <span class="loading-text">Cargando documento...</span>
    </div>
  `

  try {
    // Read file bytes from main process (direct binary Uint8Array)
    const arrayBuffer = await pdfService.readPdfFile(filePath)

    // Load with pdf.js
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer)
    }).promise

    grid.innerHTML = ''

    const renderedPages = new Set<number>()

    // Set up Lazy IntersectionObserver for high performance
    currentObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const card = entry.target as HTMLElement
            const pageIdx = parseInt(card.dataset.pageIndex!, 10)
            if (!renderedPages.has(pageIdx)) {
              renderedPages.add(pageIdx)
              renderSingleThumbnail(pdf, pageIdx, card)
            }
            currentObserver?.unobserve(card)
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: '300px 0px' // Pre-render 300px before scrolling into view
      }
    )

    // Build all skeleton cards instantly with DocumentFragment (1-2ms even for 100+ pages)
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < pageCount; i++) {
      const card = document.createElement('div')
      card.className = 'thumbnail-card'
      card.dataset.pageIndex = String(i)
      card.dataset.originalIndex = String(i)

      const imageDiv = document.createElement('div')
      imageDiv.className = 'thumbnail-image skeleton-thumb'

      const label = document.createElement('div')
      label.className = 'thumbnail-label'
      label.textContent = `Pág. ${i + 1}`

      card.appendChild(imageDiv)
      card.appendChild(label)
      fragment.appendChild(card)

      currentObserver.observe(card)
    }

    grid.appendChild(fragment)

    // Initialize SortableJS immediately
    Sortable.create(grid, {
      animation: 150,
      delay: 150,
      delayOnTouchOnly: true,
      ghostClass: 'thumbnail-ghost',
      chosenClass: 'thumbnail-chosen',
      dragClass: 'thumbnail-drag',
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

async function renderSingleThumbnail(pdf: any, pageIdx: number, card: HTMLElement): Promise<void> {
  try {
    // Try high-speed native Android PdfRenderer (C++ PDFium) first
    if (currentFilePath && isNativePdfSupported()) {
      const nativeSrc = await renderNativeThumbnail(currentFilePath, pageIdx, 320)
      if (nativeSrc) {
        const imageDiv = card.querySelector('.thumbnail-image')
        if (imageDiv) {
          imageDiv.innerHTML = ''
          imageDiv.classList.remove('skeleton-thumb')
          const img = document.createElement('img')
          img.src = nativeSrc
          img.loading = 'lazy'
          img.alt = `Pág. ${pageIdx + 1}`
          imageDiv.appendChild(img)
          return
        }
      }
    }

    // PDF.js fallback
    const page = await pdf.getPage(pageIdx + 1)
    const desiredWidth = 320
    const originalViewport = page.getViewport({ scale: 1 })
    const scale = desiredWidth / originalViewport.width
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)

    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise

    const imageDiv = card.querySelector('.thumbnail-image')
    if (imageDiv) {
      imageDiv.innerHTML = ''
      imageDiv.classList.remove('skeleton-thumb')
      imageDiv.appendChild(canvas)
    }
  } catch (renderErr) {
    console.warn(`Lazy render error on page ${pageIdx + 1}:`, renderErr)
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

async function handleSave(): Promise<void> {
  if (!currentFilePath) return

  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
  const originalText = saveBtn.innerHTML
  
  document.querySelectorAll('#action-bar button').forEach((b) => ((b as HTMLButtonElement).disabled = true))
  saveBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Preparando...`

  try {
    const tempResult = await pdfService.reorderPages(currentFilePath, currentPageOrder, undefined, true)

    if (!tempResult.success || !tempResult.outputPath) {
      showNotification(tempResult.error || 'Error al reordenar páginas', 'error')
      return
    }

    const fileInfo = await pdfService.getFileInfo(tempResult.outputPath)
    const fileSize = fileInfo ? formatFileSize(fileInfo.fileSizeBytes) : ''

    const base = currentFileName ? currentFileName.replace(/\.pdf$/i, '') : 'documento'
    const defaultName = `${base}_reordenado.pdf`

    const dialogResult = await pdfService.promptSaveDialog({
      defaultName,
      title: 'Guardar PDF Reordenado',
      fileSize,
      currentView: 'reorder'
    })

    if (!dialogResult) return // user cancelled

    if (dialogResult.action === 'save') {
      const copied = await pdfService.copyFile(
        tempResult.outputPath,
        dialogResult.fileName,
        dialogResult.customDirectory,
        dialogResult.directoryHandle
      )
      if (copied) {
        showNotification(`PDF guardado correctamente como ${dialogResult.fileName} (${tempResult.pageCount} páginas)`, 'success')
        await pdfService.promptSuccessModal({
          fileName: dialogResult.fileName,
          fileSize,
          pageCount: tempResult.pageCount,
          outputPath: dialogResult.fileName,
          destinationName: dialogResult.destinationName
        })
      } else {
        showNotification('Error al guardar el archivo', 'error')
      }
    } else if (dialogResult.action === 'chain') {
      if (fileInfo) {
        showNotification('Redirigiendo...', 'success')
        navigateTo(dialogResult.targetView, {
          fileInfo,
          returnTo: { view: 'reorder', payload: { restoreState: true } }
        })
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    showNotification(`Error: ${message}`, 'error')
  } finally {
    document.querySelectorAll('#action-bar button').forEach((b) => ((b as HTMLButtonElement).disabled = false))
    saveBtn.innerHTML = originalText
  }
}



