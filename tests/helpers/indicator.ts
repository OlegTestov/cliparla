/** Helpers for sending IPC messages as the indicator window and reading the session main sent it. */

import { sentMessages, trustedEvent } from './electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../../src/main/core/window-manager')

/** An IPC event as sent by the indicator window. */
export const indicatorEvent = (): object => ({
  ...trustedEvent,
  sender: { id: windowManager.get('listening').webContents.id }
})

/** The session number main attached to its latest `listening-mode-start`. */
export const sessionOfLastStart = (): number =>
  sentMessages.filter((m) => m.channel === 'listening-mode-start').pop()!.args[0] as number
