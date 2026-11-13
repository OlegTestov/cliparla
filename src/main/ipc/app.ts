/**
 * IPC App Handler
 *
 * Domain: open-external, get-app-version, fit-window-height
 */

import { app, BrowserWindow, shell } from 'electron'
import { handle, on } from '../core/ipc-guard'
import { fitWindowHeight, resetWindowHeight } from '../core/window-manager'
import { asNeededHeight } from '../core/window-fit'
import { createLogger } from '../core/logger'
import { IPC_CHANNELS } from '../../shared/ipc-types'

const log = createLogger('IPC:App')

/** Only plain web links may be opened from the renderer. */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export interface AppHandlerDeps {
  /** The window that owns a page (default: Electron's lookup) */
  windowFor?: (sender: Electron.WebContents) => BrowserWindow | null
}

export function registerAppHandlers(deps: AppHandlerDeps = {}): void {
  const windowFor = deps.windowFor ?? ((sender) => BrowserWindow.fromWebContents(sender))

  // A page that needs more room than its window has (long translations, notices)
  on(IPC_CHANNELS.FIT_WINDOW_HEIGHT, (event, height: unknown): void => {
    const needed = asNeededHeight(height)
    const win = windowFor(event.sender)
    if (needed !== null && win) fitWindowHeight(win, needed)
  })

  // Only the sender's own window: a page cannot resize another one
  on(IPC_CHANNELS.RESET_WINDOW_HEIGHT, (event): void => {
    const win = windowFor(event.sender)
    if (win) resetWindowHeight(win)
  })

  handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: unknown): Promise<void> => {
    if (!isSafeExternalUrl(url)) {
      log.warn('Blocked non-https external URL')
      return
    }
    await shell.openExternal(url)
  })

  handle(IPC_CHANNELS.GET_APP_VERSION, (): string => app.getVersion())
}
