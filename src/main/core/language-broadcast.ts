/**
 * Windows are created hidden at startup and load their language once, so a
 * language chosen later has to be pushed to each of them.
 */

import { IPC_CHANNELS } from '../../shared/ipc-types'

interface Broadcastable {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export function broadcastUiLanguage(windows: Broadcastable[], language: string): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.UI_LANGUAGE_CHANGED, language)
  }
}
