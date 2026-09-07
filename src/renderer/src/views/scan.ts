import Sortable from 'sortablejs'
import { pdfService } from '../services/pdfService'
import { showNotification, navigateTo } from '../router'

interface ScannedImage {
  id: string
  originalDataUrl: string
  processedDataUrl: string
  rotation: number // 0, 90, 180, 270
  filter: 'raw' | 'bw' | 'color'
}

let scannedImages: ScannedImage[] = []
let sortableInstance: Sortable | null = null

export function renderScan(container: HTMLElement): void {
  scannedImages = []

  container.innerHTML = `
    <!-- Drop zone (visible when no photos) -->
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

    <!-- Workspace (visible when photos are loaded) -->
    <div id="scan-workspace" style="display:none; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      
      <!-- Top controls -->
      <div style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-shrink: 0;">
        <span id="scan-count-info" style="font-size: 0.9rem; font-weight: 500;">0 fotos</span>
        
        <div style="display: flex; gap: 8px; align-items: center;">
          <button id="add-more-photos-btn" class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;">
            + Añadir fotos
          </button>
        </div>
      </div>

      <!-- Global filter selector -->
      <div style="padding: 10px 16px; background: var(--bg-primary); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0;">
        <span style="font-size: 0.8rem; color: var(--text-muted); margin-right: 4px;">Filtro global:</span>
        <button class="global-filter-btn btn-secondary active" data-filter="raw" style="padding: 4px 10px; font-size: 0.75rem;">En crudo</button>
        <button class="global-filter-btn btn-secondary" data-filter="bw" style="padding: 4px 10px; font-size: 0.75rem;">Doc. B&N</button>
        <button class="global-filter-btn btn-secondary" data-filter="color" style="padding: 4px 10px; font-size: 0.75rem;">Color mejorado</button>
      </div>

      <!-- Thumbnails Grid -->
      <div id="scan-thumbnails-scroll" class="thumbnails-scroll" style="flex: 1; overflow-y: auto; padding: 16px;">
        <div id="scan-grid" class="thumbnails-grid"></div>
      </div>

      <!-- Action Bar -->
      <div id="scan-action-bar" class="action-bar">
        <div class="action-buttons">
          <button id="clear-scan-btn" class="btn-secondary">Borrar todo</button>
          <button id="create-pdf-btn" class="btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
              <path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/>
            </svg>
            Crear PDF
          </button>
          <div id="scan-chain-actions" class="chain-actions" style="display: none;">
            <button id="scan-to-compress" class="btn-secondary">Comprimir</button>
            <button id="scan-to-merge" class="btn-secondary">Unir</button>
            <button id="scan-to-split" class="btn-secondary">Separar</button>
          </div>
        </div>
      </div>
    </div>
  `

  setupEventListeners()
}

function setupEventListeners(): void {
  const dropZone = document.getElementById('drop-zone')!
  const fileInput = document.getElementById('image-file-input') as HTMLInputElement
  const addMoreBtn = document.getElementById('add-more-photos-btn')!
  const createPdfBtn = document.getElementById('create-pdf-btn') as HTMLButtonElement
  const clearBtn = document.getElementById('clear-scan-btn')!

  // Open file dialog on drop zone click
  dropZone.addEventListener('click', () => fileInput.click())
  addMoreBtn.addEventListener('click', () => fileInput.click())

  // File input change
  fileInput.addEventListener('change', async (e) => {
    const files = (e.target as HTMLInputElement).files
    if (files && files.length > 0) {
      await loadImages(Array.from(files))
      fileInput.value = '' // Reset input
    }
  })

  // Drag and drop feedback
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
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        await loadImages(imageFiles)
      } else {
        showNotification('Por favor, selecciona archivos de imagen válidos', 'warning')
      }
    }
  })

  // Global filters
  document.querySelectorAll('.global-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.global-filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const filter = (btn as HTMLElement).dataset.filter as 'raw' | 'bw' | 'color'
      applyGlobalFilter(filter)
    })
  })

  // Clear all
  clearBtn.addEventListener('click', () => {
    scannedImages = []
    renderWorkspace()
  })

  // Create PDF
  createPdfBtn.addEventListener('click', handleCreatePdf)
}

async function loadImages(files: File[]): Promise<void> {
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file)
    const id = `img_${Date.now()}_${Math.random().toString(36).substring(7)}`
    
    scannedImages.push({
      id,
      originalDataUrl: dataUrl,
      processedDataUrl: dataUrl,
      rotation: 0,
      filter: 'raw'
    })
  }

  renderWorkspace()
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function renderWorkspace(): void {
  const dropZone = document.getElementById('drop-zone')!
  const workspace = document.getElementById('scan-workspace')!
  const grid = document.getElementById('scan-grid')!
  const countInfo = document.getElementById('scan-count-info')!

  if (scannedImages.length === 0) {
    dropZone.style.display = 'flex'
    workspace.style.display = 'none'
    return
  }

  dropZone.style.display = 'none'
  workspace.style.display = 'flex'
  countInfo.textContent = `${scannedImages.length} ${scannedImages.length === 1 ? 'página' : 'páginas'}`

  grid.innerHTML = ''

  scannedImages.forEach((item, index) => {
    const card = document.createElement('div')
    card.className = 'thumbnail-card'
    card.dataset.id = item.id
    card.style.cssText = 'position: relative; display: flex; flex-direction: column; gap: 8px;'

    card.innerHTML = `
      <div class="thumbnail-image" style="background: #fff; border-radius: 6px; overflow: hidden; height: 170px; display: flex; align-items: center; justify-content: center;">
        <img id="preview-${item.id}" src="${item.processedDataUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
      </div>
      
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span class="thumbnail-label" style="padding: 2px 8px; font-size: 0.75rem;">Pág. ${index + 1}</span>
        
        <div style="display: flex; gap: 4px;">
          <!-- Rotate button -->
          <button class="rotate-btn btn-icon" data-id="${item.id}" title="Rotar 90°" style="width: 30px; height: 30px; padding: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          
          <!-- Remove button -->
          <button class="remove-photo-btn btn-icon" data-id="${item.id}" title="Eliminar" style="width: 30px; height: 30px; padding: 4px; color: var(--error);">
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

  // Bind rotate and remove buttons
  grid.querySelectorAll('.rotate-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (btn as HTMLElement).dataset.id
      const item = scannedImages.find(img => img.id === id)
      if (item) {
        item.rotation = (item.rotation + 90) % 360
        item.processedDataUrl = await processImageDataUrl(item.originalDataUrl, item.filter, item.rotation)
        const imgEl = document.getElementById(`preview-${item.id}`) as HTMLImageElement
        if (imgEl) imgEl.src = item.processedDataUrl
      }
    })
  })

  grid.querySelectorAll('.remove-photo-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = (btn as HTMLElement).dataset.id
      scannedImages = scannedImages.filter(img => img.id !== id)
      renderWorkspace()
    })
  })

  // Initialize SortableJS for reordering with mobile-friendly touch delay
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
        const item = scannedImages.splice(evt.oldIndex, 1)[0]
        scannedImages.splice(evt.newIndex, 0, item)
        // Update page labels
        grid.querySelectorAll('.thumbnail-card').forEach((c, idx) => {
          const lbl = c.querySelector('.thumbnail-label')
          if (lbl) lbl.textContent = `Pág. ${idx + 1}`
        })
      }
    }
  })
}

async function applyGlobalFilter(filter: 'raw' | 'bw' | 'color'): Promise<void> {
  for (const item of scannedImages) {
    item.filter = filter
    item.processedDataUrl = await processImageDataUrl(item.originalDataUrl, item.filter, item.rotation)
    const imgEl = document.getElementById(`preview-${item.id}`) as HTMLImageElement
    if (imgEl) imgEl.src = item.processedDataUrl
  }
}

/**
 * Filter processing using HTML5 Canvas:
 * - 'raw': original image with rotation
 * - 'bw': scanner document effect (paper whitening + sharp dark ink)
 * - 'color': brightened paper while preserving full RGB color
 */
function processImageDataUrl(dataUrl: string, filter: 'raw' | 'bw' | 'color', rotation: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      // Resize if too large (max 2000px dimension for performance & memory)
      let w = img.width
      let h = img.height
      const maxDim = 2000
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w)
          w = maxDim
        } else {
          w = Math.round((w * maxDim) / h)
          h = maxDim
        }
      }

      // Handle rotation dimensions
      if (rotation === 90 || rotation === 270) {
        canvas.width = h
        canvas.height = w
      } else {
        canvas.width = w
        canvas.height = h
      }

      ctx.save()
      // Transform canvas for rotation
      if (rotation === 90) {
        ctx.translate(h, 0)
        ctx.rotate((90 * Math.PI) / 180)
      } else if (rotation === 180) {
        ctx.translate(w, h)
        ctx.rotate((180 * Math.PI) / 180)
      } else if (rotation === 270) {
        ctx.translate(0, w)
        ctx.rotate((270 * Math.PI) / 180)
      }

      ctx.drawImage(img, 0, 0, w, h)
      ctx.restore()

      // Apply filter if not raw
      if (filter !== 'raw') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const d = imgData.data

        for (let i = 0; i < d.length; i += 4) {
          const r = d[i]
          const g = d[i + 1]
          const b = d[i + 2]
          const gray = 0.299 * r + 0.587 * g + 0.114 * b

          if (filter === 'bw') {
            // Scanner document: paper background (>145) becomes pure white.
            // Dark text (<135) is enhanced.
            let val = gray
            if (val > 145) {
              val = 255
            } else {
              val = Math.max(0, val * 0.75)
            }
            d[i] = val
            d[i + 1] = val
            d[i + 2] = val
          } else if (filter === 'color') {
            // Brighten paper while keeping colors
            const factor = 1.2
            d[i] = Math.min(255, Math.max(0, (r - 128) * factor + 128 + 18))
            d[i + 1] = Math.min(255, Math.max(0, (g - 128) * factor + 128 + 18))
            d[i + 2] = Math.min(255, Math.max(0, (b - 128) * factor + 128 + 18))
          }
        }
        ctx.putImageData(imgData, 0, 0)
      }

      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.src = dataUrl
  })
}

async function handleCreatePdf(): Promise<void> {
  if (scannedImages.length === 0) return

  const btn = document.getElementById('create-pdf-btn') as HTMLButtonElement
  const originalHtml = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Creando PDF...`

  try {
    const imagesDataUrls = scannedImages.map(img => img.processedDataUrl)
    const result = await pdfService.createPdfFromImages(imagesDataUrls)

    if (result.success && result.outputPath) {
      showNotification(`PDF creado exitosamente (${result.pageCount} páginas)`, 'success')
      
      // Show chain actions
      const chainActions = document.getElementById('scan-chain-actions')!
      chainActions.style.display = 'flex'

      const fileInfo = await pdfService.getFileInfo(result.outputPath)
      if (fileInfo) {
        document.getElementById('scan-to-compress')?.addEventListener('click', () => {
          navigateTo('compress', { fileInfo })
        })
        document.getElementById('scan-to-merge')?.addEventListener('click', () => {
          navigateTo('merge', { fileInfo })
        })
        document.getElementById('scan-to-split')?.addEventListener('click', () => {
          navigateTo('split', { fileInfo })
        })
      }
    } else {
      showNotification(result.error || 'Error al generar el PDF', 'error')
    }
  } catch (err: any) {
    showNotification(err.message || 'Error inesperado', 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = originalHtml
  }
}

