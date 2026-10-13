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
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault()
    const view = (item as HTMLElement).dataset.view
    if (view) {
      navigateTo(view as ViewName)
    }
  })
})

// Header settings button click
document.getElementById('header-settings-btn')?.addEventListener('click', () => {
  navigateTo('settings')
})

// Prevent default drag and drop behavior for the entire window
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// Boot the app — show scan view by default
navigateTo('scan')


