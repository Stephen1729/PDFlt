import Sortable from 'sortablejs'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
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
   Cámara / Captura de Imagen
   ═══════════════════════════════════════════ */

async function takePhoto(): Promise<string | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 92,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera
    })
    return photo.dataUrl || null
  } catch (err: any) {
    const msg = err?.message || ''
    if (msg.includes('cancelled') || msg.includes('User cancelled') || msg.includes('dismissed')) {
      return null
    }
    console.warn('Camera plugin error, attempting fallback:', err)
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.capture = 'environment'
      input.onchange = async () => {
        if (input.files && input.files[0]) {
          const dataUrl = await readFileAsDataUrl(input.files[0])
          resolve(dataUrl)
        } else {
          resolve(null)
        }
      }
      input.click()
    })
  }
}

async function startBatchCameraSession(onFinish: (photos: string[]) => void): Promise<void> {
  const batchPhotos: string[] = []

  const firstPhoto = await takePhoto()
  if (!firstPhoto) return

  batchPhotos.push(firstPhoto)
  showBatchModal()

  function showBatchModal() {
    document.getElementById('batch-camera-overlay')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'batch-camera-overlay'
    overlay.className = 'modal-backdrop'
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 16px;
    `

    overlay.innerHTML = `
      <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; padding: 20px; width: 100%; max-width: 360px; box-shadow: 0 12px 30px rgba(0,0,0,0.45); display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            Fotos tomadas: <strong style="color: var(--primary);">${batchPhotos.length}</strong>
          </h3>
          <button id="batch-cancel-btn" style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: var(--text-muted); padding: 4px 8px; line-height: 1;" title="Descartar">✕</button>
        </div>

        <div style="display: flex; gap: 10px; overflow-x: auto; padding: 8px 4px 14px; scrollbar-width: thin;">
          ${batchPhotos
            .map(
              (url, idx) => `
            <div style="position: relative; flex-shrink: 0; width: 72px; height: 96px; border-radius: 8px; overflow: hidden; border: 2px solid var(--border); background: #000;">
              <img src="${url}" style="width: 100%; height: 100%; object-fit: cover;" />
              <span style="position: absolute; bottom: 2px; left: 2px; background: rgba(0,0,0,0.75); color: #fff; font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; font-weight: 600;">#${idx + 1}</span>
              <button class="batch-del-btn" data-idx="${idx}" style="position: absolute; top: 2px; right: 2px; background: rgba(220,38,38,0.9); color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1;" title="Eliminar foto">✕</button>
            </div>
          `
            )
            .join('')}
        </div>

        <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0 0 16px; text-align: center;">
          ${batchPhotos.length === 1 ? '¿Deseas tomar otra página o continuar?' : 'Páginas listas para importar al documento.'}
        </p>

        <div style="display: flex; gap: 10px;">
          <button id="batch-take-another-btn" class="btn-secondary" style="flex: 1; padding: 12px 8px; font-size: 0.88rem; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            + Tomar otra
          </button>

          <button id="batch-done-btn" class="btn-primary" style="flex: 1; padding: 12px 8px; font-size: 0.88rem; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Importar (${batchPhotos.length})
          </button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    overlay.querySelectorAll('.batch-del-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10)
        batchPhotos.splice(idx, 1)
        if (batchPhotos.length === 0) {
          overlay.remove()
        } else {
          showBatchModal()
        }
      })
    })

    document.getElementById('batch-take-another-btn')?.addEventListener('click', async () => {
      overlay.style.display = 'none'
      const nextPhoto = await takePhoto()
      if (nextPhoto) {
        batchPhotos.push(nextPhoto)
      }
      showBatchModal()
    })

    document.getElementById('batch-cancel-btn')?.addEventListener('click', () => {
      overlay.remove()
    })

    document.getElementById('batch-done-btn')?.addEventListener('click', () => {
      overlay.remove()
      if (batchPhotos.length > 0) {
        onFinish(batchPhotos)
      }
    })
  }
}

/* ═══════════════════════════════════════════
   ETAPA 0: Drop Zone Inicial
   ═══════════════════════════════════════════ */

function renderDropStage(container: HTMLElement): void {
  container.innerHTML = `
    <input type="file" id="image-file-input" accept="image/*" multiple style="display:none" />
    <div id="drop-zone" class="drop-zone" style="display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 24px; padding: 36px 16px; min-height: 280px;">
      <div class="drop-zone-content" style="pointer-events: none;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary); margin-bottom: 8px;">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <h3 style="font-size: 1.25rem; margin-bottom: 4px;">Foto a PDF</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Captura varias páginas con tu cámara o elige de la galería</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 280px; z-index: 2;">
        <button id="camera-btn" class="btn-primary" style="padding: 13px 18px; font-size: 0.95rem; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          Tomar fotos
        </button>

        <button id="gallery-btn" class="btn-secondary" style="padding: 13px 18px; font-size: 0.95rem; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          Elegir de galería
        </button>
      </div>
    </div>
  `

  const dropZone = document.getElementById('drop-zone')!
  const fileInput = document.getElementById('image-file-input') as HTMLInputElement
  const cameraBtn = document.getElementById('camera-btn')!
  const galleryBtn = document.getElementById('gallery-btn')!

  cameraBtn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    await startBatchCameraSession((photos) => {
      for (const dataUrl of photos) {
        const page: ScannedPage = {
          id: `page_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          originalDataUrl: dataUrl,
          processedDataUrl: dataUrl,
          rotation: 0,
          filter: 'raw',
          crop: { x: 0, y: 0, width: 1, height: 1 }
        }
        scannedPages.push(page)
      }
      if (scannedPages.length > 0) {
        currentEditIndex = 0
        currentStage = 'edit'
        renderCurrentStage(container)
      }
    })
  })

  galleryBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    fileInput.click()
  })

  fileInput.addEventListener('click', (e) => {
    e.stopPropagation()
  })

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
      const imageFiles = Array.from(files).filter(
        (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i.test(f.name)
      )
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
            <button class="filter-btn ${currentPage.filter === 'raw' ? 'active' : ''}" data-filter="raw">Original</button>
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
            Continuar
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
  const img = document.getElementById('editor-preview-img') as HTMLImageElement
  const viewport = container.querySelector('.scan-editor-viewport') as HTMLElement
  const wrapper = document.getElementById('editor-image-wrapper') as HTMLElement

  function adjustImageBounds() {
    if (!viewport || !img || !wrapper) return
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh) return

    // Available inner area inside viewport (padding 24px + 6px safety margin for handles)
    const pad = 24
    const availW = Math.max(60, viewport.clientWidth - pad * 2)
    const availH = Math.max(60, viewport.clientHeight - pad * 2)

    const aspect = nw / nh
    let renderW = availW
    let renderH = Math.round(renderW / aspect)

    if (renderH > availH) {
      renderH = availH
      renderW = Math.round(renderH * aspect)
    }

    wrapper.style.width = `${renderW}px`
    wrapper.style.height = `${renderH}px`
    img.style.width = `${renderW}px`
    img.style.height = `${renderH}px`
    img.style.maxWidth = 'none'
    img.style.maxHeight = 'none'
  }

  if (img) {
    if (img.complete && img.naturalWidth > 0) {
      adjustImageBounds()
    } else {
      img.onload = () => adjustImageBounds()
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    adjustImageBounds()
  })
  if (viewport) {
    resizeObserver.observe(viewport)
  }
  window.addEventListener('resize', adjustImageBounds, { passive: true })

  // Cancel
  document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
    scannedPages = []
    currentStage = 'drop'
    renderCurrentStage(container)
  })

  // Delete current photo
  document.getElementById('delete-current-btn')?.addEventListener('click', () => {
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
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
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
    currentPage.rotation = (currentPage.rotation + 90) % 360
    currentPage.crop = { x: 0, y: 0, width: 1, height: 1 }
    isCropMode = false
    currentPage.processedDataUrl = await processPageImage(currentPage)
    renderEditStage(container)
  })

  // Crop toggle
  const cropBtn = document.getElementById('crop-toggle-btn')
  const cropBox = document.getElementById('crop-overlay-box')
  cropBtn?.addEventListener('click', async () => {
    if (!isCropMode) {
      isCropMode = true
      // Show full uncropped photo while editing crop
      const fullUrl = await processPageImage({
        ...currentPage,
        crop: { x: 0, y: 0, width: 1, height: 1 }
      })
      if (img) {
        img.onload = () => {
          adjustImageBounds()
          setupCropHandles(currentPage)
        }
        img.src = fullUrl
      }
      if (cropBox) cropBox.style.display = 'block'
      cropBtn.textContent = 'Aplicar recorte'
      cropBtn.classList.add('active')
      setupCropHandles(currentPage)
    } else {
      resizeObserver.disconnect()
      window.removeEventListener('resize', adjustImageBounds)
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
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
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
      if (isCropMode) {
        const fullUrl = await processPageImage({
          ...currentPage,
          crop: { x: 0, y: 0, width: 1, height: 1 }
        })
        if (img) img.src = fullUrl
      } else {
        currentPage.processedDataUrl = await processPageImage(currentPage)
        if (img) img.src = currentPage.processedDataUrl
      }
    })
  })

  // Prev / Next
  document.getElementById('prev-page-btn')?.addEventListener('click', async () => {
    if (currentEditIndex > 0) {
      resizeObserver.disconnect()
      window.removeEventListener('resize', adjustImageBounds)
      if (isCropMode) {
        currentPage.processedDataUrl = await processPageImage(currentPage)
        isCropMode = false
      }
      currentEditIndex--
      renderEditStage(container)
    }
  })

  document.getElementById('next-page-btn')?.addEventListener('click', async () => {
    if (currentEditIndex < scannedPages.length - 1) {
      resizeObserver.disconnect()
      window.removeEventListener('resize', adjustImageBounds)
      if (isCropMode) {
        currentPage.processedDataUrl = await processPageImage(currentPage)
        isCropMode = false
      }
      currentEditIndex++
      renderEditStage(container)
    }
  })

  // Go to Stage 2: Cascade
  document.getElementById('go-to-cascade-btn')?.addEventListener('click', async () => {
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
    if (isCropMode) {
      currentPage.processedDataUrl = await processPageImage(currentPage)
      isCropMode = false
    }
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

  let dragMode: 'corner' | 'move' | null = null
  let activeCorner: string | null = null
  let startX = 0
  let startY = 0
  let startCrop = { ...page.crop }

  // 1. Corner Handles dragging
  const handles = cropBox.querySelectorAll('.crop-handle')
  handles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e: any) => {
      e.stopPropagation()
      dragMode = 'corner'
      activeCorner = (handle as HTMLElement).dataset.corner || null
      startX = e.clientX
      startY = e.clientY
      startCrop = { ...page.crop }
      ;(handle as HTMLElement).setPointerCapture(e.pointerId)
    })

    handle.addEventListener('pointermove', (e: any) => {
      if (dragMode !== 'corner' || !activeCorner) return
      const rect = wrapper.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const dx = (e.clientX - startX) / rect.width
      const dy = (e.clientY - startY) / rect.height
      const minSize = 0.08

      if (activeCorner === 'tl') {
        const newX = Math.max(0, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + dx))
        const newY = Math.max(0, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + dy))
        page.crop.width = startCrop.width - (newX - startCrop.x)
        page.crop.height = startCrop.height - (newY - startCrop.y)
        page.crop.x = newX
        page.crop.y = newY
      } else if (activeCorner === 'tr') {
        const newY = Math.max(0, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + dy))
        page.crop.width = Math.min(1 - startCrop.x, Math.max(minSize, startCrop.width + dx))
        page.crop.height = startCrop.height - (newY - startCrop.y)
        page.crop.y = newY
      } else if (activeCorner === 'bl') {
        const newX = Math.max(0, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + dx))
        page.crop.width = startCrop.width - (newX - startCrop.x)
        page.crop.height = Math.min(1 - startCrop.y, Math.max(minSize, startCrop.height + dy))
        page.crop.x = newX
      } else if (activeCorner === 'br') {
        page.crop.width = Math.min(1 - startCrop.x, Math.max(minSize, startCrop.width + dx))
        page.crop.height = Math.min(1 - startCrop.y, Math.max(minSize, startCrop.height + dy))
      }

      updateCropBoxDom()
    })

    const endDrag = (e: any) => {
      if (dragMode === 'corner') {
        dragMode = null
        activeCorner = null
        try {
          ;(handle as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {}
      }
    }
    handle.addEventListener('pointerup', endDrag)
    handle.addEventListener('pointercancel', endDrag)
  })

  // 2. Dragging inside the crop box to MOVE it
  cropBox.addEventListener('pointerdown', (e: any) => {
    if ((e.target as HTMLElement).classList.contains('crop-handle')) return

    // Safety corner margin: do not trigger move if click is within corner hit zones
    const boxRect = cropBox.getBoundingClientRect()
    const relX = e.clientX - boxRect.left
    const relY = e.clientY - boxRect.top
    const cornerSize = Math.min(36, Math.min(boxRect.width, boxRect.height) * 0.35)
    const isNearCorner =
      (relX < cornerSize && relY < cornerSize) ||
      (relX > boxRect.width - cornerSize && relY < cornerSize) ||
      (relX < cornerSize && relY > boxRect.height - cornerSize) ||
      (relX > boxRect.width - cornerSize && relY > boxRect.height - cornerSize)

    if (isNearCorner) return

    e.stopPropagation()
    dragMode = 'move'
    startX = e.clientX
    startY = e.clientY
    startCrop = { ...page.crop }
    cropBox.setPointerCapture(e.pointerId)
  })

  cropBox.addEventListener('pointermove', (e: any) => {
    if (dragMode !== 'move') return
    const rect = wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const dx = (e.clientX - startX) / rect.width
    const dy = (e.clientY - startY) / rect.height

    let newX = startCrop.x + dx
    let newY = startCrop.y + dy

    newX = Math.max(0, Math.min(1 - startCrop.width, newX))
    newY = Math.max(0, Math.min(1 - startCrop.height, newY))

    page.crop.x = newX
    page.crop.y = newY
    updateCropBoxDom()
  })

  const endMove = (e: any) => {
    if (dragMode === 'move') {
      dragMode = null
      try {
        cropBox.releasePointerCapture(e.pointerId)
      } catch {}
    }
  }
  cropBox.addEventListener('pointerup', endMove)
  cropBox.addEventListener('pointercancel', endMove)
}

/* ═══════════════════════════════════════════
   ETAPA 2: Previsualización en Cascada y Crear PDF
   ═══════════════════════════════════════════ */

function renderCascadeStage(container: HTMLElement): void {
  container.innerHTML = `
    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; height: 100%;">
      <!-- Hidden file input for adding more photos -->
      <input type="file" id="more-image-input" accept="image/*" multiple style="display:none" />

      <!-- Top Header -->
      <div style="padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-shrink: 0; gap: 8px;">
        <span style="font-size: 0.9rem; font-weight: 600; white-space: nowrap;">
          ${scannedPages.length} ${scannedPages.length === 1 ? 'pág' : 'págs'}
        </span>

        <div style="display: flex; gap: 8px;">
          <button id="cascade-camera-btn" class="btn-primary" style="padding: 6px 12px; font-size: 0.82rem; display: flex; align-items: center; gap: 6px; border-radius: 8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            + Cámara
          </button>

          <button id="add-more-photos-btn" class="btn-secondary" style="padding: 6px 12px; font-size: 0.82rem; display: flex; align-items: center; gap: 6px; border-radius: 8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            + Galería
          </button>
        </div>
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
        <div style="width: 100%; display: flex; justify-content: center; margin-bottom: 8px;">
          <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--text-secondary); cursor: pointer; user-select: none;">
            <input type="checkbox" id="fit-image-checkbox" checked style="accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer;" />
            <span>Ajustar página a la imagen (sin bordes blancos)</span>
          </label>
        </div>
        <div class="action-buttons">
          <button id="clear-all-btn" class="btn-secondary">Borrar todo</button>
          
          <button id="save-pdf-btn" class="btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Guardar PDF (${scannedPages.length} pág)
          </button>

          <div class="chain-actions">
            <span>o continuar en:</span>
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
  const savePdfBtn = document.getElementById('save-pdf-btn') as HTMLButtonElement
  const cascadeCameraBtn = document.getElementById('cascade-camera-btn')

  // Add more photos via camera (batch session)
  cascadeCameraBtn?.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    await startBatchCameraSession((photos) => {
      for (const dataUrl of photos) {
        const newPage: ScannedPage = {
          id: `page_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          originalDataUrl: dataUrl,
          processedDataUrl: dataUrl,
          rotation: 0,
          filter: 'raw',
          crop: { x: 0, y: 0, width: 1, height: 1 }
        }
        scannedPages.push(newPage)
      }
      renderCascadeStage(container)
    })
  })

  // Add more photos via gallery
  addMoreBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    moreFileInput.click()
  })
  moreFileInput.addEventListener('click', (e) => {
    e.stopPropagation()
  })
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
        scannedPages.push(newPage)
      }
      moreFileInput.value = ''
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

  // Save PDF Handler (Direct)
  savePdfBtn.addEventListener('click', async () => {
    if (scannedPages.length === 0) return

    const dateStr = new Date().toISOString().slice(0, 10)
    const defaultName = `PDFlt_Escaneo_${dateStr}.pdf`
    const fileName = await pdfService.saveFileDialog(defaultName, 'Guardar PDF')
    if (!fileName) return

    const originalHtml = savePdfBtn.innerHTML
    savePdfBtn.disabled = true
    savePdfBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Guardando...`

    try {
      const fitCheckbox = document.getElementById('fit-image-checkbox') as HTMLInputElement | null
      const fitToImage = fitCheckbox ? fitCheckbox.checked : true
      const imagesDataUrls = scannedPages.map((p) => p.processedDataUrl)
      const result = await pdfService.createPdfFromImages(imagesDataUrls, fileName, false, { fitToImage })

      if (result.success && result.outputPath) {
        showNotification(`PDF guardado correctamente como ${fileName} (${result.pageCount} páginas)`, 'success')
      } else {
        showNotification(result.error || 'Error al guardar el PDF', 'error')
      }
    } catch (err: any) {
      showNotification(err.message || 'Error inesperado al guardar PDF', 'error')
    } finally {
      savePdfBtn.disabled = false
      savePdfBtn.innerHTML = originalHtml
    }
  })

  // Direct Chain Handlers
  const handleChainAction = async (targetView: 'compress' | 'merge' | 'split') => {
    if (scannedPages.length === 0) return

    const originalHtml = savePdfBtn.innerHTML
    savePdfBtn.disabled = true
    savePdfBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Preparando...`

    try {
      const fitCheckbox = document.getElementById('fit-image-checkbox') as HTMLInputElement | null
      const fitToImage = fitCheckbox ? fitCheckbox.checked : true
      const imagesDataUrls = scannedPages.map((p) => p.processedDataUrl)
      const result = await pdfService.createPdfFromImages(imagesDataUrls, undefined, true, { fitToImage })

      if (result.success && result.outputPath) {
        const fileInfo = await pdfService.getFileInfo(result.outputPath)
        if (fileInfo) {
          showNotification('Redirigiendo...', 'success')
          navigateTo(targetView, { fileInfo })
        }
      } else {
        showNotification(result.error || 'Error al preparar PDF', 'error')
      }
    } catch (err: any) {
      showNotification(err.message || 'Error al preparar PDF', 'error')
    } finally {
      savePdfBtn.disabled = false
      savePdfBtn.innerHTML = originalHtml
    }
  }

  document.getElementById('chain-compress-btn')?.addEventListener('click', () => handleChainAction('compress'))
  document.getElementById('chain-merge-btn')?.addEventListener('click', () => handleChainAction('merge'))
  document.getElementById('chain-split-btn')?.addEventListener('click', () => handleChainAction('split'))
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
  // If raw, no rotation, and full crop, return original dataUrl directly (fast & no canvas loss)
  if (
    page.filter === 'raw' &&
    page.rotation === 0 &&
    page.crop.x === 0 &&
    page.crop.y === 0 &&
    page.crop.width === 1 &&
    page.crop.height === 1
  ) {
    return Promise.resolve(page.originalDataUrl)
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.onerror = () => {
      resolve(page.originalDataUrl)
    }
    img.onload = () => {
      // 1. Rotate source image onto an intermediate canvas
      const isRotated = page.rotation === 90 || page.rotation === 270
      const rotCanvas = document.createElement('canvas')
      rotCanvas.width = isRotated ? img.height : img.width
      rotCanvas.height = isRotated ? img.width : img.height
      const rotCtx = rotCanvas.getContext('2d')!

      rotCtx.save()
      if (page.rotation === 90) {
        rotCtx.translate(rotCanvas.width, 0)
        rotCtx.rotate((90 * Math.PI) / 180)
      } else if (page.rotation === 180) {
        rotCtx.translate(rotCanvas.width, rotCanvas.height)
        rotCtx.rotate((180 * Math.PI) / 180)
      } else if (page.rotation === 270) {
        rotCtx.translate(0, rotCanvas.height)
        rotCtx.rotate((270 * Math.PI) / 180)
      }
      rotCtx.drawImage(img, 0, 0)
      rotCtx.restore()

      // 2. Calculate crop bounds on the rotated image
      const sx = Math.max(0, Math.round(page.crop.x * rotCanvas.width))
      const sy = Math.max(0, Math.round(page.crop.y * rotCanvas.height))
      const sw = Math.min(rotCanvas.width - sx, Math.round(page.crop.width * rotCanvas.width))
      const sh = Math.min(rotCanvas.height - sy, Math.round(page.crop.height * rotCanvas.height))

      // 3. Downsample if needed (max 1800px for balance between sharpness and performance)
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

      // 4. Draw cropped region to final canvas
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, targetW, targetH)

      // 5. Filters
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
