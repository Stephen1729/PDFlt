import { renderScan, handleScanBack, canLeaveScan } from './views/scan'
import { renderReorder, handleReorderBack, canLeaveReorder } from './views/reorder'
import { renderMerge, handleMergeBack, canLeaveMerge } from './views/merge'
import { renderSplit, handleSplitBack, canLeaveSplit } from './views/split'
import { renderCompress, handleCompressBack, canLeaveCompress } from './views/compress'
import { renderSettings } from './views/settings'

export type ViewName = 'scan' | 'reorder' | 'merge' | 'split' | 'compress' | 'settings'

let currentView: ViewName = 'scan'
let currentBackHandler: (() => void) | null = null

export function getCurrentView(): ViewName {
  return currentView
}

/**
 * Configure or hide the subtle back arrow in the top header
 */
export function setHeaderBackAction(handler: (() => void) | null): void {
  currentBackHandler = handler
  const headerBackBtn = document.getElementById('header-back-btn')
  if (headerBackBtn) {
    headerBackBtn.style.display = handler ? 'flex' : 'none'
  }
}

/**
 * Checks if current view has unsaved state and prompts user before leaving
 */
export async function canLeaveCurrentView(): Promise<boolean> {
  if (currentView === 'scan') {
    return await canLeaveScan()
  } else if (currentView === 'reorder') {
    return await canLeaveReorder()
  } else if (currentView === 'merge') {
    return await canLeaveMerge()
  } else if (currentView === 'split') {
    return await canLeaveSplit()
  } else if (currentView === 'compress') {
    return await canLeaveCompress()
  }
  return true
}

/**
 * Safe navigation with dirty-state guard (used by bottom nav and header settings)
 */
export async function safeNavigateTo(targetView: ViewName, payload?: any): Promise<boolean> {
  if (targetView === currentView && !payload) {
    return true
  }

  const allowed = await canLeaveCurrentView()
  if (!allowed) {
    // Keep active class synced to current view
    document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
      const itemTarget = (item as HTMLElement).dataset.view
      if (itemTarget === currentView) {
        item.classList.add('active')
      } else {
        item.classList.remove('active')
      }
    })
    return false
  }

  navigateTo(targetView, payload)
  return true
}

/**
 * Universal back dispatcher (called by header back button and Android back event)
 */
export function triggerBack(): boolean {
  // 1. Close active save modal if open
  const saveModalOverlay = document.querySelector('.save-modal-overlay')
  if (saveModalOverlay) {
    const cancelBtn = saveModalOverlay.querySelector('#save-modal-cancel') as HTMLButtonElement | null
    if (cancelBtn) {
      cancelBtn.click()
    } else {
      saveModalOverlay.remove()
    }
    return true
  }

  // 2. Close generic modals if any
  const genericModal = document.querySelector('.modal-overlay')
  if (genericModal) {
    genericModal.remove()
    return true
  }

  // 3. Execute registered back handler (e.g. chained workflow returnTo)
  if (currentBackHandler) {
    const handler = currentBackHandler
    handler()
    return true
  }

  // 4. Let the active view handle internal back (close document, step back in stages, etc.)
  if (currentView === 'scan') {
    if (handleScanBack()) return true
  } else if (currentView === 'split') {
    if (handleSplitBack()) return true
  } else if (currentView === 'reorder') {
    if (handleReorderBack()) return true
  } else if (currentView === 'compress') {
    if (handleCompressBack()) return true
  } else if (currentView === 'merge') {
    if (handleMergeBack()) return true
  }

  // 5. If on any secondary view/tab (with no active document), return to home tab ('scan')
  if (currentView !== 'scan') {
    navigateTo('scan')
    return true
  }

  // 6. At root (home scan Stage 0) with nothing open
  return false
}

/**
 * Simple view-based router. Swaps the #main-content content.
 */
export function navigateTo(view: ViewName, payload?: any): void {
  currentView = view
  const container = document.getElementById('main-content')!

  // Update bottom-nav active state
  document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
    item.classList.remove('active')
    const itemTarget = (item as HTMLElement).dataset.view
    if (itemTarget === view) {
      item.classList.add('active')
    }
  })

  // Ensure header is visible by default unless scanner manages it
  if (view !== 'scan') {
    document.body.classList.remove('hide-mobile-header')
  }

  // Hide settings button when in settings view
  const headerSettingsBtn = document.getElementById('header-settings-btn')
  if (headerSettingsBtn) {
    headerSettingsBtn.style.display = view === 'settings' ? 'none' : 'flex'
  }

  // Auto-configure subtle header back arrow if returned from chained workflow or settings
  if (payload?.returnTo) {
    setHeaderBackAction(() => {
      safeNavigateTo(payload.returnTo.view, payload.returnTo.payload)
    })
  } else if (view === 'settings') {
    setHeaderBackAction(() => {
      safeNavigateTo('scan')
    })
  } else {
    setHeaderBackAction(null)
  }

  // Render view immediately for maximum responsiveness
  switch (view) {
    case 'scan':
      renderScan(container, payload)
      break
    case 'reorder':
      renderReorder(container, payload)
      break
    case 'merge':
      renderMerge(container, payload)
      break
    case 'split':
      renderSplit(container, payload)
      break
    case 'compress':
      renderCompress(container, payload)
      break
    case 'settings':
      renderSettings(container)
      break
  }
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

