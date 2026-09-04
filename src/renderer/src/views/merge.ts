import { pdfService } from '../services/pdfService'
import Sortable from 'sortablejs'
import { navigateTo, showNotification } from '../router'
import type { PdfFileInfo } from '../../../shared/types'

// â”€â”€ Module state â”€â”€
let selectedFiles: PdfFileInfo[] = []

/**
 * Renders the merge view
 */
export function renderMerge(container: HTMLElement): void {
  // Reset state
  selectedFiles = []

  container.innerHTML = `
    <div class="view-header">
      <h2>Unir PDFs</h2>
    </div>

    <!-- Drop zone for initial empty state -->
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <p>Toca para seleccionar PDFs</p>
      </div>
    </div>

    <!-- File list area (visible when files loaded) -->
    <div id="file-list-container" style="display:none; padding: 1rem; width: 100%; max-width: 800px; margin: 0 auto; flex: 1; overflow-y: auto;">
      <p style="margin-bottom: 1rem; color: var(--text-muted);">Toca y arrastra los archivos para reordenarlos.</p>
      <div id="file-list" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
      <button id="add-more-btn" class="btn-secondary" style="margin-top: 1rem; width: 100%;">+ Añadir más PDFs</button>
    </div>

    <!-- Action bar (visible when files loaded) -->
    <div id="action-bar" class="action-bar" style="display:none">
      <span id="merge-info" class="page-info">0 archivos</span>
      <div class="action-buttons">
        <button id="merge-btn" class="btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Guardar PDF
        </button>
        <div class="chain-actions" id="chain-actions" style="display: none;">
          <span style="color:var(--text-muted); font-size: 0.85rem">o continuar en:</span>
          <button id="merge-to-reorder" class="btn-secondary" title="Reordenar">Reordenar</button>
          <button id="merge-to-split" class="btn-secondary" title="Separar">Separar</button>
          <button id="merge-to-compress" class="btn-secondary" title="Comprimir">Comprimir</button>
        </div>
      </div>
    </div>
  `

  setupEventListeners()
}

function setupEventListeners(): void {
  // Drop zone click â†’ open multiple file dialog
  const dropZone = document.getElementById('drop-zone')!
  dropZone.addEventListener('click', handleOpenFiles)

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
      const fileArray = Array.from(files) as File[]; if (fileArray.length > 0) { const infos = await pdfService.processDroppedFiles(fileArray)
        if (infos && infos.length > 0) {
          selectedFiles = [...selectedFiles, ...infos]
          renderFileList()
        }
      }
    }
  })

  // Add more button
  document.getElementById('add-more-btn')?.addEventListener('click', handleOpenFiles)

  // Merge buttons
  document.getElementById('merge-btn')?.addEventListener('click', () => handleMerge(false))
  document.getElementById('merge-to-reorder')?.addEventListener('click', () => handleMerge(true, 'reorder'))
  document.getElementById('merge-to-split')?.addEventListener('click', () => handleMerge(true, 'split'))
  document.getElementById('merge-to-compress')?.addEventListener('click', () => handleMerge(true, 'compress'))
}

async function handleOpenFiles(): Promise<void> {
  const newFiles = await pdfService.openMultiplePdfDialog()
  if (newFiles && newFiles.length > 0) {
    selectedFiles = [...selectedFiles, ...newFiles]
    renderFileList()
  }
}

function renderFileList(): void {
  const dropZone = document.getElementById('drop-zone')!
  const listContainer = document.getElementById('file-list-container')!
  const actionBar = document.getElementById('action-bar')!
  const fileList = document.getElementById('file-list')!
  const mergeInfo = document.getElementById('merge-info')!

  if (selectedFiles.length === 0) {
    dropZone.style.display = 'flex'
    listContainer.style.display = 'none'
    actionBar.style.display = 'none'
    return
  }

  dropZone.style.display = 'none'
  listContainer.style.display = 'block'
  actionBar.style.display = 'flex'

  let totalPages = 0
  fileList.innerHTML = ''

  selectedFiles.forEach((file, index) => {
    totalPages += file.pageCount
    const item = document.createElement('div')
    item.className = 'file-item'
    item.dataset.index = String(index)
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 0.75rem 1rem;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: grab;
    `

    item.innerHTML = `
      <div style="margin-right: 1rem; color: var(--text-muted);">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
      </div>
      <div style="flex: 1; overflow: hidden;">
        <div style="font-weight: 500; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${file.fileName}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${file.pageCount} páginas</div>
      </div>
      <button class="remove-btn btn-icon" data-idx="${index}" title="Eliminar" style="margin-left: 1rem; color: var(--error);">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `
    fileList.appendChild(item)
  })

  mergeInfo.textContent = `${selectedFiles.length} archivos · ${totalPages} páginas totales`

  // Bind remove buttons
  fileList.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const idx = parseInt((btn as HTMLElement).dataset.idx!, 10)
      selectedFiles.splice(idx, 1)
      renderFileList()
    })
  })

  // Initialize SortableJS
  Sortable.create(fileList, {
    animation: 150,
    ghostClass: 'thumbnail-ghost',
    chosenClass: 'thumbnail-chosen',
    dragClass: 'thumbnail-drag',
    handle: '.file-item',
    onEnd: (evt) => {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        const item = selectedFiles.splice(evt.oldIndex, 1)[0]
        selectedFiles.splice(evt.newIndex, 0, item)
        renderFileList() // Re-render to update indices
      }
    }
  })
}

async function handleMerge(toTemp: boolean, targetView?: any): Promise<void> {
  if (selectedFiles.length < 2) {
    showNotification('Selecciona al menos 2 PDFs para unirlos.', 'warning')
    return
  }

  const btnId = toTemp ? `merge-to-${targetView}` : 'merge-btn'
  const btn = document.getElementById(btnId) as HTMLButtonElement
  const originalText = btn.innerHTML
  
  // Disable all buttons in action bar
  document.querySelectorAll('#action-bar button').forEach(b => (b as HTMLButtonElement).disabled = true)
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div>`

  try {
    const filePaths = selectedFiles.map(f => f.filePath)
    const result = await pdfService.mergePdfs(filePaths, toTemp)

    if (result.success && result.outputPath) {
      if (toTemp && targetView) {
        const fileInfo = await pdfService.getFileInfo(result.outputPath)
        if (fileInfo) {
          showNotification('Redirigiendo...', 'success')
          navigateTo(targetView, { fileInfo })
        }
      } else {
        showNotification(`PDF guardado correctamente (${result.pageCount} páginas)`, 'success')
        selectedFiles = []
        renderFileList()
      }
    } else if (result.error !== 'OperaciÃ³n cancelada') {
      showNotification(result.error || 'Error desconocido al unir', 'error')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    showNotification(`Error: ${message}`, 'error')
  } finally {
    document.querySelectorAll('#action-bar button').forEach(b => (b as HTMLButtonElement).disabled = false)
    btn.innerHTML = originalText
  }
}



