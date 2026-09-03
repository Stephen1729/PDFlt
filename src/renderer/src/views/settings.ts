import { showNotification } from '../router'

export async function renderSettings(container: HTMLElement): Promise<void> {
  const version = await window.electronAPI.getAppVersion()

  container.innerHTML = `
    <div class="view-header">
      <h2>Configuración</h2>
    </div>
    
    <div style="padding: 24px; max-width: 600px;">
      <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
        <h3 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          </svg>
          PDFlt
        </h3>
        <p style="color: var(--text-muted); margin-bottom: 24px;">Versión instalada: <strong id="version-text">v${version}</strong></p>
        
        <div id="update-status" style="margin-bottom: 16px; font-size: 0.95rem; display: none;"></div>
        
        <div id="progress-container" style="display: none; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.85rem;">
            <span>Descargando...</span>
            <span id="progress-percent">0%</span>
          </div>
          <div style="width: 100%; height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
            <div id="progress-bar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.2s ease;"></div>
          </div>
        </div>

        <div style="display: flex; gap: 12px;">
          <button id="check-update-btn" class="btn-primary">Buscar Actualizaciones</button>
          <button id="download-update-btn" class="btn-primary" style="display: none;">Descargar Actualización</button>
          <button id="install-update-btn" class="btn-secondary" style="display: none; border-color: var(--success); color: var(--success);">Reiniciar e Instalar</button>
        </div>
      </div>
    </div>
  `

  const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement
  const downloadBtn = document.getElementById('download-update-btn') as HTMLButtonElement
  const installBtn = document.getElementById('install-update-btn') as HTMLButtonElement
  const statusEl = document.getElementById('update-status') as HTMLDivElement
  const progressContainer = document.getElementById('progress-container') as HTMLDivElement
  const progressBar = document.getElementById('progress-bar') as HTMLDivElement
  const progressPercent = document.getElementById('progress-percent') as HTMLSpanElement

  let cleanupListener: (() => void) | null = null

  const setStatus = (msg: string, color: string = 'var(--text)') => {
    statusEl.style.display = 'block'
    statusEl.textContent = msg
    statusEl.style.color = color
  }

  // Bind IPC listener
  cleanupListener = window.electronAPI.onUpdateEvent((event) => {
    switch (event.type) {
      case 'checking':
        checkBtn.disabled = true
        checkBtn.textContent = 'Buscando...'
        setStatus('Buscando actualizaciones en GitHub...', 'var(--text-muted)')
        break
      case 'available':
        checkBtn.style.display = 'none'
        downloadBtn.style.display = 'block'
        setStatus(`¡Nueva versión disponible! (v${event.data.version})`, 'var(--primary)')
        break
      case 'not-available':
        checkBtn.disabled = false
        checkBtn.textContent = 'Buscar Actualizaciones'
        setStatus('Ya tienes la última versión instalada.', 'var(--success)')
        break
      case 'progress':
        downloadBtn.disabled = true
        downloadBtn.textContent = 'Descargando...'
        progressContainer.style.display = 'block'
        const percent = Math.round(event.data.percent)
        progressBar.style.width = `${percent}%`
        progressPercent.textContent = `${percent}%`
        break
      case 'downloaded':
        downloadBtn.style.display = 'none'
        progressContainer.style.display = 'none'
        installBtn.style.display = 'block'
        setStatus('¡Actualización descargada y lista para instalar!', 'var(--success)')
        break
      case 'error':
        checkBtn.disabled = false
        checkBtn.style.display = 'block'
        downloadBtn.style.display = 'none'
        checkBtn.textContent = 'Reintentar'
        setStatus(`Error: ${event.data}`, 'var(--error)')
        showNotification('Ocurrió un error al actualizar', 'error')
        break
    }
  })

  // Button handlers
  checkBtn.addEventListener('click', () => {
    window.electronAPI.checkForUpdates()
  })

  downloadBtn.addEventListener('click', () => {
    window.electronAPI.downloadUpdate()
  })

  installBtn.addEventListener('click', () => {
    window.electronAPI.installUpdate()
  })

  // Cleanup on unmount
  const observer = new MutationObserver((mutations) => {
    if (!document.contains(container)) {
      if (cleanupListener) cleanupListener()
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}