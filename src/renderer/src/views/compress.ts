import { pdfService } from '../services/pdfService'
import * as pdfjsLib from 'pdfjs-dist'
import { showNotification, navigateTo } from '../router'
import type { PdfFileInfo, CompressionLevel } from '../../../shared/types'

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

let currentFileInfo: PdfFileInfo | null = null
let selectedLevel: CompressionLevel = 'recommended'
let isCompressing = false
let chainedReturnTo: { view: any; payload?: any } | null = null

export function renderCompress(container: HTMLElement, payload?: any): void {
  chainedReturnTo = payload?.returnTo || null

  const isRestoring = payload?.restoreState && currentFileInfo

  if (!isRestoring) {
    if (!payload?.fileInfo) {
      currentFileInfo = null
    }
    selectedLevel = 'recommended'
    isCompressing = false
    lastOperationResult = null
  }

  container.innerHTML = `
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        ${
          chainedReturnTo
            ? `
          <div style="width: 100%; display: flex; justify-content: flex-start; margin-bottom: 8px;">
            <button id="chain-back-btn-drop" class="chain-back-btn" title="Volver">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Volver</span>
            </button>
          </div>
        `
            : ''
        }
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.29 7 12 12 20.71 7"></polyline>
          <line x1="12" y1="22" x2="12" y2="12"></line>
        </svg>
        <h3>Comprimir PDF</h3>
        <p>Toca para seleccionar un PDF</p>
        <button id="open-btn" class="btn-primary" style="margin-top: 1rem; display: none;">Seleccionar PDF</button>
      </div>
    </div>

    <div id="compress-workspace" style="display:none; width: 100%; max-width: 800px; margin: 0 auto; padding: 1.5rem 1rem; overflow-y: auto; flex: 1;">
      
      ${
        chainedReturnTo
          ? `
        <div style="display: flex; align-items: center; margin-bottom: 1rem;">
          <button id="chain-back-btn" class="chain-back-btn" title="Volver a la herramienta anterior">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Volver</span>
          </button>
        </div>
      `
          : ''
      }

      <!-- Info Header -->
      <div class="file-info-header" style="text-align: center; margin-bottom: 2rem;">
        <h2 id="file-name" style="margin-bottom: 8px;"></h2>
        <div style="display: flex; justify-content: center; gap: 16px; color: var(--text-muted);">
          <span id="file-pages"></span>
          <span id="file-size" style="font-weight: 500; color: var(--text);"></span>
        </div>
      </div>

      <!-- Compression Levels -->
      <div class="compression-levels" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        
        <div class="compression-card" data-level="extreme">
          <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <h3>Fuerte</h3>
          <p>Mínimo tamaño. Menor resolución (100 DPI). Ideal para enviar por correo.</p>
        </div>

        <div class="compression-card selected" data-level="recommended">
          <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></div>
          <h3>Equilibrada</h3>
          <p>Mejor relación calidad/tamaño (150 DPI). Ideal para leer en pantalla.</p>
        </div>

        <div class="compression-card" data-level="low">
          <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
          <h3>Suave</h3>
          <p>Alta calidad. Mayor resolución (300 DPI). Ideal para impresión.</p>
        </div>
      </div>

      <!-- Progress Section -->
      <div id="progress-container" style="display: none; margin-bottom: 2rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem;">
          <span id="progress-text">Comprimiendo...</span>
          <span id="progress-percent">0%</span>
        </div>
        <div style="width: 100%; height: 8px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
          <div id="progress-bar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s ease;"></div>
        </div>
      </div>

      <!-- Result Card -->
      <div id="result-container" class="result-container" style="display: none; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; text-align: center;">
        <h3 style="color: var(--success); margin-bottom: 1rem;">¡Compresión completada!</h3>
        <div style="display: flex; justify-content: space-around; margin-bottom: 1rem;">
          <div>Tamaño original: <span id="result-old-size" style="font-weight: bold;"></span></div>
          <div>Nuevo tamaño: <span id="result-new-size" style="font-weight: bold; color: var(--primary);"></span></div>
          <div style="color: var(--success);">Ahorro: <span id="result-savings" style="font-weight: bold; padding: 2px 6px; border-radius: 4px;"></span></div>
        </div>
      </div>

      <div class="action-buttons">
        <button id="compress-btn" class="btn-primary" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.29 7 12 12 20.71 7"></polyline>
            <line x1="12" y1="22" x2="12" y2="12"></line>
          </svg>
          Comprimir PDF
        </button>
        <button id="save-btn" class="btn-primary" style="display: none;">Guardar Como...</button>
      </div>

    </div>
  `

  setupEventListeners()

  if (payload && payload.fileInfo) {
    loadPdf(payload.fileInfo)
  } else if (isRestoring && currentFileInfo) {
    loadPdf(currentFileInfo)
    if (lastOperationResult) {
      document.getElementById('result-container')!.style.display = 'block'
      document.getElementById('save-btn')!.style.display = 'inline-flex'
      const compressBtn = document.getElementById('compress-btn')
      if (compressBtn) compressBtn.style.display = 'none'
    }
  }
}

function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
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
          loadPdf(infos[0])
        }
      }
    }
  })
  
  document.getElementById('open-btn')?.addEventListener('click', (e) => {
    e.stopPropagation()
    handleOpenFile()
  })

  // Level Selection Cards
  document.querySelectorAll('.compression-card').forEach(card => {
    card.addEventListener('click', () => {
      if (isCompressing) return
      document.querySelectorAll('.compression-card').forEach(c => c.classList.remove('selected'))
      card.classList.add('selected')
      selectedLevel = (card as HTMLElement).dataset.level as CompressionLevel
    })
  })

  document.getElementById('compress-btn')?.addEventListener('click', () => handleCompress(true)) // Always save to temp first to show stats!
  document.getElementById('save-btn')?.addEventListener('click', () => handleSaveFinal())

  const handleGoBack = () => {
    if (chainedReturnTo) {
      navigateTo(chainedReturnTo.view, chainedReturnTo.payload || { restoreState: true })
    }
  }
  document.getElementById('chain-back-btn')?.addEventListener('click', handleGoBack)
  document.getElementById('chain-back-btn-drop')?.addEventListener('click', handleGoBack)
}

async function handleOpenFile(): Promise<void> {
  const fileInfo = await pdfService.openPdfDialog()
  if (fileInfo) {
    loadPdf(fileInfo)
  }
}

function loadPdf(fileInfo: PdfFileInfo): void {
  currentFileInfo = fileInfo
  isCompressing = false
  
  // Reset UI
  document.getElementById('progress-container')!.style.display = 'none'
  document.getElementById('result-container')!.style.display = 'none'
  document.getElementById('save-btn')!.style.display = 'none'
  document.getElementById('chain-actions')!.style.display = 'none'
  document.getElementById('compress-btn')!.style.display = 'inline-flex'
  ;(document.getElementById('compress-btn') as HTMLButtonElement).disabled = false
  
  document.getElementById('file-name')!.textContent = fileInfo.fileName
  document.getElementById('file-pages')!.textContent = `${fileInfo.pageCount} páginas`
  document.getElementById('file-size')!.textContent = formatBytes(fileInfo.fileSizeBytes)

  document.getElementById('drop-zone')!.style.display = 'none'
  document.getElementById('compress-workspace')!.style.display = 'block'
}

let lastOperationResult: any = null;

async function handleCompress(toTemp: boolean): Promise<void> {
  if (!currentFileInfo) return
  isCompressing = true
  
  const compressBtn = document.getElementById('compress-btn') as HTMLButtonElement
  compressBtn.disabled = true
  
  const progressContainer = document.getElementById('progress-container')!
  const progressText = document.getElementById('progress-text')!
  const progressBar = document.getElementById('progress-bar')!
  const progressPercent = document.getElementById('progress-percent')!
  
  progressContainer.style.display = 'block'
  progressBar.style.width = '0%'
  progressPercent.textContent = '0%'

  try {
    if (selectedLevel === 'basic') {
      progressText.textContent = 'Optimizando estructura...'
      progressBar.style.width = '50%'
      // Call main process directly for structural compression
      const result = await pdfService.compressStructural(currentFileInfo.filePath, toTemp)
      progressBar.style.width = '100%'
      progressPercent.textContent = '100%'
      await showResult(result)
    } else {
      // Canvas based compression
      const arrayBuffer = await pdfService.readPdfFile(currentFileInfo.filePath)
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      const numPages = pdf.numPages
      
      const imagesBase64: string[] = []
      const dimensions: any[] = []
      
      // Determine scale and quality based on level
      const scale = selectedLevel === 'extreme' ? 1.0 : 1.5
      const quality = selectedLevel === 'extreme' ? 0.6 : 0.8

      for (let i = 1; i <= numPages; i++) {
        progressText.textContent = `Renderizando página ${i} de ${numPages}...`
        const percent = Math.round(((i - 1) / numPages) * 100)
        progressBar.style.width = `${percent}%`
        progressPercent.textContent = `${percent}%`

        const page = await pdf.getPage(i)
        const unscaledViewport = page.getViewport({ scale: 1.0 })
        
        dimensions.push({ width: unscaledViewport.width, height: unscaledViewport.height })
        
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        await page.render({ canvasContext: ctx, viewport }).promise
        
        const base64 = canvas.toDataURL('image/jpeg', quality)
        imagesBase64.push(base64)
      }

      progressText.textContent = 'Ensamblando PDF final...'
      progressBar.style.width = '95%'
      progressPercent.textContent = '95%'

      const result = await pdfService.assembleCompressedPdf(imagesBase64, dimensions, toTemp)
      progressBar.style.width = '100%'
      progressPercent.textContent = '100%'
      
      await showResult(result)
    }
  } catch (err) {
    showNotification(`Error: ${(err as Error).message}`, 'error')
    progressContainer.style.display = 'none'
    compressBtn.disabled = false
  } finally {
    isCompressing = false
  }
}

async function showResult(result: any) {
  const compressBtn = document.getElementById('compress-btn') as HTMLButtonElement
  const progressContainer = document.getElementById('progress-container')!
  
  if (result.success && result.outputPath) {
    lastOperationResult = result
    
    // Get new file info to compare sizes
    const fileInfo = await pdfService.getFileInfo(result.outputPath)
    
    if (fileInfo && currentFileInfo) {
      const oldSize = currentFileInfo.fileSizeBytes
      const newSize = fileInfo.fileSizeBytes
      const savings = oldSize > newSize ? Math.round((1 - (newSize / oldSize)) * 100) : 0
      
      document.getElementById('result-old-size')!.textContent = formatBytes(oldSize)
      document.getElementById('result-new-size')!.textContent = formatBytes(newSize)
      document.getElementById('result-savings')!.textContent = `${savings > 0 ? '-' : '+'}${Math.abs(savings)}%`
      
      if (newSize >= oldSize) {
        document.getElementById('result-savings')!.style.color = 'var(--error)'
        document.getElementById('result-savings')!.style.background = 'rgba(239, 68, 68, 0.1)'
      } else {
        document.getElementById('result-savings')!.style.color = 'var(--success)'
        document.getElementById('result-savings')!.style.background = 'rgba(74, 222, 128, 0.1)'
      }

      document.getElementById('result-container')!.style.display = 'block'
      compressBtn.style.display = 'none'
      document.getElementById('save-btn')!.style.display = 'inline-flex'
    }
  } else {
    showNotification(result.error || 'Error al comprimir', 'error')
    compressBtn.disabled = false
  }
  
  setTimeout(() => {
    progressContainer.style.display = 'none'
  }, 1000)
}

async function handleSaveFinal(): Promise<void> {
  if (!lastOperationResult || !lastOperationResult.outputPath) return

  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
  const originalHtml = saveBtn.innerHTML
  saveBtn.disabled = true
  saveBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Guardando...'
  
  try {
    const fileInfo = await pdfService.getFileInfo(lastOperationResult.outputPath)
    const fileSize = fileInfo ? formatBytes(fileInfo.fileSizeBytes) : ''
    const defaultName = currentFileInfo?.fileName.replace(/\.pdf$/i, '_comprimido.pdf') || 'PDFlt_comprimido.pdf'

    const dialogResult = await pdfService.promptSaveDialog({
      defaultName,
      title: 'Guardar PDF Comprimido',
      fileSize,
      currentView: 'compress'
    })

    if (!dialogResult) return

    if (dialogResult.action === 'save') {
      const copied = await pdfService.copyFile(lastOperationResult.outputPath, dialogResult.fileName)
      if (copied) {
        showNotification(`PDF guardado correctamente como ${dialogResult.fileName}`, 'success')
      } else {
        showNotification('Error al guardar el archivo', 'error')
      }
    } else if (dialogResult.action === 'chain') {
      if (fileInfo) {
        showNotification('Redirigiendo...', 'success')
        navigateTo(dialogResult.targetView, {
          fileInfo,
          returnTo: { view: 'compress', payload: { restoreState: true } }
        })
      }
    }
  } catch (e) {
    showNotification('Error al guardar', 'error')
  } finally {
    saveBtn.disabled = false
    saveBtn.innerHTML = originalHtml
  }
}


