/**
 * IPC Dictation Handler
 *
 * Handles dictation-related IPC communication between main and renderer processes.
 * Every dictation channel is accepted only from the indicator window.
 */

import { on } from '../core/ipc-guard'
import {
  isFromIndicatorMainFrame,
  isFromListeningWindow,
  markIndicatorPageBroken,
  markIndicatorPageReady
} from '../core/window-manager'
import {
  handleDictationComplete,
  cancelDictation,
  failRecording,
  markRecordingStarted,
  rejectAudio,
  retryDictation,
  isCurrentSession,
  stopListeningAndProcess
} from '../services/dictation'
import { setCopiedIndicatorHover } from '../services/accessibility-hint'
import { setErrorPillHover } from '../services/dictation/error-pill'
import { createLogger } from '../core/logger'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import type { SpeechLevel } from '../../shared/speech-level'
import { MAX_RECORDING_DURATION, MAX_REPORTED_DURATION_MS } from '../../shared/recording-limits'
import {
  RECORDING_FAIL_REASONS,
  type AudioPayload,
  type RecordingFailure
} from '../../shared/types'

const log = createLogger('IPC:Dictation')

const isSession = (value: unknown): value is number => typeof value === 'number'

/** A malformed measurement is dropped (the clip is then sent), never trusted. */
function validLevel(level: unknown): level is SpeechLevel {
  const l = level as Partial<SpeechLevel> | null
  return (
    !!l &&
    typeof l === 'object' &&
    typeof l.peak === 'number' &&
    Number.isFinite(l.peak) &&
    l.peak >= 0 &&
    l.peak <= 1.5 &&
    typeof l.activeMs === 'number' &&
    Number.isFinite(l.activeMs) &&
    l.activeMs >= 0 &&
    l.activeMs <= MAX_REPORTED_DURATION_MS
  )
}

function parseAudio(payload: unknown): AudioPayload | null {
  const p = payload as Partial<AudioPayload> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.audioBase64 !== 'string' || typeof p.mimeType !== 'string') return null
  if (!isSession(p.session)) return null
  // Usable audio with a bad duration is still processed, with the longest allowed deadline
  const ms = p.durationMs
  const validMs =
    typeof ms === 'number' && Number.isFinite(ms) && ms > 0 && ms <= MAX_REPORTED_DURATION_MS
  return {
    audioBase64: p.audioBase64,
    mimeType: p.mimeType,
    session: p.session,
    durationMs: validMs ? ms : MAX_RECORDING_DURATION * 1000,
    ...(validLevel(p.level) ? { level: p.level } : {})
  }
}

function parseFailure(payload: unknown): RecordingFailure | null {
  const p = payload as Partial<RecordingFailure> | null
  if (!p || typeof p !== 'object' || !isSession(p.session)) return null
  const reason = RECORDING_FAIL_REASONS.find((r) => r === p.reason)
  return reason ? { session: p.session, reason } : null
}

/**
 * Register dictation-related IPC handlers.
 */
export function registerDictationHandlers(): void {
  /**
   * Handler for when audio recording is complete.
   * Triggered by the listening indicator renderer after user stops recording.
   */
  on(IPC_CHANNELS.AUDIO_DATA_READY, (event, payload: unknown): void => {
    if (!isFromListeningWindow(event)) {
      log.warn('Audio data not from the indicator window, ignoring')
      return
    }
    const audio = parseAudio(payload)
    if (!audio) {
      log.warn('Malformed audio payload')
      // A broken payload of the dictation under way must not leave it waiting for the watchdog
      const session = (payload as { session?: unknown } | null)?.session
      if (isSession(session)) rejectAudio(session)
      return
    }
    if (!isCurrentSession(audio.session)) {
      log.info('Audio from an older dictation, ignoring')
      return
    }
    log.info('Audio data received, processing...')
    handleDictationComplete({
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      level: audio.level
    })
  })

  /**
   * Handler for cancelling dictation.
   * Stops recording/processing and cleans up resources.
   */
  on(IPC_CHANNELS.CANCEL_DICTATION, (event): void => {
    if (!isFromListeningWindow(event)) return
    log.info('Dictation cancelled by user')
    cancelDictation()
  })

  /** The microphone is open and the recorder runs: the recording limit counts from now. */
  on(IPC_CHANNELS.RECORDING_STARTED, (event, session: unknown): void => {
    if (!isFromListeningWindow(event) || !isSession(session)) return
    markRecordingStarted(session)
  })

  /** The renderer could not record: leave `listening` so the hotkey works again. */
  on(IPC_CHANNELS.RECORDING_FAILED, (event, payload: unknown): void => {
    if (!isFromListeningWindow(event)) return
    const failure = parseFailure(payload)
    if (!failure) {
      log.warn('Malformed recording-failed payload, ignoring')
      return
    }
    failRecording(failure.session, failure.reason)
  })

  /**
   * Handler for stopping dictation via UI button.
   * Stops recording and starts processing (sends audio for translation).
   */
  on(IPC_CHANNELS.STOP_DICTATION, (event): void => {
    if (!isFromListeningWindow(event)) return
    log.info('Dictation stopped by user (UI button)')
    stopListeningAndProcess()
  })

  /** The mouse is over the indicator: a "copied" message stays until it leaves. */
  on(IPC_CHANNELS.INDICATOR_HOVER, (event, hovered: unknown): void => {
    if (!isFromListeningWindow(event) || typeof hovered !== 'boolean') return
    setCopiedIndicatorHover(hovered)
    setErrorPillHover(hovered)
  })

  /** Retry on the error pill: the kept audio goes through the same flow again. */
  on(IPC_CHANNELS.RETRY_DICTATION, (event): void => {
    if (!isFromListeningWindow(event)) return
    retryDictation()
  })

  /** The indicator page has subscribed to main's messages: only now can it be sent anything. */
  on(IPC_CHANNELS.INDICATOR_PAGE_READY, (event): void => {
    // Only the current main frame: a message of a stale frame is not about this page
    if (!isFromIndicatorMainFrame(event)) return
    markIndicatorPageReady()
  })

  /** The page hit a render error: main hides the window and reloads it through the gate. */
  on(IPC_CHANNELS.INDICATOR_PAGE_FAILED, (event): void => {
    if (!isFromIndicatorMainFrame(event)) return
    markIndicatorPageBroken()
  })
}
