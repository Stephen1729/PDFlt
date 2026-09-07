import Sortable from 'sortablejs'
import { pdfService } from '../services/pdfService'
import { showNotification, navigateTo } from '../router'

interface CropRect {
  x: number // 0 to 1
  y: number // 0 to 1
  width: number // 0 to 1
  height: number // 0 to 1
}

interface ScannedPage {
  id: string
  originalDataUrl: string
  processedDataUrl: string
  rotation: number // 0, 90, 180, 270
  filter: 'raw' | 'bw' | 'color'
  crop: CropRect
}

let scannedPages: ScannedPage[] = []
let currentEditIndex = 0
let currentStage: 'drop' | 'edit' | 'cascade' = 'drop'
let isCropMode = false
let sortableInstance: Sortable | null = null

export function renderScan(container: HTMLElement): void {
  scannedPages = []
  currentEditIndex = 0
  currentStage = 'drop'
  isCropMode = false

  renderCurrentStage(container)
}

function renderCurrentStage(container: HTMLElement): void {
  if (currentStage === 'drop') {
    renderDropStage(container)
  } else if (currentStage === 'edit') {
    renderEditStage(container)
  } else if (currentStage === 'cascade') {
    renderCascadeStage(container)
  }
}

/* ═══════════════════════════════════════════
   ETAPA 0: Drop Zone Inicial
   ═══════════════════════════════════════════ */

function renderDropStage(container: HTMLElement): void {
  container.innerHTML = `
    <div id="drop-zone" class="drop-zone">
      <input type="file" id="image-file-input" accept="image/jpeg,image/png,image/webp,image/jpg" multiple style="display:none" />
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <h3>Foto a PDF</h3>
        <p>Toca para seleccionar fotos de la galería</p>
      </div>
    </div>
  `

  const dropZone = document.getElementById('drop-zone')!
  const fileInput = document.getElementById('image-file-input') as HTMLInputElement

  dropZone.addEventListener('click', () => fileInput.click())

  fileInput.addEventListener('change', async (e) => {
    const files = (e.target as HTMLInputElement).files
    if (files && files.length > 0) {
      await loadInitialImages(Array.from(files), container)
      fileInput.value = ''
    }
  })

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
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
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        await loadInitialImages(imageFiles, container)
      } else {
        showNotification('Selecciona archivos de imagen válidos', 'warning')
      }
    }
  })
}

async function loadInitialImages(files: File[], container: HTMLElement): Promise<void> {
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file)
    const page: ScannedPage = {
      id: `page_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      originalDataUrl: dataUrl,
      processedDataUrl: dataUrl,
      rotation: 0,
      filter: 'raw',
      crop: { x: 0, y: 0, width: 1, height: 1 }
    }
    // Process initial
    page.processedDataUrl = await processPageImage(page)
    scannedPages.push(page)
  }

  if (scannedPages.length > 0) {
    currentEditIndex = 0
    currentStage = 'edit'
    renderCurrentStage(container)
  }
}

/* ═══════════════════════════════════════════
   ETAPA 1: Editor Individual (Foto por Foto)
   ═══════════════════════════════════════════ */

function renderEditStage(container: HTMLElement): void {
  if (scannedPages.length === 0) {
    currentStage = 'drop'
    renderCurrentStage(container)
    return
  }

  const currentPage = scannedPages[currentEditIndex]

  container.innerHTML = `
    <div class="scan-editor-container">
      <!-- Top Header -->
      <div class="scan-editor-header">
        <button id="cancel-edit-btn" class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;">
          Cancelar
        </button>
        <span style="font-size: 0.95rem; font-weight: 600;">
          Foto ${currentEditIndex + 1} de ${scannedPages.length}
        </span>
        <button id="delete-current-btn" class="btn-icon" title="Eliminar foto" style="color: var(--error); width: 34px; height: 34px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>

      <!-- Main Image Viewport -->
      <div class="scan-editor-viewport">
        <div class="scan-editor-image-wrapper" id="editor-image-wrapper">
          <img id="editor-preview-img" src="${currentPage.processedDataUrl}" alt="Página" />
          <div id="crop-overlay-box" class="crop-overlay" style="display: ${isCropMode ? 'block' : 'none'};">
            <div class="crop-handle tl" data-corner="tl"></div>
            <div class="crop-handle tr" data-corner="tr"></div>
            <div class="crop-handle bl" data-corner="bl"></div>
            <div class="crop-handle br" data-corner="br"></div>
          </div>
        </div>
      </div>

      <!-- Controls & Filters Toolbar -->
      <div class="scan-editor-controls">
        <div class="scan-editor-toolbar">
          <!-- Rotate button -->
          <button id="rotate-btn" class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Rotar 90°
          </button>

          <!-- Crop toggle -->
          <button id="crop-toggle-btn" class="btn-secondary ${isCropMode ? 'active' : ''}" style="padding: 6px 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path>
              <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path>
            </svg>
            ${isCropMode ? 'Aplicar recorte' : 'Recortar'}
          </button>

          ${currentPage.crop.x > 0 || currentPage.crop.y > 0 || currentPage.crop.width < 1 || currentPage.crop.height < 1 ? `
            <button id="reset-crop-btn" class="btn-secondary" style="padding: 6px 10px; font-size: 0.8rem;" title="Restablecer recorte">
              Restablecer
            </button>
          ` : ''}

          <!-- Filters Group -->
          <div class="filter-btn-group">
            <button class="filter-btn ${currentPage.filter === 'raw' ? 'active' : ''}" data-filter="raw">En crudo</button>
            <button class="filter-btn ${currentPage.filter === 'bw' ? 'active' : ''}" data-filter="bw">Doc. B&N</button>
            <button class="filter-btn ${currentPage.filter === 'color' ? 'active' : ''}" data-filter="color">Color+</button>
          </div>
        </div>

        <!-- Footer / Navigation between pages & Next stage -->
        <div class="scan-editor-footer">
          <button id="prev-page-btn" class="btn-secondary" ${currentEditIndex === 0 ? 'disabled' : ''} style="padding: 8px 14px; font-size: 0.85rem;">
            ◀ Anterior
          </button>
          
          <button id="go-to-cascade-btn" class="btn-primary" style="padding: 8px 16px; font-size: 0.9rem;">
            Continuar (Etapa 2) ✓
          </button>

          <button id="next-page-btn" class="btn-secondary" ${currentEditIndex === scannedPages.length - 1 ? 'disabled' : ''} style="padding: 8px 14px; font-size: 0.85rem;">
            Siguiente ▶
          </button>
        </div>
      </div>
    </div>
  `

  setupEditStageListeners(container, currentPage)
}

function setupEditStageListeners(container: HTMLElement, currentPage: ScannedPage): void {
  // Cancel
  document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
    scannedPages = []
    currentStage = 'drop'
    renderCurrentStage(container)
  })

  // Delete current photo
  document.getElementById('delete-current-btn')?.addEventListener('click', () => {
    scannedPages.splice(currentEditIndex, 1)
    if (scannedPages.length === 0) {
      currentStage = 'drop'
    } else if (currentEditIndex >= scannedPages.length) {
      currentEditIndex = scannedPages.length - 1
    }
    isCropMode = false
    renderCurrentStage(container)
  })

  // Rotate
  document.getElementById('rotate-btn')?.addEventListener('click', async () => {
    currentPage.rotation = (currentPage.rotation + 90) % 360
    currentPage.processedDataUrl = await processPageImage(currentPage)
    const img = document.getElementById('editor-preview-img') as HTMLImageElement
    if (img) img.src = currentPage.processedDataUrl
  })

  // Crop toggle
  const cropBtn = document.getElementById('crop-toggle-btn')
  const cropBox = document.getElementById('crop-overlay-box')
  cropBtn?.addEventListener('click', async () => {
    if (!isCropMode) {
      isCropMode = true
      if (cropBox) cropBox.style.display = 'block'
      cropBtn.textContent = 'Aplicar recorte'
      cropBtn.classList.add('active')
    } else {
      isCropMode = false
      if (cropBox) cropBox.style.display = 'none'
      cropBtn.textContent = 'Recortar'
      cropBtn.classList.remove('active')
      // Apply crop
      currentPage.processedDataUrl = await processPageImage(currentPage)
      renderEditStage(container)
    }
  })

  // Reset crop
  document.getElementById('reset-crop-btn')?.addEventListener('click', async () => {
    currentPage.crop = { x: 0, y: 0, width: 1, height: 1 }
    currentPage.processedDataUrl = await processPageImage(currentPage)
    isCropMode = false
    renderEditStage(container)
  })

  // Setup crop handles dragging
  setupCropHandles(currentPage)

  // Filters
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      currentPage.filter = (btn as HTMLElement).dataset.filter as 'raw' | 'bw' | 'color'
      currentPage.processedDataUrl = await processPageImage(currentPage)
      const img = document.getElementById('editor-preview-img') as HTMLImageElement
      if (img) img.src = currentPage.processedDataUrl
    })
  })

  // Prev / Next
  document.getElementById('prev-page-btn')?.addEventListener('click', () => {
    if (currentEditIndex > 0) {
      currentEditIndex--
      isCropMode = false
      renderEditStage(container)
    }
  })

  document.getElementById('next-page-btn')?.addEventListener('click', () => {
    if (currentEditIndex < scannedPages.length - 1) {
      currentEditIndex++
      isCropMode = false
      renderEditStage(container)
    }
  })

  // Go to Stage 2: Cascade
  document.getElementById('go-to-cascade-btn')?.addEventListener('click', () => {
    isCropMode = false
    currentStage = 'cascade'
    renderCurrentStage(container)
  })
}

function setupCropHandles(page: ScannedPage): void {
  const cropBox = document.getElementById('crop-overlay-box')
  const wrapper = document.getElementById('editor-image-wrapper')
  if (!cropBox || !wrapper) return

  // Position cropBox based on page.crop percentage
  function updateCropBoxDom() {
    cropBox!.style.left = `${page.crop.x * 100}%`
    cropBox!.style.top = `${page.crop.y * 100}%`
    cropBox!.style.width = `${page.crop.width * 100}%`
    cropBox!.style.height = `${page.crop.height * 100}%`
  }
  updateCropBoxDom()

  let activeHandle: string | null = null
  let startX = 0
  let startY = 0
  let startCrop = { ...page.crop }

  const handles = cropBox.querySelectorAll('.crop-handle')
  handles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e: any) => {
      e.stopPropagation()
      activeHandle = (handle as HTMLElement).dataset.corner || null
      startX = e.clientX
      startY = e.clientY
      startCrop = { ...page.crop }
      ;(handle as HTMLElement).setPointerCapture(e.pointerId)
    })

    handle.addEventListener('pointermove', (e: any) => {
      if (!activeHandle) return
      const rect = wrapper.getBoundingClientRect()
      const dx = (e.clientX - startX) / rect.width
      const dy = (e.clientY - startY) / rect.height

      if (activeHandle === 'tl') {
        const newX = Math.max(0, Math.min(startCrop.x + startCrop.width - 0.1, startCrop.x + dx))
        const newY = Math.max(0, Math.min(startCrop.y + startCrop.height - 0.1, startCrop.y + dy))
        page.crop.width = startCrop.width - (newX - startCrop.x)
        page.crop.height = startCrop.height - (newY - startCrop.y)
        page.crop.x = newX
        page.crop.y = newY
      } else if (activeHandle === 'tr') {
        const newY = Math.max(0, Math.min(startCrop.y + startCrop.height - 0.1, startCrop.y + dy))
        page.crop.width = Math.min(1 - page.crop.x, Math.max(0.1, startCrop.width + dx))
        page.crop.height = startCrop.height - (newY - startCrop.y)
        page.crop.y = newY
      } else if (activeHandle === 'bl') {
        const newX = Math.max(0, Math.min(startCrop.x + startCrop.width - 0.1, startCrop.x + dx))
        page.crop.width = startCrop.width - (newX - startCrop.x)
        page.crop.height = Math.min(1 - page.crop.y, Math.max(0.1, startCrop.height + dy))
        page.crop.x = newX
      } else if (activeHandle === 'br') {
        page.crop.width = Math.min(1 - page.crop.x, Math.max(0.1, startCrop.width + dx))
        page.crop.height = Math.min(1 - page.crop.y, Math.max(0.1, startCrop.height + dy))
      }

      updateCropBoxDom()
    })

    handle.addEventListener('pointerup', (e: any) => {
      activeHandle = null
      try {
        ;(handle as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
    })
  })
}

/* ═══════════════════════════════════════════
   ETAPA 2: Previsualización en Cascada y Crear PDF
   ═══════════════════════════════════════════ */

function renderCascadeStage(container: HTMLElement): void {
  container.innerHTML = `
    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; height: 100%;">
      <!-- Hidden file input for adding more photos -->
      <input type="file" id="more-image-input" accept="image/jpeg,image/png,image/webp,image/jpg" multiple style="display:none" />

      <!-- Top Header -->
      <div style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-shrink: 0;">
        <span style="font-size: 0.95rem; font-weight: 600;">
          ${scannedPages.length} ${scannedPages.length === 1 ? 'página' : 'páginas'} en total
        </span>

        <button id="add-more-photos-btn" class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;">
          + Añadir fotos
        </button>
      </div>

      <div style="padding: 8px 16px; background: var(--bg-primary); border-bottom: 1px solid var(--border); font-size: 0.8rem; color: var(--text-muted); text-align: center;">
        Mantén presionado para arrastrar y reordenar las páginas.
      </div>

      <!-- Cascade / Grid area -->
      <div class="thumbnails-scroll" style="flex: 1; overflow-y: auto; padding: 16px;">
        <div id="cascade-grid" class="thumbnails-grid"></div>
      </div>

      <!-- Action Bar -->
      <div class="action-bar">
        <div class="action-buttons">
          <button id="clear-all-btn" class="btn-secondary">Borrar todo</button>
          
          <button id="create-pdf-btn" class="btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
              <path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/>
            </svg>
            Crear PDF (${scannedPages.length} pág)
          </button>

          <div id="cascade-chain-actions" class="chain-actions" style="display: none;">
            <button id="chain-compress-btn" class="btn-secondary">Comprimir</button>
            <button id="chain-merge-btn" class="btn-secondary">Unir</button>
            <button id="chain-split-btn" class="btn-secondary">Separar</button>
          </div>
        </div>
      </div>
    </div>
  `

  const grid = document.getElementById('cascade-grid')!
  const moreFileInput = document.getElementById('more-image-input') as HTMLInputElement
  const addMoreBtn = document.getElementById('add-more-photos-btn')!
  const clearAllBtn = document.getElementById('clear-all-btn')!
  const createPdfBtn = document.getElementById('create-pdf-btn') as HTMLButtonElement

  // Add more photos
  addMoreBtn.addEventListener('click', () => moreFileInput.click())
  moreFileInput.addEventListener('change', async (e) => {
    const files = (e.target as HTMLInputElement).files
    if (files && files.length > 0) {
      for (const file of Array.from(files)) {
        const dataUrl = await readFileAsDataUrl(file)
        const newPage: ScannedPage = {
          id: `page_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          originalDataUrl: dataUrl,
          processedDataUrl: dataUrl,
          rotation: 0,
          filter: 'raw',
          crop: { x: 0, y: 0, width: 1, height: 1 }
        }
        newPage.processedDataUrl = await processPageImage(newPage)
        scannedPages.push(newPage)
      }
      renderCascadeStage(container)
    }
  })

  // Clear all
  clearAllBtn.addEventListener('click', () => {
    scannedPages = []
    currentStage = 'drop'
    renderCurrentStage(container)
  })

  // Populate Grid
  grid.innerHTML = ''
  scannedPages.forEach((page, index) => {
    const card = document.createElement('div')
    card.className = 'thumbnail-card'
    card.dataset.id = page.id
    card.style.cssText = 'position: relative; display: flex; flex-direction: column; gap: 8px;'

    card.innerHTML = `
      <div class="thumbnail-image" style="background: #111; border-radius: 6px; overflow: hidden; height: 180px; display: flex; align-items: center; justify-content: center;">
        <img src="${page.processedDataUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span class="thumbnail-label" style="padding: 2px 8px; font-size: 0.75rem;">Pág. ${index + 1}</span>

        <div style="display: flex; gap: 4px;">
          <!-- Edit button -->
          <button class="edit-page-btn btn-icon" data-index="${index}" title="Editar esta foto" style="width: 30px; height: 30px; padding: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>

          <!-- Delete button -->
          <button class="delete-page-btn btn-icon" data-index="${index}" title="Eliminar" style="width: 30px; height: 30px; padding: 4px; color: var(--error);">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    `

    grid.appendChild(card)
  })

  // Bind Edit & Delete buttons
  grid.querySelectorAll('.edit-page-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      currentEditIndex = parseInt((btn as HTMLElement).dataset.index || '0', 10)
      currentStage = 'edit'
      renderCurrentStage(container)
    })
  })

  grid.querySelectorAll('.delete-page-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const idx = parseInt((btn as HTMLElement).dataset.index || '0', 10)
      scannedPages.splice(idx, 1)
      if (scannedPages.length === 0) {
        currentStage = 'drop'
        renderCurrentStage(container)
      } else {
        renderCascadeStage(container)
      }
    })
  })

  // Sortable with delay for touch scrolling
  if (sortableInstance) sortableInstance.destroy()
  sortableInstance = Sortable.create(grid, {
    animation: 150,
    delay: 150,
    delayOnTouchOnly: true,
    ghostClass: 'thumbnail-ghost',
    chosenClass: 'thumbnail-chosen',
    dragClass: 'thumbnail-drag',
    onEnd: (evt) => {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        const item = scannedPages.splice(evt.oldIndex, 1)[0]
        scannedPages.splice(evt.newIndex, 0, item)
        // Refresh labels
        grid.querySelectorAll('.thumbnail-card').forEach((c, idx) => {
          const lbl = c.querySelector('.thumbnail-label')
          if (lbl) lbl.textContent = `Pág. ${idx + 1}`
          const editBtn = c.querySelector('.edit-page-btn') as HTMLElement
          const delBtn = c.querySelector('.delete-page-btn') as HTMLElement
          if (editBtn) editBtn.dataset.index = String(idx)
          if (delBtn) delBtn.dataset.index = String(idx)
        })
      }
    }
  })

  // Create PDF Handler
  createPdfBtn.addEventListener('click', async () => {
    if (scannedPages.length === 0) return

    const originalHtml = createPdfBtn.innerHTML
    createPdfBtn.disabled = true
    createPdfBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Generando PDF...`

    try {
      const imagesDataUrls = scannedPages.map((p) => p.processedDataUrl)
      const result = await pdfService.createPdfFromImages(imagesDataUrls)

      if (result.success && result.outputPath) {
        showNotification(`PDF generado con éxito (${result.pageCount} páginas)`, 'success')

        // Show chain actions
        const chainActions = document.getElementById('cascade-chain-actions')!
        chainActions.style.display = 'flex'

        const fileInfo = await pdfService.getFileInfo(result.outputPath)
        if (fileInfo) {
          document.getElementById('chain-compress-btn')?.addEventListener('click', () => {
            navigateTo('compress', { fileInfo })
          })
          document.getElementById('chain-merge-btn')?.addEventListener('click', () => {
            navigateTo('merge', { fileInfo })
          })
          document.getElementById('chain-split-btn')?.addEventListener('click', () => {
            navigateTo('split', { fileInfo })
          })
        }
      } else {
        showNotification(result.error || 'Error al generar el PDF', 'error')
      }
    } catch (err: any) {
      showNotification(err.message || 'Error inesperado al crear PDF', 'error')
    } finally {
      createPdfBtn.disabled = false
      createPdfBtn.innerHTML = originalHtml
    }
  })
}

/* ═══════════════════════════════════════════
   Procesador de Imagen (Canvas + Crop + Filtros)
   ═══════════════════════════════════════════ */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function processPageImage(page: ScannedPage): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // 1. Calculate Crop bounds in source image pixels
      const sx = Math.max(0, Math.round(page.crop.x * img.width))
      const sy = Math.max(0, Math.round(page.crop.y * img.height))
      const sw = Math.min(img.width - sx, Math.round(page.crop.width * img.width))
      const sh = Math.min(img.height - sy, Math.round(page.crop.height * img.height))

      // 2. Downsample if needed (max 1800px for balance between sharpness and performance)
      let targetW = sw
      let targetH = sh
      const maxDim = 1800
      if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
          targetH = Math.round((targetH * maxDim) / targetW)
          targetW = maxDim
        } else {
          targetW = Math.round((targetW * maxDim) / targetH)
          targetH = maxDim
        }
      }

      // 3. Setup canvas with rotation
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      const isRotated = page.rotation === 90 || page.rotation === 270
      canvas.width = isRotated ? targetH : targetW
      canvas.height = isRotated ? targetW : targetH

      ctx.save()
      if (page.rotation === 90) {
        ctx.translate(canvas.width, 0)
        ctx.rotate((90 * Math.PI) / 180)
      } else if (page.rotation === 180) {
        ctx.translate(canvas.width, canvas.height)
        ctx.rotate((180 * Math.PI) / 180)
      } else if (page.rotation === 270) {
        ctx.translate(0, canvas.height)
        ctx.rotate((270 * Math.PI) / 180)
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH)
      ctx.restore()

      // 4. Filters
      if (page.filter !== 'raw') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const d = imgData.data

        for (let i = 0; i < d.length; i += 4) {
          const r = d[i]
          const g = d[i + 1]
          const b = d[i + 2]
          const gray = 0.299 * r + 0.587 * g + 0.114 * b

          if (page.filter === 'bw') {
            // Scanner document effect: clean paper background -> pure white 255. Text ink -> darker.
            let val = gray
            if (val > 140) {
              val = 255
            } else {
              val = Math.max(0, val * 0.7)
            }
            d[i] = val
            d[i + 1] = val
            d[i + 2] = val
          } else if (page.filter === 'color') {
            // Color enhanced: brighten whites while keeping colors saturated
            const factor = 1.22
            d[i] = Math.min(255, Math.max(0, (r - 128) * factor + 128 + 18))
            d[i + 1] = Math.min(255, Math.max(0, (g - 128) * factor + 128 + 18))
            d[i + 2] = Math.min(255, Math.max(0, (b - 128) * factor + 128 + 18))
          }
        }
        ctx.putImageData(imgData, 0, 0)
      }

      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.src = page.originalDataUrl
  })
}
