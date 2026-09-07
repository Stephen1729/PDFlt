import './styles/theme.css'
import './styles/global.css'
import './styles/components.css'
import { navigateTo, ViewName } from './router'

// Setup bottom-nav event listeners
const moreMenuContainer = document.getElementById('more-menu-container')
const moreMenuBackdrop = document.getElementById('more-menu-backdrop')

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault()
    const view = (item as HTMLElement).dataset.view
    if (view === 'more') {
      if (moreMenuContainer) {
        const isShown = moreMenuContainer.style.display === 'block'
        moreMenuContainer.style.display = isShown ? 'none' : 'block'
      }
      return
    }

    if (moreMenuContainer) {
      moreMenuContainer.style.display = 'none'
    }

    if (view) {
      navigateTo(view as ViewName)
    }
  })
})

// More menu item clicks
document.querySelectorAll('.more-menu-item').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    const view = (btn as HTMLElement).dataset.view as ViewName
    if (moreMenuContainer) {
      moreMenuContainer.style.display = 'none'
    }
    if (view) {
      navigateTo(view)
    }
  })
})

// Close more menu when clicking backdrop
moreMenuBackdrop?.addEventListener('click', () => {
  if (moreMenuContainer) {
    moreMenuContainer.style.display = 'none'
  }
})

// Prevent default drag and drop behavior for the entire window
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// Boot the app — show scan view by default
navigateTo('scan')

