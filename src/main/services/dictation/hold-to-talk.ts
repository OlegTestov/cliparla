/**
 * Hold-to-talk on the dictation hotkey. The hotkey press starts a dictation as always (Electron
 * reports presses, never releases); the key helper reports the release. A release after at least
 * HOLD_MS ends the recording (push-to-talk); an earlier one is a tap, and the dictation goes on
 * as a toggle. Without a working helper nothing here ever stops a recording: toggle only.
 */

export const HOLD_MS = 300

/** Electron and the helper report one physical press separately; either may come first */
const PRESS_ORDER_SLACK_MS = 150

export interface HoldToTalkDeps {
  now: () => number
  isIdle: () => boolean
  isListening: () => boolean
  /** What the hotkey did before hold-to-talk existed */
  toggle: () => void
  /** Stop recording and send */
  stop: () => void
  holdMs?: number
}

export interface HoldToTalk {
  /** The helper is running with its tap active (false: it never started, or it ended) */
  setHelperReady: (ready: boolean) => void
  /** The dictation hotkey was pressed */
  press: () => void
  /** The helper saw the hotkey go down (a held key does not repeat it) */
  keyDown: () => void
  /** The helper saw the hotkey released */
  keyUp: () => void
}

export function createHoldToTalk(deps: HoldToTalkDeps): HoldToTalk {
  const holdMs = deps.holdMs ?? HOLD_MS
  let helperReady = false
  // When the press that started this recording was made; null: not a press we can time
  let pressedAt: number | null = null
  // When the helper last saw the hotkey go down; a release counts only with such a down
  let downAt: number | null = null

  return {
    setHelperReady(ready) {
      helperReady = ready
      // Nobody will report the release any more: the recording goes on as a toggle
      if (!ready) {
        pressedAt = null
        downAt = null
      }
    },

    press() {
      const startsRecording = deps.isIdle()
      deps.toggle()
      // A press that stops a recording is never a hold
      pressedAt = startsRecording && helperReady && deps.isListening() ? deps.now() : null
    },

    keyDown() {
      downAt = deps.now()
    },

    keyUp() {
      const pressed = pressedAt
      const down = downAt
      pressedAt = null
      downAt = null
      // A release without a down after the press is stray (the real release was lost)
      if (pressed === null || down === null || down < pressed - PRESS_ORDER_SLACK_MS) return
      const heldFor = deps.now() - pressed
      if (heldFor >= holdMs && deps.isListening()) deps.stop()
    }
  }
}
