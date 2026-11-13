/**
 * Esc cancels a dictation. The global Escape key is held only while a dictation
 * is listening or processing, so Esc keeps working in every other app.
 */

import { globalShortcut } from 'electron'
import { createLogger } from '../../core/logger'

const log = createLogger('EscapeShortcut')

let wanted = false
let handler: () => void = () => undefined
let mine = false

function apply(): void {
  try {
    const registered = globalShortcut.isRegistered('Escape')
    if (wanted && !registered) {
      mine = globalShortcut.register('Escape', handler)
      if (!mine) log.warn('Escape is taken by another app, Esc will not cancel dictation')
    } else if (!wanted && mine) {
      mine = false
      globalShortcut.unregister('Escape')
    }
  } catch (error) {
    log.error('Could not change the Escape shortcut', error as Error)
  }
}

/** Hold Escape while `active`, release it otherwise. Never throws; safe to call repeatedly. */
export function syncEscapeShortcut(active: boolean, onEscape: () => void): void {
  wanted = active
  handler = onEscape
  apply()
}

/** Something called unregisterAll(): take Escape again if a dictation still needs it. */
export function resyncEscapeShortcut(): void {
  apply()
}

/** App quit: give Escape back. */
export function releaseEscapeShortcut(): void {
  syncEscapeShortcut(false, () => undefined)
}

/** Test hook: forget what this module believes it registered. */
export function resetEscapeShortcutForTests(): void {
  wanted = false
  mine = false
  handler = () => undefined
}
