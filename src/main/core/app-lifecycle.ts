import { app, BrowserWindow } from 'electron'
import { installSignalQuit } from './quit-policy'
import { createLogger } from './logger'

const log = createLogger('AppLifecycle')

/**
 * Configuration for app lifecycle management
 */
export interface AppLifecycleConfig {
  /** Called when app is ready */
  onReady: () => Promise<void>
  /** Called when dock icon is clicked (macOS) */
  onActivate: () => void
  /** Called before app quits - can prevent quit */
  onBeforeQuit: (event: Electron.Event) => void
  /** Called when app is about to quit - cleanup */
  onWillQuit: () => void
  /** Called when all windows are closed */
  onWindowAllClosed: () => void
  /** Called when second instance is launched */
  onSecondInstance: () => void
}

/**
 * Initialize app lifecycle event handlers.
 * This sets up all Electron app events with the provided callbacks.
 *
 * @param config Configuration with callbacks for each lifecycle event
 */
export function initializeAppLifecycle(config: AppLifecycleConfig): void {
  log.info('Initializing app lifecycle handlers')

  // Handle second instance - focus the settings window
  app.on('second-instance', () => {
    log.info('Second instance detected')
    config.onSecondInstance()
  })

  // Main ready handler
  app.whenReady().then(async () => {
    log.info('App ready')
    await config.onReady()
  })

  // macOS: re-create windows when dock icon clicked
  app.on('activate', () => {
    log.debug('Activate event')
    config.onActivate()
  })

  // A signal must end the app even while windows are hidden
  installSignalQuit(process, () => app.quit())

  // Before quit handler
  app.on('before-quit', (event) => {
    log.debug('Before quit event')
    config.onBeforeQuit(event)
  })

  // Cleanup when app is quitting
  app.on('will-quit', () => {
    log.info('Will quit - cleaning up')
    config.onWillQuit()
  })

  // Handle all windows closed
  app.on('window-all-closed', () => {
    log.debug('All windows closed')
    config.onWindowAllClosed()
  })

  log.info('App lifecycle handlers initialized')
}

/**
 * Request single instance lock.
 * If another instance is already running, this will return false.
 *
 * @returns true if this is the first instance, false otherwise
 */
export function requestSingleInstanceLock(): boolean {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    log.info('Another instance is already running, quitting')
  } else {
    log.info('Single instance lock acquired')
  }
  return gotTheLock
}

/**
 * Show dock icon on macOS.
 * No-op on other platforms.
 */
export async function showDock(): Promise<void> {
  if (process.platform === 'darwin' && app.dock) {
    await app.dock.show()
    log.info('Dock icon shown')
  }
}

/**
 * Hide dock icon on macOS.
 * No-op on other platforms.
 */
export function hideDock(): void {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
    log.info('Dock icon hidden')
  }
}

/**
 * Hide all provided windows.
 *
 * @param windows Array of windows to hide
 */
export function hideAllWindows(windows: (BrowserWindow | null)[]): void {
  for (const window of windows) {
    if (window) {
      window.hide()
    }
  }
  log.debug('All windows hidden')
}

/**
 * Check if running on macOS.
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * Quit the application.
 */
export function quitApp(): void {
  log.info('Quitting application')
  app.quit()
}
