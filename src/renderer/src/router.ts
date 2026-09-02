import { renderReorder } from './views/reorder'
import { renderMerge } from './views/merge'
import { renderSplit } from './views/split'

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

  switch (view) {
    case 'reorder':
      renderReorder(container, payload)
      break
    case 'merge':
      renderMerge(container)
      break
    case 'split':
      renderSplit(container)
      break
    case 'compress':
      renderComingSoon(container, view)
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
      <button id="back-btn" class="btn-icon" title="Volver">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <h2>${labels[view] || view}</h2>
    </div>
    <div class="coming-soon">
      <span style="font-size:3rem">🚧</span>
      <h2>Próximamente</h2>
      <p>Esta función estará disponible en una próxima versión.</p>
      <button class="btn-secondary" id="back-home-btn">Volver al inicio</button>
    </div>
  `

  document.getElementById('back-btn')!.addEventListener('click', () => navigateTo('home'))
  document.getElementById('back-home-btn')!.addEventListener('click', () => navigateTo('home'))
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

