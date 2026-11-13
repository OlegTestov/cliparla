/**
 * "Paste last result": deliver the last dictation or screen translation again,
 * the same way a dictation is delivered (paste, or copy when pasting is not possible).
 */

import { BrowserWindow } from 'electron'
import { createLogger } from '../core/logger'
import { deliverText, type DeliveryDeps } from './paste-delivery'
import { getLastResult } from './last-result'

const log = createLogger('PasteLast')

export interface PasteLastDeps extends DeliveryDeps {
  /** True when one of Cliparla's own windows has the keyboard: a paste would land there */
  ownWindowFocused?: () => boolean
}

const defaultOwnWindowFocused = (): boolean =>
  BrowserWindow.getAllWindows().some((window) => window.isFocused())

let inFlight = false
let testDeps: PasteLastDeps = {}

/** Test hook: how the hotkey and tray item deliver (null: the real way). */
export function setPasteLastDepsForTests(deps: PasteLastDeps | null): void {
  testDeps = deps ?? {}
}

/** Returns false when there is nothing to paste. */
export async function pasteLastResult(deps: PasteLastDeps = testDeps): Promise<boolean> {
  const text = getLastResult()
  if (!text) {
    log.info('Nothing to paste yet')
    return false
  }
  if (inFlight) {
    log.info('A paste is already under way, ignoring the press')
    return false
  }
  const { ownWindowFocused, ...delivery } = deps
  const own = (ownWindowFocused ?? defaultOwnWindowFocused)()
  inFlight = true
  try {
    await deliverText(text, { ...delivery, copyOnly: own })
  } finally {
    inFlight = false
  }
  return true
}
