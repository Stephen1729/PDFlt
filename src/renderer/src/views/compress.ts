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

export function renderCompress(container: HTMLElement, payload?: any): void {
  currentFileInfo = null
  selectedLevel = 'recommended'
  isCompressing = false

  container.innerHTML = `
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.29 7 12 12 20.71 7"></polyline>
          <line x1="12" y1="22" x2="12" y2="12"></line>
        </svg>
        <h3>Comprimir PDF</h3>
        <p>Arrastra tu PDF aquí o haz clic para seleccionar</p>
        <button id="open-btn" class="btn-primary" style="margin-top: 1rem;">Seleccionar PDF</button>
      </div>
    </div>

    <div id="compress-workspace" style="display:none; width: 100%; max-width: 800px; margin: 0 auto; padding: 2rem;">
      
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
          <div class="card-icon">⚡</div>
          <h3>Fuerte</h3>
          <p>Mínimo tamaño. Menor resolución (100 DPI). Ideal para enviar por correo o límites web.</p>
        </div>

        <div class="compression-card selected" data-level="recommended">
          <div class="card-icon">⭐</div>
          <h3>Equilibrada</h3>
          <p>Mejor relación calidad/tamaño (150 DPI). Ideal para fotos, escaneos y lectura en pantalla.</p>
        </div>

        <div class="compression-card" data-level="basic">
          <div class="card-icon">✨</div>
          <h3>Ligera</h3>
          <p>Sin pérdida. Mantiene vectores y texto seleccionable. Limpia metadatos y estructura.</p>
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

      <!-- Result Section -->
      <div id="result-container" style="display: none; text-align: center; margin-bottom: 2rem; padding: 1.5rem; background: var(--bg-secondary); border-radius: 12px; border: 1px solid var(--border);">
        <h3 style="margin-bottom: 1rem; color: var(--success);">¡Compresión Completada!</h3>
        <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; font-size: 1.2rem;">
          <span id="result-old-size" style="color: var(--text-muted); text-decoration: line-through;"></span>
          <span>➔</span>
          <span id="result-new-size" style="font-weight: bold; color: var(--text);"></span>
          <span id="result-savings" style="color: var(--success); font-weight: 600; padding: 4px 8px; background: rgba(74, 222, 128, 0.1); border-radius: 16px; font-size: 0.9rem;"></span>
        </div>
      </div>

      <!-- Action Bar -->
      <div class="action-bar" style="justify-content: center; flex-wrap: wrap;">
        <button id="compress-btn" class="btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"></polyline>
            <polyline points="20 10 14 10 14 4"></polyline>
            <line x1="14" y1="10" x2="21" y2="3"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          Comprimir PDF
        </button>
        <button id="save-btn" class="btn-primary" style="display: none;">Descargar PDF (Guardar)</button>
        <div class="chain-actions" id="chain-actions" style="display: none;">
          <span style="color:var(--text-muted); font-size: 0.85rem">o continuar en:</span>
          <button id="to-reorder" class="btn-secondary" title="Reordenar">➡️ Reordenar</button>
          <button id="to-merge" class="btn-secondary" title="Unir">➡️ Unir</button>
          <button id="to-split" class="btn-secondary" title="Separar">➡️ Separar</button>
        </div>
      </div>

    </div>
  `

  setupEventListeners()

  if (payload && payload.fileInfo) {
    loadPdf(payload.fileInfo)
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
      const paths = Array.from(files)
        .map(f => window.electronAPI.getFilePath(f))
        .filter(p => p && p.toLowerCase().endsWith('.pdf'))
        
      if (paths.length > 0) {
        const infos = await window.electronAPI.processDroppedFiles([paths[0]])
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
  document.getElementById('save-btn')?.addEventListener('click', () => handleSaveFinal(false))
  document.getElementById('to-reorder')?.addEventListener('click', () => handleSaveFinal(true, 'reorder'))
  document.getElementById('to-merge')?.addEventListener('click', () => handleSaveFinal(true, 'merge'))
  document.getElementById('to-split')?.addEventListener('click', () => handleSaveFinal(true, 'split'))
}

async function handleOpenFile(): Promise<void> {
  const fileInfo = await window.electronAPI.openPdfDialog()
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
      const result = await window.electronAPI.compressStructural(currentFileInfo.filePath, toTemp)
      progressBar.style.width = '100%'
      progressPercent.textContent = '100%'
      await showResult(result)
    } else {
      // Canvas based compression
      const arrayBuffer = await window.electronAPI.readPdfFile(currentFileInfo.filePath)
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

      const result = await window.electronAPI.assembleCompressedPdf(imagesBase64, dimensions, toTemp)
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
    const fileInfo = await window.electronAPI.getFileInfo(result.outputPath)
    
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
      document.getElementById('chain-actions')!.style.display = 'inline-flex'
    }
  } else {
    showNotification(result.error || 'Error al comprimir', 'error')
    compressBtn.disabled = false
  }
  
  setTimeout(() => {
    progressContainer.style.display = 'none'
  }, 1000)
}

async function handleSaveFinal(chaining: boolean, targetView?: string) {
  if (!lastOperationResult || !lastOperationResult.outputPath) return
  
  if (chaining && targetView) {
    const fileInfo = await window.electronAPI.getFileInfo(lastOperationResult.outputPath)
    if (fileInfo) {
      showNotification('Redirigiendo...', 'success')
      navigateTo(targetView as any, { fileInfo })
    }
  } else {
    const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
    const originalHtml = saveBtn.innerHTML
    saveBtn.disabled = true
    saveBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Guardando...'
    
    try {
      const defaultName = currentFileInfo?.fileName.replace(/\.pdf$/i, '_comprimido.pdf') || 'comprimido.pdf'
      const savePath = await window.electronAPI.saveFileDialog(defaultName)
      
      if (savePath) {
        const copied = await window.electronAPI.copyFile(lastOperationResult.outputPath, savePath)
        if (copied) {
          showNotification('Guardado exitosamente', 'success')
        } else {
          showNotification('Error al guardar el archivo', 'error')
        }
      }
    } catch (e) {
      showNotification('Error al guardar', 'error')
    } finally {
      saveBtn.disabled = false
      saveBtn.innerHTML = originalHtml
    }
  }
}
