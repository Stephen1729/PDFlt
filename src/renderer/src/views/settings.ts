export async function renderSettings(container: HTMLElement): Promise<void> {
  const version = '1.0.0'

  container.innerHTML = `
    <div class="view-header" style="justify-content: center;">
      <h2>Configuración</h2>
    </div>
    
    <div style="padding: 24px; max-width: 600px; margin: 0 auto;">
      <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
        <h3 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          </svg>
          PDFlt para Android
        </h3>
        <p style="color: var(--text-muted); margin-bottom: 24px;">Versión instalada: <strong>v${version}</strong></p>
        
        <div style="margin-top: 16px; font-size: 0.95rem; color: var(--text-muted);">
          <p>Esta es la versión móvil offline de PDFlt. Las actualizaciones se distribuyen a través de la tienda de aplicaciones o mediante un nuevo archivo APK.</p>
        </div>
      </div>
    </div>
  `
}