/**
 * ipcMain wrappers that accept messages only from our own app documents.
 * Every IPC handler is registered through these, never through ipcMain directly.
 */

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { createLogger } from './logger'
import { isTrustedSender } from './trust'
import { getTrustConfig } from './trust-config'

const log = createLogger('IPC:Guard')

/* eslint-disable @typescript-eslint/no-explicit-any */
export function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event, getTrustConfig())) {
      log.warn('Rejected invoke from untrusted sender', { channel })
      throw new Error('Untrusted IPC sender')
    }
    return listener(event, ...args)
  })
}

export function on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => any): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event, getTrustConfig())) {
      log.warn('Ignored message from untrusted sender', { channel })
      return
    }
    return listener(event, ...args)
  })
}
