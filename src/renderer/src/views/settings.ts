export async function renderSettings(container: HTMLElement): Promise<void> {
  const version = '1.3.3'

  container.innerHTML = `
    <div class="view-header" style="justify-content: center;">
      <h2>Información y Ayuda</h2>
    </div>
    
    <div style="padding: 20px 16px; max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px;">
      <!-- App Card -->
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px;">
        <h3 style="margin-bottom: 8px; display: flex; align-items: center; gap: 10px; font-size: 1.15rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          PDFlt para Android
        </h3>
        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 16px;">Versión instalada: <strong>v${version}</strong></p>
        
        <div class="bottom-info" style="padding: 12px 14px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); justify-content: flex-start; gap: 10px; font-size: 0.84rem; line-height: 1.45;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <div>
            <strong style="color: var(--text-primary); display: block;">100% Local y Privado</strong>
            Tus documentos nunca se suben a servidores externos ni requieren conexión.
          </div>
        </div>
      </div>

      <!-- FAQ / Help Card -->
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px;">
        <h4 style="margin-bottom: 12px; font-size: 0.95rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          ¿Dónde se guardan mis archivos?
        </h4>
        <p style="color: var(--text-muted); font-size: 0.84rem; line-height: 1.5; margin-bottom: 14px;">
          Todos los PDFs generados se guardan directamente en la carpeta <strong>Documentos</strong> de tu dispositivo Android. Puedes acceder a ellos en cualquier momento desde Google Files o cualquier explorador de archivos.
        </p>

        <h4 style="margin-bottom: 12px; font-size: 0.95rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          Permisos requeridos
        </h4>
        <p style="color: var(--text-muted); font-size: 0.84rem; line-height: 1.5;">
          • <strong>Cámara:</strong> Solo se utiliza al presionar "Tomar fotos" para capturar documentos físicos.<br>
          • <strong>Almacenamiento:</strong> Solo se utiliza para guardar el PDF final y leer los archivos que selecciones.
        </p>
      </div>
    </div>
  `
}