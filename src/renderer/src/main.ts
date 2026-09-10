import './styles/theme.css'
import './styles/global.css'
import './styles/components.css'
import { App } from '@capacitor/app'
import { navigateTo, triggerBack, ViewName } from './router'

// Subtle Header back button click
document.getElementById('header-back-btn')?.addEventListener('click', () => {
  triggerBack()
})

// Native Android hardware & gesture back button handling
try {
  App.addListener('backButton', () => {
    const handled = triggerBack()
    if (!handled) {
      App.exitApp()
    }
  })
} catch (err) {
  console.warn('Capacitor App plugin not supported in this environment', err)
}

// Keyboard Escape shortcut for testing/desktop
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    triggerBack()
  }
})

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


