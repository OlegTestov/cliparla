/**
 * Dictation State Manager
 *
 * Manages the voice dictation workflow using a formal state machine:
 * 1. Toggle mode: press hotkey to start, press again to stop
 * 2. Shows listening indicator during recording
 * 3. Shows processing indicator during translation
 * 4. Pastes translated text into active application (or copies it without Accessibility)
 *
 * State Machine:
 * - idle → listening (START)
 * - listening → processing (STOP, AUDIO_READY)
 * - listening → idle (CANCEL)
 * - processing → idle (COMPLETE, CANCEL, ERROR)
 */

import {
  isAppHidden,
  isBlockingWindowVisible,
  isCaptureOverlayVisible,
  isIndicatorReady,
  onBlockingWindowHidden,
  onBlockingWindowShown,
  onIndicatorNotReady,
  onIndicatorReady,
  requestIndicator,
  setIndicatorEvents,
  showListeningIndicator,
  hideListeningIndicator,
  sendStartListening,
  sendProcessingText,
  sendStartProcessing,
  sendStopListening
} from '../core/window-manager'
import { getDictationTargetLanguage, getUiLanguage } from './store'
import { localizeResult, t as translate } from '../core/localize'
import { app, Notification } from 'electron'
import { getTranslationService } from './translation'
import { deliverText, type DeliveryDeps } from './paste-delivery'
import { setLastResult } from './last-result'
import { cancelCopiedIndicator } from './accessibility-hint'
import { createLogger } from '../core/logger'
import { syncEscapeShortcut } from './dictation/escape-shortcut'
import {
  configureErrorPill,
  errorPillHoldsEsc,
  markErrorPillLost,
  parkErrorPill,
  refreshErrorPill,
  resetErrorPill,
  showErrorPill,
  takeKeptAudio
} from './dictation/error-pill'
import { hasSpeechSignal } from '../../shared/speech-level'
import { runSpeechAttempts } from './dictation/speech-retry'
import { BASE_DEADLINE_MS, speechDeadlineMs } from '../../shared/gemini-constants'
import { clearKeptAudio } from './dictation/kept-audio'
import { AUDIO_ARRIVAL_MS, watchDictationState } from './dictation/watchdog'
import {
  createDictationStateMachine,
  type DictationState,
  type DictationStateMachine
} from './dictation/state-machine'
import { isKeyProblem, recoverFromKeyProblem, type ShowSetup } from '../core/key-recovery'
import type { AudioData, RecordingFailReason } from '../../shared/types'

const log = createLogger('Dictation')

// Maximum audio size in bytes (5 MB)
// Base64 encoding increases size by ~33%, so 5MB binary ≈ 6.67MB base64
// We check the base64 length, so threshold is 5MB * 4/3 ≈ 6.67MB base64 chars
const MAX_AUDIO_SIZE_BYTES = 5 * 1024 * 1024
const MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_SIZE_BYTES * (4 / 3))

// ============================================================================
// State Machine Instance
// ============================================================================

/**
 * Singleton state machine instance with logging for invalid transitions
 */
const stateMachine: DictationStateMachine = createDictationStateMachine(
  (from: DictationState, event: string) => {
    log.warn('Invalid state transition attempted', { from, event })
  }
)

// Subscribe to state changes for logging
stateMachine.subscribe((newState, previousState) => {
  log.debug('State changed', { from: previousState, to: newState })
})

// Every way out of a dictation ends in idle, so this is the one place Esc is released
// While the capture overlay is on screen Esc cancels the capture, not the dictation
const syncEscape = (): void =>
  syncEscapeShortcut(
    (stateMachine.getState() !== 'idle' || errorPillHoldsEsc()) && !isCaptureOverlayVisible(),
    cancelDictation
  )
stateMachine.subscribe(syncEscape)
configureErrorPill({
  canShow: () => isIndicatorReady() && !isBlockingWindowVisible() && !isAppHidden(),
  running: () => stateMachine.getState() !== 'idle',
  onChange: syncEscape
})
onIndicatorReady(refreshErrorPill)
onIndicatorNotReady(markErrorPillLost)
onBlockingWindowHidden(refreshErrorPill)
// Becoming active again (Cmd+Tab, Dock, tray, unhide) brings back what waited for it;
// 'activate' alone fires only for a Dock click or relaunch
app.on('did-become-active', refreshErrorPill)
app.on('activate', refreshErrorPill)
onBlockingWindowShown(parkErrorPill)
onBlockingWindowShown(syncEscape)
onBlockingWindowHidden(syncEscape)

// The audio main holds while a request is under way: kept for Retry if the request cannot finish
let processingAudio: AudioData | null = null

// True once the renderer reports its recorder is running (the microphone prompt can take a while)
let recordingStarted = false

// True between a watchdog-initiated stop and the arrival of the audio
let audioPending = false

function onAudioMissing(): void {
  audioPending = false
  log.warn('The audio did not arrive after the watchdog stopped the recording')
  rejectAudio(currentSession)
}

// A dictation that never ends is ended, so the hotkey, Esc and indicator are not stuck.
// A recording that ran too long is processed (the audio is kept); anything else is cancelled.
function onDictationStuck(state: DictationState): void {
  if (state === 'listening' && recordingStarted) {
    log.warn('Recording overran its limit, processing what was recorded')
    audioPending = true
    stopListeningAndProcess()
    // The audio should come back at once; a dead indicator must not hold the dictation for long
    watchDictationState('processing', onAudioMissing, AUDIO_ARRIVAL_MS)
    return
  }
  log.warn('Dictation stuck, ending it', { state })
  const audio = state === 'processing' ? processingAudio : null
  endDictation()
  if (audio) showErrorPill(translate('error.TIMEOUT', getUiLanguage()), audio)
}

stateMachine.subscribe((newState) => {
  if (newState !== 'processing') {
    recordingStarted = false
    audioPending = false
    processingAudio = null
  }
  watchDictationState(newState, () => onDictationStuck(newState))
})

// Identifies the current dictation. Cancelling or starting a new one changes it,
// so an answer for an older session can be recognised and dropped.
let currentSession = 0
// Aborted with every new session: pending automatic retries stop at once
let sessionAbort = new AbortController()

function newSession(): void {
  currentSession++
  sessionAbort.abort()
  sessionAbort = new AbortController()
}

// ============================================================================
// Public API
// ============================================================================

/** True when a message from the renderer belongs to the dictation that is under way. */
export function isCurrentSession(session: number): boolean {
  return session === currentSession
}

/** The renderer's recorder is running: the listening clock restarts from here. */
export function markRecordingStarted(session: number): void {
  if (!isCurrentSession(session) || stateMachine.getState() !== 'listening') return
  recordingStarted = true
  watchDictationState('listening', () => onDictationStuck('listening'))
}

/**
 * Get current dictation state
 */
export function getDictationState(): DictationState {
  return stateMachine.getState()
}

/**
 * Toggle dictation: start if idle, stop if listening.
 * If already processing, ignore the hotkey press.
 */
export function toggleDictation(): void {
  const currentState = stateMachine.getState()
  log.debug('Toggle called', { currentState })

  if (currentState === 'listening') {
    // Stop recording and start processing
    stopListeningAndProcess()
  } else if (currentState === 'idle') {
    // Start recording
    startDictation()
  }
  // If 'processing' - ignore (already handling audio)
}

/**
 * Start dictation: show indicator and begin recording
 */
export function startDictation(): void {
  // One gate for the indicator: a page that is not ready (loading, crashed) starts nothing
  const gate = requestIndicator()
  if (gate !== 'ready') {
    log.warn('The indicator page is not ready, not starting a dictation', { gate })
    // 'loading' is only a moment; 'dead' needs a restart, and a repeat press hears it again
    if (gate === 'loading') notifyGettingReady()
    else notifyIndicatorDead()
    return
  }
  // Try to transition to listening state
  const success = stateMachine.send({ type: 'START' })
  if (!success) {
    log.warn('Cannot start dictation - invalid state transition')
    return
  }
  newSession()
  cancelCopiedIndicator()
  resetErrorPill()

  log.info('Starting dictation')

  // Send IPC to reset UI state before showing window
  // (prevents stale content flash on Windows due to Window Recycling)
  sendStartListening(currentSession)

  // Show the listening indicator (uses showInactive to not steal focus)
  showListeningIndicator()
}

/**
 * Stop recording and switch to processing mode.
 * The indicator window stays visible showing "Processing..."
 */
export function stopListeningAndProcess(): void {
  // Try to transition to processing state
  const success = stateMachine.send({ type: 'STOP' })
  if (!success) {
    log.warn('Cannot stop listening - invalid state transition')
    return
  }

  log.info('Stopping recording, switching to processing')

  // Send IPC to stop recording (triggers audio data collection and send)
  sendStartProcessing()

  // Window stays visible, UI switches to "Processing..."
}

/**
 * Finish dictation: hide indicator and reset state.
 * Called after successful paste or on error.
 */
export function finishDictation(): void {
  // Try to transition to idle state via COMPLETE
  const success = stateMachine.send({ type: 'COMPLETE', result: { success: true } })
  if (!success) {
    // If COMPLETE doesn't work, force reset
    log.warn('Could not complete normally, forcing reset')
    stateMachine.reset()
  }

  log.info('Finishing dictation, hiding indicator')

  // Tell renderer to reset state
  sendStopListening()

  // Hide the indicator window
  hideListeningIndicator()
}

/**
 * Cancel dictation: stop recording without processing.
 * Used for error cases or manual cancellation.
 *
 * This function is idempotent - safe to call multiple times.
 * Cleanup checklist:
 * - Stop MediaRecorder (handled by renderer via sendStopListening)
 * - Close audio stream tracks (handled by renderer)
 * - Clear auto-stop timeout (handled by renderer)
 * - Cancel animation frames (handled by renderer)
 * - Reset state to 'idle'
 * - Hide indicator window
 */
export function cancelDictation(): void {
  resetErrorPill() // the user closed the card or cancelled: the kept audio goes too
  endDictation()
}

/** Stop whatever is running and hide the indicator, keeping any kept audio and card. */
function endDictation(): void {
  const previousState = stateMachine.getState()
  log.info('Ending dictation', { previousState })
  newSession()

  // Try to transition via CANCEL event
  const success = stateMachine.send({ type: 'CANCEL' })
  if (!success) {
    // If already idle, just ensure cleanup
    if (previousState !== 'idle') {
      log.warn('Cancel failed, forcing reset')
      stateMachine.reset()
    }
  }

  // Tell renderer to stop recording and reset
  // This triggers cleanup in the renderer (MediaRecorder, stream, timeouts, etc.)
  sendStopListening()

  // Hide the indicator
  hideListeningIndicator()

  log.info('Cancellation complete')
}

/**
 * Main refused the audio of the current dictation (unusable payload): end it now and say so
 * in the indicator instead of waiting for the watchdog. There is nothing to retry.
 */
export function rejectAudio(session: number): void {
  if (!isCurrentSession(session) || stateMachine.getState() === 'idle') return
  log.warn('Audio of the current dictation was rejected')
  newSession()
  if (!stateMachine.send({ type: 'CANCEL' })) stateMachine.reset()
  showErrorPill(translate('dictation.payload.message', getUiLanguage()))
}

/** Retry button: send the kept audio again as a new dictation. */
export function retryDictation(deps: DictationDeps = {}): void {
  if (stateMachine.getState() !== 'idle' || !isIndicatorReady()) return
  const audio = takeKeptAudio()
  if (!audio) return
  log.info('Retrying the last dictation')
  stateMachine.send({ type: 'START' })
  newSession()
  cancelCopiedIndicator()
  // The page leaves the card first, then the window shrinks back to the pill
  sendStartProcessing()
  showListeningIndicator()
  stateMachine.send({ type: 'STOP' })
  void handleDictationComplete(audio, deps)
}

/**
 * The renderer could not deliver audio: return to idle so the next hotkey starts again.
 * `empty` (nothing recorded, a deliberate instant stop) also closes the indicator;
 * other reasons leave it showing the error. A report from an older session is ignored.
 */
export function failRecording(session: number, reason: RecordingFailReason): void {
  if (session !== currentSession) return
  if (stateMachine.getState() === 'idle') return
  newSession()
  if (!stateMachine.send({ type: 'CANCEL' })) stateMachine.reset()
  log.warn('Recording failed in the renderer, back to idle', { reason })
  if (reason === 'empty') {
    sendStopListening()
    hideListeningIndicator()
  }
}

export interface DictationDeps extends DeliveryDeps {
  showSetup?: ShowSetup
}

/**
 * Handle audio data received from renderer after recording stops.
 * Translates it with the TranslationService, then pastes the result.
 */
export async function handleDictationComplete(
  audioData: AudioData,
  deps: DictationDeps = {}
): Promise<void> {
  log.info('Received audio data', {
    mimeType: audioData.mimeType,
    dataLength: audioData.audioBase64.length
  })

  const currentState = stateMachine.getState()

  // Handle auto-stop case: if we're still in 'listening' state when audio arrives,
  // it means the renderer auto-stopped (the recording limit was reached).
  // Transition to 'processing' automatically via AUDIO_READY event.
  if (currentState === 'listening') {
    log.info('Auto-transitioning from listening to processing (auto-stop triggered)')
    const success = stateMachine.send({ type: 'AUDIO_READY', data: audioData })
    if (!success) {
      log.warn('Failed to auto-transition to processing')
      return
    }
  }

  // Validate we're in the right state
  if (stateMachine.getState() !== 'processing') {
    log.warn('Received audio data but not in processing state, ignoring')
    return
  }

  if (audioPending) {
    audioPending = false
    watchDictationState('processing', () => onDictationStuck('processing'))
  }

  processingAudio = audioData
  const session = currentSession
  const signal = sessionAbort.signal
  const isCurrent = (): boolean =>
    session === currentSession && stateMachine.getState() === 'processing'

  try {
    // Get settings
    const targetLanguage = getDictationTargetLanguage()

    // Validate audio data
    if (!audioData.audioBase64 || audioData.audioBase64.length === 0) {
      failWithPill(translate('dictation.noAudio.message', getUiLanguage()))
      return
    }

    // Quick size check (O(1) - just comparing string length)
    if (audioData.audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
      const actualSizeMB = ((audioData.audioBase64.length * 3) / 4 / (1024 * 1024)).toFixed(2)
      log.error('Audio exceeds size limit', new Error('Audio too large'), {
        base64Length: audioData.audioBase64.length,
        estimatedSizeMB: actualSizeMB,
        limitMB: 5
      })
      failWithPill(translate('dictation.tooLarge.message', getUiLanguage(), { size: actualSizeMB }))
      return
    }

    // A clip that never rose above the noise floor has nothing to transcribe; a model would invent text
    if (!hasSpeechSignal(audioData.level)) {
      log.info('No speech in the clip, not sending it', { level: audioData.level })
      // Keep the clip for Retry, without its level: the user may know better than the meter
      const { level: _level, ...unjudged } = audioData
      void _level
      failWithPill(translate('errormsg.noSpeechHeard', getUiLanguage()), unjudged)
      return
    }

    log.info('Translating speech', { targetLanguage })
    const service = getTranslationService()
    const result = await runSpeechAttempts({
      attempt: (deadlineMs) =>
        service.translateSpeech(
          audioData.audioBase64,
          audioData.mimeType,
          targetLanguage,
          audioData.durationMs,
          deadlineMs,
          // The pill shows the text as it arrives; the paste still waits for the final text
          { signal, onText: (text) => isCurrent() && sendProcessingText(text) }
        ),
      isActive: isCurrent,
      signal,
      firstDeadlineMs: speechDeadlineMs(BASE_DEADLINE_MS, audioData.durationMs),
      onWait: () => sendStartProcessing(true)
    })

    // Check if user cancelled (or started another dictation) while API was processing
    if (!result || !isCurrent()) {
      log.info('Operation was cancelled during API processing, ignoring result')
      return
    }

    if (result.success && result.text) {
      clearKeptAudio() // delivered or copied below: nothing left to retry
      setLastResult(result.text)
      // Hide indicator before pasting (need to do this first)
      finishDictation()
      log.info('Translation successful, pasting text')

      // Paste the translated text into active application
      await deliverText(result.text, {
        ...deps,
        indicatorAllowed: () => session === currentSession
      })

      log.info('Text delivered')
    } else if (isKeyProblem(result)) {
      // Setup opens; the card keeps the audio so Retry works once the key is fixed, and waits
      // (the processing pill goes away now) until the setup window is gone
      const language = getUiLanguage()
      sendStopListening()
      hideListeningIndicator()
      recoverFromKeyProblem(result, deps.showSetup)
      failWithPill(
        localizeResult(result, language).error || translate('error.UNKNOWN', language),
        audioData
      )
      log.info('Key missing or rejected, opened setup')
    } else {
      // The audio is fine, the request failed: show the reason and offer Retry
      const language = getUiLanguage()
      const message = localizeResult(result, language).error || translate('error.UNKNOWN', language)
      const malformed = result.errorCode === 'INVALID_REQUEST' && !result.noSpeech
      failWithPill(message, malformed ? undefined : audioData)
    }
  } catch (error) {
    // An obsolete session must not tear down the one that replaced it
    if (session !== currentSession) return

    log.error(
      'Error in dictation workflow',
      error instanceof Error ? error : new Error(String(error))
    )

    // The state is already idle when the failure came after finishDictation()
    const message = translate('error.UNKNOWN', getUiLanguage())
    if (stateMachine.getState() === 'processing') failWithPill(message, audioData)
    // Already idle: the translation succeeded and delivery was attempted. Retrying could deliver twice
    else showErrorPill(message)
  }
}

/** Leave processing and show the error in the indicator; `audio` makes Retry available. */
function failWithPill(message: string, audio?: AudioData): void {
  if (!stateMachine.send({ type: 'ERROR', error: new Error(message) })) stateMachine.reset()
  showErrorPill(message, audio)
}

const GETTING_READY_NOTICE_GAP_MS = 10_000
let lastGettingReadyNotice = -Infinity

/** A hotkey press during a load says what is going on, but not more often than every 10 s. */
function notifyGettingReady(): void {
  const t = Date.now()
  if (t - lastGettingReadyNotice < GETTING_READY_NOTICE_GAP_MS || !Notification.isSupported())
    return
  lastGettingReadyNotice = t
  new Notification({
    title: 'Cliparla',
    body: translate('dictation.indicatorLoading.message', getUiLanguage())
  }).show()
}

const DEAD_NOTICE_GAP_MS = 30_000
let lastDeadNotice = -Infinity

/** Test hook: forget when the notices were last shown. */
export function resetIndicatorNoticesForTests(): void {
  lastGettingReadyNotice = -Infinity
  lastDeadNotice = -Infinity
}

/** Tells the user to restart; the gate's episode notice and a repeated hotkey share a 30 s gap. */
function notifyIndicatorDead(): void {
  const t = Date.now()
  if (t - lastDeadNotice < DEAD_NOTICE_GAP_MS || !Notification.isSupported()) return
  lastDeadNotice = t
  new Notification({
    title: 'Cliparla',
    body: translate('dictation.indicatorDead.message', getUiLanguage())
  }).show()
}

// The indicator page died or stays dead. What was running ends; audio main holds is kept for Retry.
// The message waits for the page like any card.
setIndicatorEvents({
  onGone: () => {
    const wasRunning = stateMachine.getState() !== 'idle'
    const audio = stateMachine.getState() === 'processing' ? processingAudio : null
    if (wasRunning) {
      endDictation()
      showErrorPill(
        translate('dictation.rendererGone.message', getUiLanguage()),
        audio ?? undefined
      )
    }
  },
  onDead: notifyIndicatorDead
})
