/**
 * Application menu. Rebuilt whenever the interface language changes.
 */

import { Menu, shell, app } from 'electron'
import { GEMINI_KEY_URL, APP_NAME } from '../../shared/app-info'
import { createLogger } from './logger'
import { getUiLanguage } from '../services/store'
import { t as translate } from './localize'

const log = createLogger('AppMenu')

/**
 * Setup application menu with Help item.
 */
export function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    // Edit menu
    {
      label: translate('menu.edit', getUiLanguage()),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // View menu
    {
      label: translate('menu.view', getUiLanguage()),
      submenu: [
        ...(!app.isPackaged
          ? [
              { role: 'reload' as const },
              { role: 'forceReload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const }
            ]
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: translate('menu.window', getUiLanguage()),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    },
    // Help menu
    {
      label: translate('menu.help', getUiLanguage()),
      submenu: [
        {
          label: translate('menu.getKey', getUiLanguage()),
          click: (): void => {
            shell.openExternal(GEMINI_KEY_URL)
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  log.info('Application menu initialized')
}
