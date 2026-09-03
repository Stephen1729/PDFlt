import { renderReorder } from './views/reorder'
import { renderMerge } from './views/merge'
import { renderSplit } from './views/split'
import { renderCompress } from './views/compress'

export type ViewName = 'reorder' | 'merge' | 'split' | 'compress'

/**
 * Simple view-based router. Swaps the #main-content content.
 */
export function navigateTo(view: ViewName, payload?: any): void {
  const container = document.getElementById('main-content')!

  // Update sidebar active state
  document.querySelectorAll('.sidebar-nav .nav-item').forEach((item) => {
    item.classList.remove('active')
    if ((item as HTMLElement).dataset.view === view) {
      item.classList.add('active')
    }
  })

  // Render view immediately for maximum responsiveness
  switch (view) {
    case 'reorder':
      renderReorder(container, payload)
      break
    case 'merge':
      renderMerge(container)
      break
    case 'split':
      renderSplit(container, payload)
      break
    case 'compress':
      renderCompress(container, payload)
      break
  }
}

function renderComingSoon(container: HTMLElement, view: string): void {
  const labels: Record<string, string> = {
    merge: 'Unir PDFs',
    split: 'Separar PDF',
    compress: 'Comprimir PDF'
  }

  container.innerHTML = `
    <div class="view-header">
      <button class="btn-icon" id="back-btn" title="Volver">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h2>${labels[view] || view}</h2>
    </div>
    <div class="coming-soon">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 1rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      <h2>Próximamente</h2>
      <p>Esta función estará disponible en una próxima versión.</p>
      <button class="btn-secondary" id="back-home-btn">Volver al inicio</button>
    </div>
  `

  document.getElementById('back-btn')!.addEventListener('click', () => navigateTo('reorder'))
  document.getElementById('back-home-btn')!.addEventListener('click', () => navigateTo('reorder'))
}

/**
 * Show a toast notification.
 */
export function showNotification(
  message: string,
  type: 'success' | 'error' | 'warning' = 'success'
): void {
  const container = document.getElementById('notification-container')!
  const notif = document.createElement('div')
  notif.className = `notification ${type}`
  notif.textContent = message
  container.appendChild(notif)

  setTimeout(() => {
    notif.classList.add('fade-out')
    setTimeout(() => notif.remove(), 250)
  }, 3500)
}

