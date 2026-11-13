/**
 * The audio of a dictation that was not delivered (a failed request, a dead indicator, a key
 * problem) is kept so Retry can send it again. It is independent of what the screen shows: a
 * crash, a reload or a closed card never drops it. It is cleared by a successful delivery, by
 * the user closing the card, by a new dictation, by quit, and after 10 minutes (privacy bound).
 */

import type { AudioData } from '../../../shared/types'

export const KEPT_AUDIO_MAX_AGE_MS = 10 * 60_000

interface Kept {
  audio: AudioData
  /** What the card says */
  message: string
}

const expiredListeners: Array<() => void> = []

/** Called when kept audio ran out of time (not when it is cleared on purpose). */
export function onKeptAudioExpired(listener: () => void): void {
  expiredListeners.push(listener)
}

let kept: Kept | null = null
let expiry: ReturnType<typeof setTimeout> | null = null

export function keepAudio(audio: AudioData, message: string): void {
  clearKeptAudio()
  kept = { audio, message }
  expiry = setTimeout(() => {
    clearKeptAudio()
    expiredListeners.forEach((listener) => listener())
  }, KEPT_AUDIO_MAX_AGE_MS)
  expiry.unref?.()
}

export const keptAudio = (): Kept | null => kept

export function clearKeptAudio(): void {
  if (expiry) clearTimeout(expiry)
  expiry = null
  kept = null
}

/** Retry: hand the audio over; whoever holds it now keeps it or delivers it. */
export function takeKeptAudio(): AudioData | null {
  const audio = kept?.audio ?? null
  clearKeptAudio()
  return audio
}
