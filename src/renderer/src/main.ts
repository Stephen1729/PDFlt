import './styles/theme.css'
import './styles/global.css'
import './styles/components.css'
import { navigateTo, ViewName } from './router'

// Setup sidebar event listeners
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault()
    const view = (item as HTMLElement).dataset.view as ViewName
    if (view) {
      navigateTo(view)
    }
  })
})

// Prevent default drag and drop behavior for the entire window
// so that missing the drop zone doesn't open the PDF in the app window.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// Boot the app — show reorder view by default
navigateTo('reorder')

