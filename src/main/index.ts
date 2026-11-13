/**
 * Cliparla - Main Process Entry Point
 *
 * Minimal bootstrap file that:
 * 1. Sets the app identity (must come first)
 * 2. Requests single instance lock
 * 3. Initializes all modules via app-bootstrap
 */

import './core/identity'
import {
  initializeAppLifecycle,
  requestSingleInstanceLock,
  quitApp,
  isMacOS
} from './core/app-lifecycle'
import { createLifecycleConfig, initializeHotkeys } from './core/app-bootstrap'
import { createLogger } from './core/logger'

const log = createLogger('Main')

// ============================================================================
// Global Error Handlers
// ============================================================================

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)))
})

// ============================================================================
// Single Instance Lock
// ============================================================================

if (!requestSingleInstanceLock()) {
  quitApp()
}

// ============================================================================
// Initialize Modules
// ============================================================================

// Initialize hotkey manager
initializeHotkeys()

// Initialize app lifecycle with callbacks
const lifecycleConfig = createLifecycleConfig()

// Override onWindowAllClosed to handle quit on non-macOS
const originalOnWindowAllClosed = lifecycleConfig.onWindowAllClosed
lifecycleConfig.onWindowAllClosed = () => {
  originalOnWindowAllClosed()
  if (!isMacOS()) {
    quitApp()
  }
}

initializeAppLifecycle(lifecycleConfig)
