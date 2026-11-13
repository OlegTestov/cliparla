/**
 * Connects the dictation hotkey, the key helper and the hold-to-talk rule. Everything fails
 * quiet: if the helper cannot run, the hotkey is the toggle it always was.
 */

import { app } from 'electron'
import { hotkeyManager } from '../../core/hotkey-manager'
import { getDictationState, stopListeningAndProcess, toggleDictation } from '../dictation'
import { createKeyHelper } from '../key-helper'
import { createHoldToTalk } from './hold-to-talk'
import { onAccessibilityGranted } from '../accessibility-hint'

const holdToTalk = createHoldToTalk({
  now: Date.now,
  isIdle: () => getDictationState() === 'idle',
  isListening: () => getDictationState() === 'listening',
  toggle: toggleDictation,
  stop: stopListeningAndProcess
})

const keyHelper = createKeyHelper({
  onEvent: (event) => {
    if (event === 'ready') holdToTalk.setHelperReady(true)
    else if (event === 'gone') holdToTalk.setHelperReady(false)
    else if (event === 'down') holdToTalk.keyDown()
    else holdToTalk.keyUp()
  }
})

export interface HoldWiringDeps {
  keyHelper: Pick<ReturnType<typeof createKeyHelper>, 'watch' | 'stop' | 'retryIfNoPermission'>
  holdToTalk: Pick<ReturnType<typeof createHoldToTalk>, 'press'>
  getAccelerator: () => string | null
  isNormalMode: () => boolean
  onAppActive: (listener: () => void) => void
  onGranted: (listener: () => void) => void
}

export function createHoldWiring(deps: HoldWiringDeps) {
  let watchingGrants = false
  return {
    /** The dictation hotkey was pressed (normal mode). */
    pressDictationHotkey(): void {
      // A grant made in System Settings while the app stayed in the background
      deps.keyHelper.retryIfNoPermission()
      deps.holdToTalk.press()
    },
    /** Watch the current dictation hotkey, only while hotkeys do their normal work. */
    syncKeyHelper(): void {
      const accelerator = deps.getAccelerator()
      deps.keyHelper.watch(deps.isNormalMode() && accelerator ? accelerator : null)
    },
    stopKeyHelper(): void {
      deps.keyHelper.stop()
    },
    /** Accessibility may have been granted while the app was in the background. */
    watchKeyHelperGrants(): void {
      if (watchingGrants) return
      watchingGrants = true
      deps.onAppActive(() => deps.keyHelper.retryIfNoPermission())
      deps.onGranted(() => deps.keyHelper.retryIfNoPermission())
    }
  }
}

const wiring = createHoldWiring({
  keyHelper,
  holdToTalk,
  getAccelerator: () => hotkeyManager.getAccelerator('dictation'),
  isNormalMode: () => hotkeyManager.getMode() === 'normal',
  onAppActive: (listener) => void app.on('did-become-active', listener),
  onGranted: onAccessibilityGranted
})

export const { pressDictationHotkey, syncKeyHelper, stopKeyHelper, watchKeyHelperGrants } = wiring
