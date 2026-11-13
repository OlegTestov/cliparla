/**
 * A dictation error is shown in the indicator, never in a dialog (a modal box blocks the app and
 * loses the dictation). The card waits while the indicator page is not ready or a setup,
 * permissions or capture window is on screen, and appears when both are clear. A card with Retry
 * stands on the audio in kept-audio.ts; one without Retry closes itself after a few seconds, but
 * not while the pointer is over it. The global Esc is held only for a short while.
 */

import {
  hideListeningIndicator,
  isCursorOverIndicator,
  sendListeningError,
  sendStopListening,
  showListeningIndicator
} from '../../core/window-manager'
import { cancelCopiedIndicator } from '../accessibility-hint'
import {
  clearKeptAudio,
  keepAudio,
  keptAudio,
  onKeptAudioExpired,
  takeKeptAudio as takeKept
} from './kept-audio'
import type { AudioData } from '../../../shared/types'

export const ERROR_PILL_AUTO_HIDE_MS = 6000
/** The global Esc is held this long after the card appears, then given back to other apps. */
export const ERROR_PILL_ESC_MS = 10_000

export interface ErrorPillDeps {
  /** The indicator is ready and no window the card must not cover is on screen */
  canShow: () => boolean
  /** A dictation is running: a card made of kept audio waits */
  running: () => boolean
  /** The card opened or closed (Esc follows) */
  onChange: () => void
}

let deps: ErrorPillDeps = { canShow: () => true, running: () => false, onChange: () => undefined }
let card: { message: string; retry: boolean } | null = null
let shown = false
let expired = false
let hideTimer: ReturnType<typeof setTimeout> | null = null
let escTimer: ReturnType<typeof setTimeout> | null = null
let escHeld = false

export function configureErrorPill(next: ErrorPillDeps): void {
  deps = next
}

export const isErrorPillOpen = (): boolean => shown

/** True while the shown card still owns the global Esc. */
export const errorPillHoldsEsc = (): boolean => shown && escHeld

function stopTimers(): void {
  if (hideTimer) clearTimeout(hideTimer)
  if (escTimer) clearTimeout(escTimer)
  hideTimer = escTimer = null
  escHeld = false
  expired = false
}

function render(message: string, retry: boolean): void {
  stopTimers()
  cancelCopiedIndicator() // its timer would hide this card
  shown = true
  escHeld = true
  escTimer = setTimeout(() => {
    escHeld = false
    escTimer = null
    deps.onChange()
  }, ERROR_PILL_ESC_MS)
  escTimer.unref?.()
  // The page switches to the card first, then the window grows (the other way round it flashes)
  sendListeningError({ message, retry })
  showListeningIndicator('error')
  if (!retry) armHideTimer()
  deps.onChange()
}

function armHideTimer(): void {
  hideTimer = setTimeout(() => {
    hideTimer = null
    // The pointer decides now, not a flag from earlier: over the card it waits for the pointer to leave
    if (isCursorOverIndicator()) expired = true
    else close()
  }, ERROR_PILL_AUTO_HIDE_MS)
  hideTimer.unref?.()
}

/** Show the card now, or when the indicator and the screen allow. `audio` is kept for Retry. */
export function showErrorPill(message: string, audio?: AudioData): void {
  if (audio) keepAudio(audio, message)
  stopTimers()
  shown = false
  card = { message, retry: !!audio }
  refreshErrorPill()
  // A card that has to wait (setup in front, page down) must not leave "Processing..." on screen
  if (!shown) {
    sendStopListening()
    hideListeningIndicator()
  }
}

/** The indicator became ready or a window went away: show the card that was waiting. */
export function refreshErrorPill(): void {
  if (shown || !deps.canShow()) return
  if (!card) {
    const k = keptAudio()
    if (!k || deps.running()) return
    card = { message: k.message, retry: true }
  }
  render(card.message, card.retry)
}

// The audio ran out of time: a card that offered Retry now only informs
onKeptAudioExpired(() => {
  if (!card?.retry) return
  card = { message: card.message, retry: false }
  // The content changes and, being only information now, the card gets a hide timer (Esc keeps its schedule)
  if (!shown) return
  sendListeningError({ message: card.message, retry: false })
  if (!hideTimer && !expired) armHideTimer()
})

/** A setup, permissions or capture window opened: the card steps aside (and gives Esc back). */
export function parkErrorPill(): void {
  if (!shown) return
  stopTimers()
  shown = false
  sendStopListening()
  hideListeningIndicator()
  deps.onChange()
}

/** The indicator page died: the card is gone from the screen but not forgotten. */
export function markErrorPillLost(): void {
  stopTimers()
  if (shown) {
    shown = false
    deps.onChange()
  }
}

function close(): void {
  resetErrorPill()
  sendStopListening()
  hideListeningIndicator()
}

/** The user closed the card, or a new dictation started: forget the card and the kept audio. */
export function resetErrorPill(): void {
  stopTimers()
  card = null
  clearKeptAudio()
  if (shown) {
    shown = false
    deps.onChange()
  }
}

/** Retry: the kept audio, and the card is forgotten (the caller restores the pill layout). */
export function takeKeptAudio(): AudioData | null {
  const audio = takeKept()
  if (!audio) return null
  stopTimers()
  card = null
  if (shown) {
    shown = false
    deps.onChange()
  }
  return audio
}

/** The pointer left the indicator. */
export function setErrorPillHover(isOver: boolean): void {
  if (shown && !isOver && expired) close()
}
