/**
 * A failed speech request is sent again after 1 s, then after 3 s. Each attempt has its own
 * deadline, and all attempts together stay within the first deadline plus 20 s. Only failures that
 * can pass by themselves are retried; a cancelled dictation stops the wait at once.
 */

import { SPEECH_RETRY_DELAYS_MS, SPEECH_RETRY_EXTRA_MS } from '../../../shared/gemini-constants'
import type { TranslationErrorCode, TranslationResult } from '../../../shared/types'

/** Retry decision per error code (see tests/speech-retry.test.ts). UNKNOWN covers 5xx and empty replies. */
const RETRYABLE: ReadonlySet<TranslationErrorCode> = new Set([
  'NETWORK',
  'TIMEOUT',
  'QUOTA_EXHAUSTED',
  'UNKNOWN'
])

/** A retry with less time than this left would only time out (and still cost a request) */
const MIN_ATTEMPT_MS = 5000

let delays: readonly number[] = SPEECH_RETRY_DELAYS_MS

/** Test hook: other suites fail fast with no automatic retries; no argument restores the schedule. */
export function setRetryDelaysForTests(next: readonly number[] = SPEECH_RETRY_DELAYS_MS): void {
  delays = next
}

export function isRetryable(result: TranslationResult): boolean {
  return !result.success && !!result.errorCode && RETRYABLE.has(result.errorCode)
}

export interface SpeechRetryOptions {
  /** One request with the given deadline */
  attempt: (deadlineMs: number) => Promise<TranslationResult>
  /** False once the dictation was cancelled or replaced */
  isActive: () => boolean
  /** Aborted when the dictation ends; cuts the wait short */
  signal: AbortSignal
  /** Deadline of the first attempt; later ones get what is left of the cap, at most this */
  firstDeadlineMs: number
  /** Called when a retry is about to wait */
  onWait: () => void
  now?: () => number
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/** The final result, or null when the dictation ended meanwhile (nothing may be shown or pasted). */
export async function runSpeechAttempts(o: SpeechRetryOptions): Promise<TranslationResult | null> {
  const now = o.now ?? Date.now
  const start = now()
  const cap = o.firstDeadlineMs + SPEECH_RETRY_EXTRA_MS
  let result = await o.attempt(o.firstDeadlineMs)
  for (const delay of delays) {
    if (!o.isActive()) return null
    if (!isRetryable(result) || cap - (now() - start) - delay < MIN_ATTEMPT_MS) return result
    o.onWait()
    await wait(delay, o.signal)
    if (!o.isActive()) return null
    result = await o.attempt(Math.min(o.firstDeadlineMs, cap - (now() - start)))
  }
  return o.isActive() ? result : null
}
