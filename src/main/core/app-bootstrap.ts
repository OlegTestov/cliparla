/**
 * App Bootstrap - Application initialization and lifecycle callbacks
 *
 * Contains all the business logic for app lifecycle events.
 * Separated from index.ts to keep entry point minimal.
 */

import { createLogger } from './logger'
import { app } from 'electron'
import { hideDock, isMacOS } from './app-lifecycle'
import { handleBeforeQuit } from './quit-policy'
import { setupApplicationMenu } from './app-menu'
import { hotkeyManager } from './hotkey-manager'
import { startCapture } from './capture-gate'
import * as windowManager from './window-manager'
import { hasSeenTryIt, store } from '../services/store'
import { nextAfterPermissions, nextAfterSetup, startsSilently } from './onboarding-flow'
import { apiKeyStore } from '../services/api-key'
import { registerAllIpcHandlers } from '../ipc'
import { createTray, destroyTray, updateTrayMenu } from '../services/tray'
import {
  pressDictationHotkey,
  stopKeyHelper,
  syncKeyHelper,
  watchKeyHelperGrants
} from '../services/dictation/hold-wiring'
import { pasteLastResult } from '../services/paste-last'
import { warmUpPasteHelper } from '../services/mac-paste-helper'
import { releaseEscapeShortcut } from '../services/dictation/escape-shortcut'
import { clearKeptAudio } from '../services/dictation/kept-audio'
import {
  optionalPermissionsMissing,
  screenRecordingMissing,
  getPermissionsStatus,
  triggerScreenRecordingDialog
} from '../services/permissions'
import type { AppLifecycleConfig } from './app-lifecycle'

const log = createLogger('Bootstrap')

/**
 * Show the right window once a key exists: Screen Recording setup if it is
 * missing, then the one-time "Try it now" step, otherwise settings.
 */
async function showMainWindow(options: {
  triggerScreenDialog: boolean
  /** First-run key save: also offer Microphone and Accessibility */
  offerOptional?: boolean
  /** Hide the setup window once the next window is up (no Dock icon flicker in between) */
  closeSetup?: boolean
}): Promise<void> {
  if (options.triggerScreenDialog) {
    // Trigger screen recording dialog AFTER the key is set up
    const status = getPermissionsStatus()
    if (status.screenRecording !== 'granted') {
      log.info('Screen recording not granted, triggering system dialog')
      // Small delay for better UX (user sees the transition)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await triggerScreenRecordingDialog()
    }
  }

  const status = getPermissionsStatus()
  const next = nextAfterSetup(screenRecordingMissing(status), {
    offer: options.offerOptional ?? false,
    missing: optionalPermissionsMissing(status)
  })
  if (next === 'permissions') {
    log.info('Showing permissions window', { screen: status.screenRecording })
    windowManager.showPermissionsWindow()
  } else if (hasSeenTryIt()) {
    windowManager.showSettingsWindow()
  } else {
    windowManager.showSetupWindow('TRY_IT')
    return
  }
  if (options.closeSetup) windowManager.hideSetupWindow()
}

/**
 * Pick the starting window: key setup first, then permissions/settings.
 */
async function showStartWindow(options: {
  triggerScreenDialog: boolean
  /** Launch only: a set-up app opens no window (a reopen or activate still opens Settings) */
  silentWhenReady?: boolean
}): Promise<void> {
  if (!apiKeyStore.hasKey()) {
    hotkeyManager.setMode('protected')
    updateTrayMenu() // start-up may have repaired a stored shortcut
    windowManager.showSetupWindow()
    return
  }
  hotkeyManager.setMode('normal')
  updateTrayMenu() // start-up may have repaired a stored shortcut
  if (
    options.silentWhenReady &&
    startsSilently(screenRecordingMissing(getPermissionsStatus()), hasSeenTryIt())
  ) {
    log.info('Set up: starting without a window')
    return
  }
  await showMainWindow(options)
}

/**
 * Create lifecycle configuration with all callbacks.
 */
export function createLifecycleConfig(
  deps: { warmUpPasteHelper?: () => Promise<void> } = {}
): AppLifecycleConfig {
  return {
    onReady: async () => {
      // A menu-bar app: the Dock icon appears only while Settings, setup or permissions is open
      hideDock()
      // Decrypt the stored key once, before any window or hotkey needs it
      await apiKeyStore.load()
      void (deps.warmUpPasteHelper ?? warmUpPasteHelper)() // its slow first start must not hit the first paste
      registerAllIpcHandlers(
        {
          onKeyChanged: (status) => {
            hotkeyManager.setMode(status.configured ? 'normal' : 'protected')
            updateTrayMenu()
          },
          onSetupDone: () => {
            if (!apiKeyStore.hasKey()) {
              windowManager.hideSetupWindow()
              return
            }
            void showMainWindow({
              triggerScreenDialog: true,
              offerOptional: !hasSeenTryIt(),
              closeSetup: true
            })
          }
        },
        {
          // Permissions "Continue": the Try it now step if it is still pending, else Settings
          onContinue: () => {
            const granted = !screenRecordingMissing(getPermissionsStatus())
            if (nextAfterPermissions(!hasSeenTryIt(), granted) === 'tryit') {
              windowManager.showSetupWindow('TRY_IT')
            } else {
              windowManager.showSettingsWindow()
            }
          }
        }
      )

      windowManager.registerDefaultWindows()
      windowManager.createAll()

      log.info('Store initialized', {
        captureShortcut: store.get('captureShortcut'),
        screenshotTargetLanguage: store.get('screenshotTargetLanguage'),
        dictationShortcut: store.get('dictationShortcut'),
        dictationTargetLanguage: store.get('dictationTargetLanguage'),
        hasApiKey: apiKeyStore.hasKey()
      })

      createTray()
      setupApplicationMenu()

      await showStartWindow({ triggerScreenDialog: true, silentWhenReady: true })
    },

    onActivate: () => {
      if (windowManager.isVisible('setup')) {
        windowManager.focus('setup')
        return
      }
      if (windowManager.isVisible('permissions')) {
        windowManager.focus('permissions')
        return
      }
      const settingsWindow = windowManager.getSettingsWindow()
      if (settingsWindow) {
        if (settingsWindow.isMinimized()) settingsWindow.restore()
        windowManager.showSettingsWindow()
      } else {
        windowManager.registerDefaultWindows()
        windowManager.createAll()
        void showStartWindow({ triggerScreenDialog: false })
      }
    },

    onBeforeQuit: (event) => {
      handleBeforeQuit(event, windowManager)
    },

    onWillQuit: () => {
      clearKeptAudio()
      releaseEscapeShortcut()
      hotkeyManager.unregisterAll()
      stopKeyHelper()
      destroyTray()
    },

    onWindowAllClosed: () => {
      if (!isMacOS()) {
        app.quit()
      }
    },

    onSecondInstance: () => {
      const settingsWindow = windowManager.getSettingsWindow()
      if (settingsWindow) {
        if (settingsWindow.isMinimized()) settingsWindow.restore()
        windowManager.showSettingsWindow()
      }
    }
  }
}

/**
 * Initialize hotkey manager with callbacks.
 */
export function initializeHotkeys(): void {
  hotkeyManager.onChange(syncKeyHelper)
  watchKeyHelperGrants()
  hotkeyManager.initialize({
    capture: {
      normalCallback: () => {
        log.debug('Capture hotkey pressed (normal)')
        startCapture()
      },
      protectedCallback: () => {
        log.debug('Capture hotkey pressed (protected)')
        windowManager.showSetupWindow('MISSING_KEY')
      }
    },
    dictation: {
      normalCallback: () => {
        log.debug('Dictation hotkey pressed (normal)')
        pressDictationHotkey()
      },
      protectedCallback: () => {
        log.debug('Dictation hotkey pressed (protected)')
        windowManager.showSetupWindow('MISSING_KEY')
      }
    },
    copyText: {
      normalCallback: () => {
        log.debug('Copy-text hotkey pressed (normal)')
        startCapture({}, 'copyText')
      },
      protectedCallback: () => {
        log.debug('Copy-text hotkey pressed (protected)')
        windowManager.showSetupWindow('MISSING_KEY')
      }
    },
    // Works in both modes: the last result stays usable even if the key was removed
    pasteLast: {
      normalCallback: () => void pasteLastResult(),
      protectedCallback: () => void pasteLastResult()
    }
  })
}

export { windowManager }
