/**
 * A dictation stuck in listening or processing (the indicator never answers, a
 * request never ends) is cancelled, which frees the hotkey, Esc and the indicator.
 */

import {
  BASE_DEADLINE_MS,
  SPEECH_RETRY_EXTRA_MS,
  speechDeadlineMs
} from '../../../shared/gemini-constants'
import { MAX_RECORDING_DURATION } from '../../../shared/recording-limits'
import type { DictationState } from './state-machine'

const SLACK_MS = 10_000

/** After the watchdog stopped a recording, how long its audio may take to arrive. */
export const AUDIO_ARRIVAL_MS = 10_000

export const LISTENING_LIMIT_MS = MAX_RECORDING_DURATION * 1000 + SLACK_MS
// Longer than the retry cap, so the card (with the audio kept) comes from the retry, not from here
export const PROCESSING_LIMIT_MS =
  speechDeadlineMs(BASE_DEADLINE_MS, MAX_RECORDING_DURATION * 1000) +
  SPEECH_RETRY_EXTRA_MS +
  SLACK_MS

let timer: ReturnType<typeof setTimeout> | null = null

/** Call on every state change: restarts the clock for the new state, or stops it at idle. */
export function watchDictationState(
  state: DictationState,
  onStuck: () => void,
  limitMs?: number
): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (state === 'idle') return
  timer = setTimeout(
    () => {
      timer = null
      onStuck()
    },
    limitMs ?? (state === 'listening' ? LISTENING_LIMIT_MS : PROCESSING_LIMIT_MS)
  )
  timer.unref?.()
}

/** Test hook: drop the pending timer. */
export function clearWatchdogForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
