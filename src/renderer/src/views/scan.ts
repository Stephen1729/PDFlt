import Sortable from 'sortablejs'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { pdfService, formatFileSize } from '../services/pdfService'
import { showNotification, navigateTo } from '../router'

export interface Point {
  x: number // 0 to 1
  y: number // 0 to 1
}

export interface CropQuad {
  tl: Point // Top-Left
  tr: Point // Top-Right
  br: Point // Bottom-Right
  bl: Point // Bottom-Left
}

export function getDefaultCrop(): CropQuad {
  return {
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 }
  }
}

export function isDefaultCrop(crop: CropQuad): boolean {
  if (!crop || !crop.tl || !crop.tr || !crop.br || !crop.bl) return true
  const eps = 0.005
  return (
    Math.abs(crop.tl.x - 0) < eps &&
    Math.abs(crop.tl.y - 0) < eps &&
    Math.abs(crop.tr.x - 1) < eps &&
    Math.abs(crop.tr.y - 0) < eps &&
    Math.abs(crop.br.x - 1) < eps &&
    Math.abs(crop.br.y - 1) < eps &&
    Math.abs(crop.bl.x - 0) < eps &&
    Math.abs(crop.bl.y - 1) < eps
  )
}

interface ScannedPage {
  id: string
  originalDataUrl: string
  processedDataUrl: string
  rotation: number // 0, 90, 180, 270
  filter: 'raw' | 'bw' | 'color'
  crop: CropQuad
}

let scannedPages: ScannedPage[] = []
let currentEditIndex = 0
let currentStage: 'drop' | 'edit' | 'cascade' = 'drop'
let editOriginStage: 'drop' | 'cascade' = 'drop'
let isCropMode = false
let sortableInstance: Sortable | null = null
let scanContainer: HTMLElement | null = null

export function renderScan(container: HTMLElement, payload?: any): void {
  scanContainer = container
  if (payload?.restoreState && scannedPages.length > 0) {
    currentStage = 'cascade'
    renderCurrentStage(container)
    return
  }

  scannedPages = []
  currentEditIndex = 0
  currentStage = 'drop'
  editOriginStage = 'drop'
  isCropMode = false

  renderCurrentStage(container)
}

export function handleScanBack(): boolean {
  if (!scanContainer) return false

  if (currentStage === 'drop') {
    return false
  }

  if (currentStage === 'edit') {
    if (isCropMode) {
      isCropMode = false
      renderEditStage(scanContainer)
      return true
    }
    if (editOriginStage === 'cascade') {
      currentStage = 'cascade'
      renderCurrentStage(scanContainer)
      return true
    }
    scannedPages = []
    currentStage = 'drop'
    renderCurrentStage(scanContainer)
    return true
  }

  if (currentStage === 'cascade') {
    currentStage = 'edit'
    currentEditIndex = scannedPages.length > 0 ? scannedPages.length - 1 : 0
    editOriginStage = 'drop'
    renderCurrentStage(scanContainer)
    return true
  }

  return false
}

function updateHeaderVisibility(stage: 'drop' | 'edit' | 'cascade'): void {
  // Mobile header should ONLY appear in stage 0 (drop/welcome)
  // In stage 1 (editor) and stage 2 (cascade), hide it to maximize screen area
  if (stage === 'drop') {
    document.body.classList.remove('hide-mobile-header')
  } else {
    document.body.classList.add('hide-mobile-header')
  }
}

function renderCurrentStage(container: HTMLElement): void {
  updateHeaderVisibility(currentStage)

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
    <div id="drop-zone" style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 28px; padding: 32px 20px; width: 100%; max-width: 420px; margin: 0 auto; text-align: center;">
      <div style="display: flex; flex-direction: column; align-items: center;">
        <div style="width: 72px; height: 72px; border-radius: 20px; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; color: var(--primary);">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
        </div>
        <h3 style="font-size: 1.35rem; font-weight: 700; margin: 0 0 6px; color: var(--text-primary);">Foto a PDF</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin: 0; max-width: 260px;">Captura páginas con tu cámara o impórtalas desde la galería</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 280px; z-index: 2;">
        <button id="camera-btn" class="btn-primary" style="padding: 14px 20px; font-size: 1rem; border-radius: 14px; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          Tomar fotos
        </button>

        <button id="gallery-btn" class="btn-secondary" style="padding: 14px 20px; font-size: 1rem; border-radius: 14px; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; background: var(--bg-secondary); border: 1px solid var(--border);">
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
          crop: getDefaultCrop()
        }
        scannedPages.push(page)
      }
      if (scannedPages.length > 0) {
        currentEditIndex = 0
        currentStage = 'edit'
        editOriginStage = 'drop'
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
      crop: getDefaultCrop()
    }
    scannedPages.push(page)
  }

  if (scannedPages.length > 0) {
    currentEditIndex = 0
    currentStage = 'edit'
    editOriginStage = 'drop'
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
        <button id="cancel-edit-btn" class="btn-secondary" style="padding: 8px 14px; font-size: 0.85rem; min-height: 40px; touch-action: manipulation;">
          Cancelar
        </button>
        <span style="font-size: 0.95rem; font-weight: 600;">
          Foto ${currentEditIndex + 1} de ${scannedPages.length}
        </span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="editor-camera-btn" class="btn-primary" style="padding: 8px 14px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; border-radius: 8px; min-height: 40px; touch-action: manipulation;" title="Tomar más fotos con la cámara">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            + Cámara
          </button>
          <button id="delete-current-btn" class="btn-icon" title="Eliminar foto" style="color: var(--error); width: 40px; height: 40px; min-width: 40px; min-height: 40px; display: flex; align-items: center; justify-content: center; touch-action: manipulation;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Main Image Viewport -->
      <div class="scan-editor-viewport">
        <div class="scan-editor-image-wrapper" id="editor-image-wrapper">
          <img id="editor-preview-img" src="${currentPage.processedDataUrl}" alt="Página" />
          <div id="crop-overlay-box" class="crop-quad-overlay" style="display: ${isCropMode ? 'block' : 'none'};">
            <svg id="crop-svg" class="crop-svg">
              <path id="crop-mask-path" fill="rgba(0, 0, 0, 0.55)" fill-rule="evenodd"></path>
              <polygon id="crop-quad-fill" fill="rgba(99, 102, 241, 0.12)" style="cursor: move; pointer-events: auto;"></polygon>
              <line id="crop-grid-h1" stroke="rgba(255, 255, 255, 0.35)" stroke-width="1" stroke-dasharray="4,4"></line>
              <line id="crop-grid-h2" stroke="rgba(255, 255, 255, 0.35)" stroke-width="1" stroke-dasharray="4,4"></line>
              <line id="crop-grid-v1" stroke="rgba(255, 255, 255, 0.35)" stroke-width="1" stroke-dasharray="4,4"></line>
              <line id="crop-grid-v2" stroke="rgba(255, 255, 255, 0.35)" stroke-width="1" stroke-dasharray="4,4"></line>
              <polygon id="crop-quad-outline" stroke="var(--accent)" stroke-width="2" fill="none"></polygon>
            </svg>

            <!-- 4 Edge Midpoint Handles (to drag an entire side) -->
            <div class="crop-edge-handle top" data-edge="top" title="Arrastrar lado superior">
              <div class="edge-pill"></div>
            </div>
            <div class="crop-edge-handle right" data-edge="right" title="Arrastrar lado derecho">
              <div class="edge-pill"></div>
            </div>
            <div class="crop-edge-handle bottom" data-edge="bottom" title="Arrastrar lado inferior">
              <div class="edge-pill"></div>
            </div>
            <div class="crop-edge-handle left" data-edge="left" title="Arrastrar lado izquierdo">
              <div class="edge-pill"></div>
            </div>

            <!-- 4 Independent Corner Handles -->
            <div class="crop-corner-handle tl" data-corner="tl" title="Mover esquina superior izquierda"></div>
            <div class="crop-corner-handle tr" data-corner="tr" title="Mover esquina superior derecha"></div>
            <div class="crop-corner-handle br" data-corner="br" title="Mover esquina inferior derecha"></div>
            <div class="crop-corner-handle bl" data-corner="bl" title="Mover esquina inferior izquierda"></div>
          </div>
        </div>
        <div id="crop-loupe" class="crop-loupe" style="display: none;">
          <canvas id="crop-loupe-canvas" width="224" height="224"></canvas>
        </div>
      </div>

      <!-- Controls & Filters Toolbar -->
      <div class="scan-editor-controls">
        <div class="scan-editor-toolbar">
          <!-- Rotate button -->
          <button id="rotate-btn" class="btn-secondary" style="padding: 8px 14px; font-size: 0.85rem; min-height: 38px; display: flex; align-items: center; gap: 6px; touch-action: manipulation;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Rotar 90°
          </button>

          <!-- Crop toggle -->
          <button id="crop-toggle-btn" class="btn-secondary ${isCropMode ? 'active' : ''}" style="padding: 8px 14px; font-size: 0.85rem; min-height: 38px; display: flex; align-items: center; gap: 6px; touch-action: manipulation;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path>
              <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path>
            </svg>
            ${isCropMode ? 'Aplicar recorte' : 'Recortar'}
          </button>

          ${!isDefaultCrop(currentPage.crop) ? `
            <button id="reset-crop-btn" class="btn-secondary" style="padding: 8px 12px; font-size: 0.85rem; min-height: 38px; touch-action: manipulation;" title="Restablecer recorte">
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
  let activeCropUpdater: (() => void) | null = null

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

    if (isCropMode && activeCropUpdater) {
      activeCropUpdater()
    }
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
    activeCropUpdater = null
    if (editOriginStage === 'cascade') {
      currentStage = 'cascade'
    } else {
      scannedPages = []
      currentStage = 'drop'
    }
    renderCurrentStage(container)
  })

  // Take more photos via camera from editor
  document.getElementById('editor-camera-btn')?.addEventListener('click', async () => {
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
    activeCropUpdater = null
    let added = false
    await startBatchCameraSession((photos) => {
      const prevLength = scannedPages.length
      for (const dataUrl of photos) {
        const newPage: ScannedPage = {
          id: `page_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          originalDataUrl: dataUrl,
          processedDataUrl: dataUrl,
          rotation: 0,
          filter: 'raw',
          crop: getDefaultCrop()
        }
        scannedPages.push(newPage)
      }
      added = true
      currentEditIndex = prevLength
      isCropMode = false
      renderEditStage(container)
    })
    if (!added) {
      renderEditStage(container)
    }
  })

  // Delete current photo
  document.getElementById('delete-current-btn')?.addEventListener('click', () => {
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
    activeCropUpdater = null
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
    activeCropUpdater = null
    currentPage.rotation = (currentPage.rotation + 90) % 360
    currentPage.crop = getDefaultCrop()
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
        crop: getDefaultCrop()
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
      activeCropUpdater = null
      isCropMode = false
      if (cropBox) cropBox.style.display = 'none'
      cropBtn.textContent = 'Recortar'
      cropBtn.classList.remove('active')
      // Apply crop with perspective correction
      currentPage.processedDataUrl = await processPageImage(currentPage)
      renderEditStage(container)
    }
  })

  // Reset crop
  document.getElementById('reset-crop-btn')?.addEventListener('click', async () => {
    resizeObserver.disconnect()
    window.removeEventListener('resize', adjustImageBounds)
    activeCropUpdater = null
    currentPage.crop = getDefaultCrop()
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
          crop: getDefaultCrop()
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
      activeCropUpdater = null
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
      activeCropUpdater = null
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
    activeCropUpdater = null
    if (isCropMode) {
      currentPage.processedDataUrl = await processPageImage(currentPage)
      isCropMode = false
    }
    currentStage = 'cascade'
    renderCurrentStage(container)
  })

  function setupCropHandles(page: ScannedPage): void {
    const container = document.getElementById('crop-overlay-box')
    const wrapper = document.getElementById('editor-image-wrapper')
    if (!container || !wrapper) return

    const maskPath = document.getElementById('crop-mask-path')
    const quadFill = document.getElementById('crop-quad-fill')
    const quadOutline = document.getElementById('crop-quad-outline')
    const gridH1 = document.getElementById('crop-grid-h1')
    const gridH2 = document.getElementById('crop-grid-h2')
    const gridV1 = document.getElementById('crop-grid-v1')
    const gridV2 = document.getElementById('crop-grid-v2')

    const cornerTL = container.querySelector('.crop-corner-handle.tl') as HTMLElement | null
    const cornerTR = container.querySelector('.crop-corner-handle.tr') as HTMLElement | null
    const cornerBR = container.querySelector('.crop-corner-handle.br') as HTMLElement | null
    const cornerBL = container.querySelector('.crop-corner-handle.bl') as HTMLElement | null

    const edgeTop = container.querySelector('.crop-edge-handle.top') as HTMLElement | null
    const edgeRight = container.querySelector('.crop-edge-handle.right') as HTMLElement | null
    const edgeBottom = container.querySelector('.crop-edge-handle.bottom') as HTMLElement | null
    const edgeLeft = container.querySelector('.crop-edge-handle.left') as HTMLElement | null

    const cropLoupe = document.getElementById('crop-loupe') as HTMLElement | null
    const loupeCanvas = document.getElementById('crop-loupe-canvas') as HTMLCanvasElement | null
    const loupeCtx = loupeCanvas?.getContext('2d')

    function updateLoupe(cornerKey: string, clientX: number, clientY: number): void {
      if (!cropLoupe || !loupeCanvas || !loupeCtx || !img || !img.complete || img.naturalWidth === 0) return
      const vp = viewport || wrapper!.parentElement
      if (!vp) return
      const vRect = vp.getBoundingClientRect()
      if (vRect.width === 0 || vRect.height === 0) return

      const loupeSize = 112
      const touchX = clientX - vRect.left
      const touchY = clientY - vRect.top

      let top = touchY - 140
      let left = touchX - loupeSize / 2

      if (top < 10) {
        top = touchY + 50
      }

      left = Math.max(8, Math.min(vRect.width - loupeSize - 8, left))
      top = Math.max(8, Math.min(vRect.height - loupeSize - 8, top))

      cropLoupe.style.transform = `translate3d(${left}px, ${top}px, 0)`

      const ctx = loupeCtx
      const center = loupeSize / 2
      const zoom = 2.2

      ctx.save()
      ctx.clearRect(0, 0, 224, 224)
      ctx.scale(2, 2)

      ctx.fillStyle = '#0d0e12'
      ctx.beginPath()
      ctx.arc(center, center, center, 0, Math.PI * 2)
      ctx.fill()
      ctx.clip()

      const w = wrapper!.clientWidth
      const h = wrapper!.clientHeight
      const pTL = { x: page.crop.tl.x * w, y: page.crop.tl.y * h }
      const pTR = { x: page.crop.tr.x * w, y: page.crop.tr.y * h }
      const pBR = { x: page.crop.br.x * w, y: page.crop.br.y * h }
      const pBL = { x: page.crop.bl.x * w, y: page.crop.bl.y * h }

      let cornerPt = pTL
      let n1 = pTR
      let n2 = pBL

      if (cornerKey === 'tl') {
        cornerPt = pTL
        n1 = pTR
        n2 = pBL
      } else if (cornerKey === 'tr') {
        cornerPt = pTR
        n1 = pTL
        n2 = pBR
      } else if (cornerKey === 'br') {
        cornerPt = pBR
        n1 = pTR
        n2 = pBL
      } else if (cornerKey === 'bl') {
        cornerPt = pBL
        n1 = pTL
        n2 = pBR
      }

      ctx.translate(center, center)
      ctx.scale(zoom, zoom)
      ctx.translate(-cornerPt.x, -cornerPt.y)

      ctx.drawImage(img, 0, 0, w, h)

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2.5 / zoom
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(n1.x, n1.y)
      ctx.lineTo(cornerPt.x, cornerPt.y)
      ctx.lineTo(n2.x, n2.y)
      ctx.stroke()

      ctx.restore()

      ctx.save()
      ctx.scale(2, 2)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(center, center, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function updateCropBoxDom() {
      const w = wrapper!.clientWidth
      const h = wrapper!.clientHeight
      if (w <= 0 || h <= 0) return

      const pTL = { x: page.crop.tl.x * w, y: page.crop.tl.y * h }
      const pTR = { x: page.crop.tr.x * w, y: page.crop.tr.y * h }
      const pBR = { x: page.crop.br.x * w, y: page.crop.br.y * h }
      const pBL = { x: page.crop.bl.x * w, y: page.crop.bl.y * h }

      // Outer mask with cutout quad (evenodd rule hollows out the inner polygon)
      if (maskPath) {
        maskPath.setAttribute(
          'd',
          `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z M ${pTL.x} ${pTL.y} L ${pBL.x} ${pBL.y} L ${pBR.x} ${pBR.y} L ${pTR.x} ${pTR.y} Z`
        )
      }

      const pointsStr = `${pTL.x},${pTL.y} ${pTR.x},${pTR.y} ${pBR.x},${pBR.y} ${pBL.x},${pBL.y}`
      if (quadFill) quadFill.setAttribute('points', pointsStr)
      if (quadOutline) quadOutline.setAttribute('points', pointsStr)

      // Perspective rule-of-thirds grid lines
      if (gridH1) {
        gridH1.setAttribute('x1', String(pTL.x * (2 / 3) + pBL.x * (1 / 3)))
        gridH1.setAttribute('y1', String(pTL.y * (2 / 3) + pBL.y * (1 / 3)))
        gridH1.setAttribute('x2', String(pTR.x * (2 / 3) + pBR.x * (1 / 3)))
        gridH1.setAttribute('y2', String(pTR.y * (2 / 3) + pBR.y * (1 / 3)))
      }
      if (gridH2) {
        gridH2.setAttribute('x1', String(pTL.x * (1 / 3) + pBL.x * (2 / 3)))
        gridH2.setAttribute('y1', String(pTL.y * (1 / 3) + pBL.y * (2 / 3)))
        gridH2.setAttribute('x2', String(pTR.x * (1 / 3) + pBR.x * (2 / 3)))
        gridH2.setAttribute('y2', String(pTR.y * (1 / 3) + pBR.y * (2 / 3)))
      }
      if (gridV1) {
        gridV1.setAttribute('x1', String(pTL.x * (2 / 3) + pTR.x * (1 / 3)))
        gridV1.setAttribute('y1', String(pTL.y * (2 / 3) + pTR.y * (1 / 3)))
        gridV1.setAttribute('x2', String(pBL.x * (2 / 3) + pBR.x * (1 / 3)))
        gridV1.setAttribute('y2', String(pBL.y * (2 / 3) + pBR.y * (1 / 3)))
      }
      if (gridV2) {
        gridV2.setAttribute('x1', String(pTL.x * (1 / 3) + pTR.x * (2 / 3)))
        gridV2.setAttribute('y1', String(pTL.y * (1 / 3) + pTR.y * (2 / 3)))
        gridV2.setAttribute('x2', String(pBL.x * (1 / 3) + pBR.x * (2 / 3)))
        gridV2.setAttribute('y2', String(pBL.y * (1 / 3) + pBR.y * (2 / 3)))
      }

      // Position Corner Handles
      if (cornerTL) cornerTL.style.transform = `translate(${pTL.x}px, ${pTL.y}px) translate(-50%, -50%)`
      if (cornerTR) cornerTR.style.transform = `translate(${pTR.x}px, ${pTR.y}px) translate(-50%, -50%)`
      if (cornerBR) cornerBR.style.transform = `translate(${pBR.x}px, ${pBR.y}px) translate(-50%, -50%)`
      if (cornerBL) cornerBL.style.transform = `translate(${pBL.x}px, ${pBL.y}px) translate(-50%, -50%)`

      // Position Edge Handles (Midpoints)
      const midTop = { x: (pTL.x + pTR.x) / 2, y: (pTL.y + pTR.y) / 2 }
      const midRight = { x: (pTR.x + pBR.x) / 2, y: (pTR.y + pBR.y) / 2 }
      const midBottom = { x: (pBL.x + pBR.x) / 2, y: (pBL.y + pBR.y) / 2 }
      const midLeft = { x: (pTL.x + pBL.x) / 2, y: (pTL.y + pBL.y) / 2 }

      if (edgeTop) edgeTop.style.transform = `translate(${midTop.x}px, ${midTop.y}px) translate(-50%, -50%)`
      if (edgeRight) edgeRight.style.transform = `translate(${midRight.x}px, ${midRight.y}px) translate(-50%, -50%)`
      if (edgeBottom) edgeBottom.style.transform = `translate(${midBottom.x}px, ${midBottom.y}px) translate(-50%, -50%)`
      if (edgeLeft) edgeLeft.style.transform = `translate(${midLeft.x}px, ${midLeft.y}px) translate(-50%, -50%)`
    }

    updateCropBoxDom()
    activeCropUpdater = updateCropBoxDom

    let dragMode: 'corner' | 'edge' | 'move' | null = null
    let activeTarget: string | null = null
    let startX = 0
    let startY = 0
    let startCrop: CropQuad = {
      tl: { ...page.crop.tl },
      tr: { ...page.crop.tr },
      br: { ...page.crop.br },
      bl: { ...page.crop.bl }
    }

    // 1. Corner Handles Dragging (Independent corner movement)
    const cornerHandles = container.querySelectorAll('.crop-corner-handle')
    cornerHandles.forEach((handle) => {
      handle.addEventListener('pointerdown', (e: any) => {
        e.stopPropagation()
        dragMode = 'corner'
        activeTarget = (handle as HTMLElement).dataset.corner || null
        startX = e.clientX
        startY = e.clientY
        startCrop = {
          tl: { ...page.crop.tl },
          tr: { ...page.crop.tr },
          br: { ...page.crop.br },
          bl: { ...page.crop.bl }
        }
        ;(handle as HTMLElement).classList.add('active')
        ;(handle as HTMLElement).setPointerCapture(e.pointerId)
        if (cropLoupe && activeTarget) {
          cropLoupe.style.display = 'block'
          updateLoupe(activeTarget, e.clientX, e.clientY)
        }
      })

      handle.addEventListener('pointermove', (e: any) => {
        if (dragMode !== 'corner' || !activeTarget) return
        const rect = wrapper.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        const dx = (e.clientX - startX) / rect.width
        const dy = (e.clientY - startY) / rect.height
        const minMargin = 0.03

        if (activeTarget === 'tl') {
          page.crop.tl.x = Math.max(0, Math.min(startCrop.tr.x - minMargin, startCrop.tl.x + dx))
          page.crop.tl.y = Math.max(0, Math.min(startCrop.bl.y - minMargin, startCrop.tl.y + dy))
        } else if (activeTarget === 'tr') {
          page.crop.tr.x = Math.max(startCrop.tl.x + minMargin, Math.min(1, startCrop.tr.x + dx))
          page.crop.tr.y = Math.max(0, Math.min(startCrop.br.y - minMargin, startCrop.tr.y + dy))
        } else if (activeTarget === 'br') {
          page.crop.br.x = Math.max(startCrop.bl.x + minMargin, Math.min(1, startCrop.br.x + dx))
          page.crop.br.y = Math.max(startCrop.tr.y + minMargin, Math.min(1, startCrop.br.y + dy))
        } else if (activeTarget === 'bl') {
          page.crop.bl.x = Math.max(0, Math.min(startCrop.br.x - minMargin, startCrop.bl.x + dx))
          page.crop.bl.y = Math.max(startCrop.tl.y + minMargin, Math.min(1, startCrop.bl.y + dy))
        }

        updateCropBoxDom()
        if (cropLoupe && activeTarget) {
          updateLoupe(activeTarget, e.clientX, e.clientY)
        }
      })

      const endCornerDrag = (e: any) => {
        if (dragMode === 'corner') {
          dragMode = null
          activeTarget = null
          if (cropLoupe) {
            cropLoupe.style.display = 'none'
          }
          ;(handle as HTMLElement).classList.remove('active')
          try {
            ;(handle as HTMLElement).releasePointerCapture(e.pointerId)
          } catch {}
        }
      }
      handle.addEventListener('pointerup', endCornerDrag)
      handle.addEventListener('pointercancel', endCornerDrag)
    })

    // 2. Edge Handles Dragging (Midpoints - moves the entire side)
    const edgeHandles = container.querySelectorAll('.crop-edge-handle')
    edgeHandles.forEach((handle) => {
      handle.addEventListener('pointerdown', (e: any) => {
        e.stopPropagation()
        dragMode = 'edge'
        activeTarget = (handle as HTMLElement).dataset.edge || null
        startX = e.clientX
        startY = e.clientY
        startCrop = {
          tl: { ...page.crop.tl },
          tr: { ...page.crop.tr },
          br: { ...page.crop.br },
          bl: { ...page.crop.bl }
        }
        ;(handle as HTMLElement).classList.add('active')
        ;(handle as HTMLElement).setPointerCapture(e.pointerId)
      })

      handle.addEventListener('pointermove', (e: any) => {
        if (dragMode !== 'edge' || !activeTarget) return
        const rect = wrapper.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        const dx = (e.clientX - startX) / rect.width
        const dy = (e.clientY - startY) / rect.height
        const minMargin = 0.03

        if (activeTarget === 'top') {
          const maxAllowedY_tl = Math.min(1, startCrop.bl.y - minMargin)
          const maxAllowedY_tr = Math.min(1, startCrop.br.y - minMargin)
          page.crop.tl.y = Math.max(0, Math.min(maxAllowedY_tl, startCrop.tl.y + dy))
          page.crop.tr.y = Math.max(0, Math.min(maxAllowedY_tr, startCrop.tr.y + dy))
          page.crop.tl.x = Math.max(0, Math.min(1, startCrop.tl.x + dx))
          page.crop.tr.x = Math.max(0, Math.min(1, startCrop.tr.x + dx))
        } else if (activeTarget === 'bottom') {
          const minAllowedY_bl = Math.max(0, startCrop.tl.y + minMargin)
          const minAllowedY_br = Math.max(0, startCrop.tr.y + minMargin)
          page.crop.bl.y = Math.max(minAllowedY_bl, Math.min(1, startCrop.bl.y + dy))
          page.crop.br.y = Math.max(minAllowedY_br, Math.min(1, startCrop.br.y + dy))
          page.crop.bl.x = Math.max(0, Math.min(1, startCrop.bl.x + dx))
          page.crop.br.x = Math.max(0, Math.min(1, startCrop.br.x + dx))
        } else if (activeTarget === 'left') {
          const maxAllowedX_tl = Math.min(1, startCrop.tr.x - minMargin)
          const maxAllowedX_bl = Math.min(1, startCrop.br.x - minMargin)
          page.crop.tl.x = Math.max(0, Math.min(maxAllowedX_tl, startCrop.tl.x + dx))
          page.crop.bl.x = Math.max(0, Math.min(maxAllowedX_bl, startCrop.bl.x + dx))
          page.crop.tl.y = Math.max(0, Math.min(1, startCrop.tl.y + dy))
          page.crop.bl.y = Math.max(0, Math.min(1, startCrop.bl.y + dy))
        } else if (activeTarget === 'right') {
          const minAllowedX_tr = Math.max(0, startCrop.tl.x + minMargin)
          const minAllowedX_br = Math.max(0, startCrop.bl.x + minMargin)
          page.crop.tr.x = Math.max(minAllowedX_tr, Math.min(1, startCrop.tr.x + dx))
          page.crop.br.x = Math.max(minAllowedX_br, Math.min(1, startCrop.br.x + dx))
          page.crop.tr.y = Math.max(0, Math.min(1, startCrop.tr.y + dy))
          page.crop.br.y = Math.max(0, Math.min(1, startCrop.br.y + dy))
        }

        updateCropBoxDom()
      })

      const endEdgeDrag = (e: any) => {
        if (dragMode === 'edge') {
          dragMode = null
          activeTarget = null
          ;(handle as HTMLElement).classList.remove('active')
          try {
            ;(handle as HTMLElement).releasePointerCapture(e.pointerId)
          } catch {}
        }
      }
      handle.addEventListener('pointerup', endEdgeDrag)
      handle.addEventListener('pointercancel', endEdgeDrag)
    })

    // 3. Move Entire Quad by dragging inside the polygon
    if (quadFill) {
      quadFill.addEventListener('pointerdown', (e: any) => {
        e.stopPropagation()
        dragMode = 'move'
        startX = e.clientX
        startY = e.clientY
        startCrop = {
          tl: { ...page.crop.tl },
          tr: { ...page.crop.tr },
          br: { ...page.crop.br },
          bl: { ...page.crop.bl }
        }
        quadFill.style.cursor = 'grabbing'
        quadFill.setPointerCapture(e.pointerId)
      })

      quadFill.addEventListener('pointermove', (e: any) => {
        if (dragMode !== 'move') return
        const rect = wrapper.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        const dx = (e.clientX - startX) / rect.width
        const dy = (e.clientY - startY) / rect.height

        const minX = Math.min(startCrop.tl.x, startCrop.tr.x, startCrop.br.x, startCrop.bl.x)
        const maxX = Math.max(startCrop.tl.x, startCrop.tr.x, startCrop.br.x, startCrop.bl.x)
        const minY = Math.min(startCrop.tl.y, startCrop.tr.y, startCrop.br.y, startCrop.bl.y)
        const maxY = Math.max(startCrop.tl.y, startCrop.tr.y, startCrop.br.y, startCrop.bl.y)

        const clampedDx = Math.max(-minX, Math.min(1 - maxX, dx))
        const clampedDy = Math.max(-minY, Math.min(1 - maxY, dy))

        page.crop.tl.x = startCrop.tl.x + clampedDx
        page.crop.tl.y = startCrop.tl.y + clampedDy
        page.crop.tr.x = startCrop.tr.x + clampedDx
        page.crop.tr.y = startCrop.tr.y + clampedDy
        page.crop.br.x = startCrop.br.x + clampedDx
        page.crop.br.y = startCrop.br.y + clampedDy
        page.crop.bl.x = startCrop.bl.x + clampedDx
        page.crop.bl.y = startCrop.bl.y + clampedDy

        updateCropBoxDom()
      })

      const endMove = (e: any) => {
        if (dragMode === 'move') {
          dragMode = null
          quadFill.style.cursor = 'move'
          try {
            quadFill.releasePointerCapture(e.pointerId)
          } catch {}
        }
      }
      quadFill.addEventListener('pointerup', endMove)
      quadFill.addEventListener('pointercancel', endMove)
    }
  }
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
      <div style="padding: 8px 16px; min-height: 56px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-shrink: 0; gap: 8px;">
        <span style="font-size: 0.95rem; font-weight: 600; white-space: nowrap;">
          ${scannedPages.length} ${scannedPages.length === 1 ? 'pág' : 'págs'}
        </span>

        <div style="display: flex; gap: 8px;">
          <button id="cascade-camera-btn" class="btn-primary" style="padding: 8px 14px; font-size: 0.85rem; min-height: 40px; display: flex; align-items: center; gap: 6px; border-radius: 8px; touch-action: manipulation;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            + Cámara
          </button>

          <button id="add-more-photos-btn" class="btn-secondary" style="padding: 8px 14px; font-size: 0.85rem; min-height: 40px; display: flex; align-items: center; gap: 6px; border-radius: 8px; touch-action: manipulation;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
          crop: getDefaultCrop()
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
          crop: getDefaultCrop()
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
      editOriginStage = 'cascade'
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

  // Save PDF Handler (generates to temp, previews size in modal, supports chain actions)
  savePdfBtn.addEventListener('click', async () => {
    if (scannedPages.length === 0) return

    const originalHtml = savePdfBtn.innerHTML
    savePdfBtn.disabled = true
    savePdfBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Preparando...`

    try {
      const fitCheckbox = document.getElementById('fit-image-checkbox') as HTMLInputElement | null
      const fitToImage = fitCheckbox ? fitCheckbox.checked : true
      const imagesDataUrls = scannedPages.map((p) => p.processedDataUrl)
      const tempResult = await pdfService.createPdfFromImages(imagesDataUrls, undefined, true, { fitToImage })

      if (!tempResult.success || !tempResult.outputPath) {
        showNotification(tempResult.error || 'Error al preparar el PDF', 'error')
        savePdfBtn.disabled = false
        savePdfBtn.innerHTML = originalHtml
        return
      }

      const fileInfo = await pdfService.getFileInfo(tempResult.outputPath)
      const fileSize = fileInfo ? formatFileSize(fileInfo.fileSizeBytes) : ''

      savePdfBtn.disabled = false
      savePdfBtn.innerHTML = originalHtml

      const dateStr = new Date().toISOString().slice(0, 10)
      const defaultName = `PDFlt_Escaneo_${dateStr}.pdf`

      const dialogResult = await pdfService.promptSaveDialog({
        defaultName,
        title: 'Guardar PDF',
        fileSize,
        currentView: 'scan'
      })

      if (!dialogResult) return // User cancelled

      if (dialogResult.action === 'save') {
        const saved = await pdfService.copyFile(tempResult.outputPath, dialogResult.fileName)
        if (saved) {
          showNotification(`PDF guardado correctamente como ${dialogResult.fileName} (${tempResult.pageCount} páginas)`, 'success')
        } else {
          showNotification('Error al guardar el archivo', 'error')
        }
      } else if (dialogResult.action === 'chain') {
        showNotification('Redirigiendo...', 'success')
        navigateTo(dialogResult.targetView, {
          fileInfo,
          returnTo: { view: 'scan', payload: { restoreState: true } }
        })
      }
    } catch (err: any) {
      showNotification(err.message || 'Error inesperado al preparar PDF', 'error')
      savePdfBtn.disabled = false
      savePdfBtn.innerHTML = originalHtml
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

function warpPerspective(
  srcCanvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point], // [p0=tl, p1=tr, p2=br, p3=bl] in srcCanvas pixel coordinates
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  const dstCanvas = document.createElement('canvas')
  dstCanvas.width = targetW
  dstCanvas.height = targetH
  const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true })!

  const [p0, p1, p2, p3] = quad
  const srcW = srcCanvas.width
  const srcH = srcCanvas.height

  // Quick check: is it an axis-aligned rectangle?
  const eps = 0.5
  const isRect =
    Math.abs(p0.y - p1.y) < eps &&
    Math.abs(p3.y - p2.y) < eps &&
    Math.abs(p0.x - p3.x) < eps &&
    Math.abs(p1.x - p2.x) < eps

  if (isRect) {
    const sx = Math.max(0, Math.min(srcW - 1, Math.round(p0.x)))
    const sy = Math.max(0, Math.min(srcH - 1, Math.round(p0.y)))
    const sw = Math.max(1, Math.min(srcW - sx, Math.round(p1.x - p0.x)))
    const sh = Math.max(1, Math.min(srcH - sy, Math.round(p3.y - p0.y)))
    dstCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, targetW, targetH)
    return dstCanvas
  }

  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!
  const srcImgData = srcCtx.getImageData(0, 0, srcW, srcH)
  const srcData = srcImgData.data
  const dstImgData = dstCtx.createImageData(targetW, targetH)
  const dstData = dstImgData.data

  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y

  const det = dx1 * dy2 - dy1 * dx2
  const useHomography = Math.abs(det) > 1e-7

  let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0
  if (useHomography) {
    g = (dx3 * dy2 - dy3 * dx2) / det
    h = (dx1 * dy3 - dy1 * dx3) / det
    a = p1.x - p0.x + g * p1.x
    b = p3.x - p0.x + h * p3.x
    c = p0.x
    d = p1.y - p0.y + g * p1.y
    e = p3.y - p0.y + h * p3.y
    f = p0.y
  }

  let dstIdx = 0
  const srcW_minus_1 = srcW - 1
  const srcH_minus_1 = srcH - 1

  for (let y = 0; y < targetH; y++) {
    const v = y / targetH
    if (useHomography) {
      const bv_c = b * v + c
      const ev_f = e * v + f
      const hv_1 = h * v + 1

      for (let x = 0; x < targetW; x++) {
        const u = x / targetW
        const denom = g * u + hv_1
        const sx = (a * u + bv_c) / denom
        const sy = (d * u + ev_f) / denom

        const x0 = Math.floor(sx)
        const y0 = Math.floor(sy)

        if (x0 >= 0 && x0 < srcW_minus_1 && y0 >= 0 && y0 < srcH_minus_1) {
          const fx = sx - x0
          const fy = sy - y0
          const fx1 = 1 - fx
          const fy1 = 1 - fy

          const idx00 = (y0 * srcW + x0) * 4
          const idx10 = idx00 + 4
          const idx01 = idx00 + srcW * 4
          const idx11 = idx01 + 4

          const w00 = fx1 * fy1
          const w10 = fx * fy1
          const w01 = fx1 * fy
          const w11 = fx * fy

          dstData[dstIdx] = (srcData[idx00] * w00 + srcData[idx10] * w10 + srcData[idx01] * w01 + srcData[idx11] * w11) | 0
          dstData[dstIdx + 1] = (srcData[idx00 + 1] * w00 + srcData[idx10 + 1] * w10 + srcData[idx01 + 1] * w01 + srcData[idx11 + 1] * w11) | 0
          dstData[dstIdx + 2] = (srcData[idx00 + 2] * w00 + srcData[idx10 + 2] * w10 + srcData[idx01 + 2] * w01 + srcData[idx11 + 2] * w11) | 0
          dstData[dstIdx + 3] = 255
        } else if (x0 >= 0 && x0 <= srcW_minus_1 && y0 >= 0 && y0 <= srcH_minus_1) {
          const idx = (y0 * srcW + x0) * 4
          dstData[dstIdx] = srcData[idx]
          dstData[dstIdx + 1] = srcData[idx + 1]
          dstData[dstIdx + 2] = srcData[idx + 2]
          dstData[dstIdx + 3] = 255
        }
        dstIdx += 4
      }
    } else {
      const v1 = 1 - v
      for (let x = 0; x < targetW; x++) {
        const u = x / targetW
        const u1 = 1 - u
        const w0 = u1 * v1
        const w1 = u * v1
        const w2 = u * v
        const w3 = u1 * v

        const sx = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x
        const sy = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y

        const x0 = Math.floor(sx)
        const y0 = Math.floor(sy)

        if (x0 >= 0 && x0 < srcW_minus_1 && y0 >= 0 && y0 < srcH_minus_1) {
          const fx = sx - x0
          const fy = sy - y0
          const fx1 = 1 - fx
          const fy1 = 1 - fy

          const idx00 = (y0 * srcW + x0) * 4
          const idx10 = idx00 + 4
          const idx01 = idx00 + srcW * 4
          const idx11 = idx01 + 4

          dstData[dstIdx] = (srcData[idx00] * fx1 * fy1 + srcData[idx10] * fx * fy1 + srcData[idx01] * fx1 * fy + srcData[idx11] * fx * fy) | 0
          dstData[dstIdx + 1] = (srcData[idx00 + 1] * fx1 * fy1 + srcData[idx10 + 1] * fx * fy1 + srcData[idx01 + 1] * fx1 * fy + srcData[idx11 + 1] * fx * fy) | 0
          dstData[dstIdx + 2] = (srcData[idx00 + 2] * fx1 * fy1 + srcData[idx10 + 2] * fx * fy1 + srcData[idx01 + 2] * fx1 * fy + srcData[idx11 + 2] * fx * fy) | 0
          dstData[dstIdx + 3] = 255
        }
        dstIdx += 4
      }
    }
  }

  dstCtx.putImageData(dstImgData, 0, 0)
  return dstCanvas
}

function processPageImage(page: ScannedPage): Promise<string> {
  // If raw, no rotation, and default crop, return original dataUrl directly (fast & no canvas loss)
  if (
    page.filter === 'raw' &&
    page.rotation === 0 &&
    isDefaultCrop(page.crop)
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
      const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: true })!

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

      // 2. Calculate crop points in pixel coordinates on the rotated canvas
      const rw = rotCanvas.width
      const rh = rotCanvas.height
      const crop = page.crop && page.crop.tl ? page.crop : getDefaultCrop()
      const p0: Point = { x: crop.tl.x * rw, y: crop.tl.y * rh }
      const p1: Point = { x: crop.tr.x * rw, y: crop.tr.y * rh }
      const p2: Point = { x: crop.br.x * rw, y: crop.br.y * rh }
      const p3: Point = { x: crop.bl.x * rw, y: crop.bl.y * rh }

      // 3. Compute target rectangular dimensions from quad edges
      const topW = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      const botW = Math.hypot(p2.x - p3.x, p2.y - p3.y)
      let targetW = Math.max(topW, botW)

      const leftH = Math.hypot(p3.x - p0.x, p3.y - p0.y)
      const rightH = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      let targetH = Math.max(leftH, rightH)

      // 4. Downsample if larger than maxDim (1800px)
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
      targetW = Math.max(50, Math.round(targetW))
      targetH = Math.max(50, Math.round(targetH))

      // 5. Warp quad into rectangular destination canvas (Perspective Dewarping)
      const canvas = warpPerspective(rotCanvas, [p0, p1, p2, p3], targetW, targetH)
      const ctx = canvas.getContext('2d')!

      // 6. Filters
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
