import { app, BrowserWindow, clipboard, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'path'
import { showSettingsWindow, showSetupWindow } from '../core/window-manager'
import { startCapture } from '../core/capture-gate'
import { apiKeyStore } from './api-key'
import { toggleDictation } from './dictation'
import { getRecentResults, hasLastResult, onLastResultChange } from './last-result'
import { showToast } from './toast'
import { recentLabel } from '../../shared/recent-label'
import { pasteLastResult } from './paste-last'
import { createLogger } from '../core/logger'
import { t as translate } from '../core/localize'
import { languageLabel } from '../../shared/language-label'
import { dictationChoices } from '../../shared/language-choices'
import { KEEP_LANGUAGE } from '../../shared/types'
import { FEEDBACK_URL } from '../../shared/app-info'
import {
  getPreferredLanguages,
  getScreenshotTargetLanguage,
  getDictationTargetLanguage,
  setScreenshotTargetLanguage,
  setDictationTargetLanguage,
  getCaptureShortcut,
  getUiLanguage,
  getDictationShortcut,
  getPasteLastShortcut
} from './store'

const log = createLogger('Tray')

const PASTE_AFTER_MENU_MS = 150

// Keep a global reference to prevent garbage collection
let tray: Tray | null = null

/**
 * Get the path to tray icon.
 * macOS: Template icon for automatic dark/light mode adaptation.
 * Windows: Regular RGBA icon (app icon scaled to 32x32).
 */
function getTrayIconPath(): string {
  const resourcesPath = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(__dirname, '../../resources')

  // macOS uses Template images (@2x auto-loaded on Retina)
  // Windows uses a regular RGBA icon
  const iconName = process.platform === 'darwin' ? 'trayIconTemplate.png' : 'trayIcon.png'
  return join(resourcesPath, iconName)
}

/**
 * Notify the settings window that settings have changed from tray.
 * This allows the renderer to reload and sync its UI.
 */
function notifySettingsChanged(): void {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    win.webContents.send('settings-changed-from-tray')
  })
}

/** "Recent": the last results, newest first; a click copies the whole text. */
function recentMenuItem(
  language: ReturnType<typeof getUiLanguage>
): Electron.MenuItemConstructorOptions {
  const results = getRecentResults()
  return {
    label: translate('tray.recent', language),
    submenu:
      results.length > 0
        ? results.map((text) => ({
            label: recentLabel(text),
            click: (): void => {
              clipboard.writeText(text)
              showToast(translate('toast.copied', getUiLanguage()))
            }
          }))
        : [{ label: translate('tray.recentEmpty', language), enabled: false }]
  }
}

/**
 * Build and set the tray context menu with current settings.
 * Call this whenever settings change to update checkmarks.
 */
export function updateTrayMenu(): void {
  if (!tray) return

  const language = getUiLanguage()
  const preferredLanguages = getPreferredLanguages()
  const screenshotLang = getScreenshotTargetLanguage()
  const dictationLang = getDictationTargetLanguage()

  // Build menu items array
  const menuItems: Electron.MenuItemConstructorOptions[] = []

  // The screenshot section needs preferred languages
  if (preferredLanguages.length > 0) {
    // Screenshot Translation Section
    menuItems.push(
      { label: translate('tray.translateScreenshot', language), enabled: false },
      ...preferredLanguages.map((lang) => ({
        label: languageLabel(lang, language),
        type: 'checkbox' as const,
        checked: screenshotLang === lang,
        click: (): void => {
          setScreenshotTargetLanguage(lang)
          updateTrayMenu()
          notifySettingsChanged()
        }
      })),
      { type: 'separator' as const }
    )
  }

  // Dictation Translation Section: "Keep my language" needs no preferred language
  menuItems.push(
    { label: translate('tray.translateDictation', language), enabled: false },
    ...dictationChoices(preferredLanguages).map((lang) => ({
      label:
        lang === KEEP_LANGUAGE
          ? translate('language.keepMine', language)
          : languageLabel(lang, language),
      type: 'checkbox' as const,
      checked: dictationLang === lang,
      click: (): void => {
        setDictationTargetLanguage(lang)
        updateTrayMenu()
        notifySettingsChanged()
      }
    })),
    { type: 'separator' as const }
  )

  // Quick Actions section
  menuItems.push(
    { type: 'separator' as const },
    {
      label: translate('tray.takeScreenshot', language),
      accelerator: getCaptureShortcut(),
      click: (): void => {
        if (apiKeyStore.hasKey()) {
          startCapture()
        } else {
          showSetupWindow('MISSING_KEY')
        }
      }
    },
    {
      label: translate('tray.startDictation', language),
      accelerator: getDictationShortcut(),
      click: (): void => {
        if (apiKeyStore.hasKey()) {
          toggleDictation()
        } else {
          showSetupWindow('MISSING_KEY')
        }
      }
    },
    {
      label: translate('tray.pasteLast', language),
      // An empty string would show an empty key hint: no hint when the hotkey is off
      ...(getPasteLastShortcut() ? { accelerator: getPasteLastShortcut() } : {}),
      enabled: hasLastResult(),
      toolTip: hasLastResult() ? undefined : translate('tray.pasteLastEmpty', language),
      // The menu has closed and the previous app is getting the keyboard back
      click: (): void => void setTimeout(() => void pasteLastResult(), PASTE_AFTER_MENU_MS)
    },
    recentMenuItem(language),
    { type: 'separator' as const }
  )

  // Standard menu items
  menuItems.push(
    {
      label: translate('tray.open', language),
      click: (): void => {
        if (process.platform === 'darwin' && app.dock) {
          app.dock.show()
        }
        showSettingsWindow()
      }
    },
    {
      label: translate('tray.feedback', language),
      click: (): void =>
        void shell
          .openExternal(FEEDBACK_URL)
          .catch((error) =>
            log.warn('Could not open the feedback page', { message: String(error) })
          )
    },
    {
      label: translate('tray.quit', language),
      click: (): void => {
        app.quit()
      }
    }
  )

  const contextMenu = Menu.buildFromTemplate(menuItems)

  tray.setContextMenu(contextMenu)
}

/**
 * Creates the system tray icon with context menu.
 * Provides quick access to Settings and app controls.
 */
export function createTray(): Tray {
  const iconPath = getTrayIconPath()
  const icon = nativeImage.createFromPath(iconPath)

  // Mark as template image for macOS (adapts to light/dark menu bar)
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }

  tray = new Tray(icon)
  tray.setToolTip('Cliparla')
  onLastResultChange(updateTrayMenu)

  // Build initial menu with current settings
  updateTrayMenu()

  // On Windows, show menu on left click as well
  if (process.platform === 'win32') {
    tray.on('click', () => {
      tray?.popUpContextMenu()
    })
  }

  log.info('System tray created')
  return tray
}

/**
 * Destroy the tray icon. Should be called on app quit.
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
    log.info('System tray destroyed')
  }
}
