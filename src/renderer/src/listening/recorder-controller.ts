/**
 * Recorder and indicator logic of the listening window, free of React and of
 * browser globals so it can be tested with fakes. Every message to main carries
 * the session main sent with `listening-mode-start`.
 */

import { StreamGate } from './stream-gate'
import { nextMode, type ListeningMode, type ModeEvent } from './mode'
import type {
  AudioPayload,
  CopiedHint,
  DictationErrorPayload,
  RecordingFailure
} from '../../../shared/types'
import type { SpeechLevel } from '../../../shared/speech-level'
import { MAX_RECORDING_DURATION, MAX_REPORTED_DURATION_MS } from '../../../shared/recording-limits'

export { MAX_RECORDING_DURATION }

// Opus speech is clear at 48 kbps: 180 s is about 1.1 MB (Chromium's default is 128 kbps)
export const AUDIO_BITS_PER_SECOND = 48_000

export function recorderOptions(mimeType: string): MediaRecorderOptions {
  return { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
}
// The last seconds show "Recording ends in N s"; nothing is shown before
export const COUNTDOWN_SECONDS = 15

export interface LevelMeter {
  result(): SpeechLevel | null
  stop(): void
}

export type RecorderLike = Pick<
  MediaRecorder,
  'state' | 'mimeType' | 'ondataavailable' | 'onstop' | 'onerror' | 'start' | 'stop'
>

export interface RecorderDeps {
  getUserMedia: () => Promise<MediaStream>
  createRecorder: (stream: MediaStream) => RecorderLike
  blobToBase64: (blob: Blob) => Promise<string>
  sendAudio: (payload: AudioPayload) => void
  recordingFailed: (failure: RecordingFailure) => void
  recordingStarted: (session: number) => void
  /** Starts measuring the microphone signal; null when it cannot be measured (the clip is then sent) */
  startLevelMeter?: (stream: MediaStream) => LevelMeter | null
  /** Translates a `listening.*` key. */
  t: (key: string) => string
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  now?: () => number
}

export interface RecorderHooks {
  onMode: (mode: ListeningMode) => void
  onError: (message: string | null) => void
  /** Whole seconds left in the last COUNTDOWN_SECONDS of a recording; null when not counting down. */
  onCountdown: (secondsLeft: number | null) => void
  /** The link the copied pill offers (null: none) */
  onCopiedHint?: (hint: CopiedHint) => void
  /** The error card to show (null: none) */
  onDictationError?: (payload: DictationErrorPayload | null) => void
  /** Processing waits for an automatic retry */
  onRetrying?: (retrying: boolean) => void
  /** The text of the dictation that has arrived so far ('' when none) */
  onProcessingText?: (text: string) => void
}

interface Recording {
  session: number
  recorder: RecorderLike
  stream: MediaStream
  chunks: Blob[]
  startedAt: number
  meter: LevelMeter | null
  // Set when the recording is cancelled: it must never send anything afterwards
  discarded: boolean
}

function micErrorText(err: unknown, t: (key: string) => string): string {
  if (!(err instanceof Error)) return t('listening.micAccessDenied')
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
    return t('listening.micAccessDenied')
  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')
    return t('listening.noMicFound')
  if (err.name === 'NotReadableError' || err.name === 'TrackStartError')
    return t('listening.micInUse')
  return err.message
}

export function createRecorderController(deps: RecorderDeps, hooks: RecorderHooks) {
  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const now = deps.now ?? (() => performance.now())

  // Drops a microphone request that is still pending when the user cancels
  const gate = new StreamGate()
  let mode: ListeningMode = 'idle'
  let current: Recording | null = null
  let autoStop: unknown = null
  let countdown: unknown = null
  let startedAt = 0

  const dispatch = (event: ModeEvent): void => {
    mode = nextMode(mode, event)
    hooks.onMode(mode)
  }

  const clearCountdown = (): void => {
    if (countdown === null) return
    clearTimer(countdown)
    countdown = null
    hooks.onCountdown(null)
  }

  const clearAutoStop = (): void => {
    if (autoStop !== null) clearTimer(autoStop)
    autoStop = null
    clearCountdown()
  }

  // The first tick comes COUNTDOWN_SECONDS before the limit, then one per second
  const startCountdown = (deadline: number): void => {
    const tick = (): void => {
      const left = Math.ceil((deadline - now()) / 1000)
      if (left <= 0) {
        countdown = null
        hooks.onCountdown(null)
        return
      }
      hooks.onCountdown(left)
      countdown = setTimer(tick, 1000)
    }
    countdown = setTimer(tick, (MAX_RECORDING_DURATION - COUNTDOWN_SECONDS) * 1000)
  }

  const stopTracks = (stream: MediaStream): void =>
    stream.getTracks().forEach((track) => track.stop())

  // Stop recording and release resources without sending anything
  const cleanup = (): void => {
    gate.invalidate()
    clearAutoStop()
    if (current) {
      current.discarded = true
      current.meter?.stop()
      if (current.recorder.state !== 'inactive') {
        try {
          current.recorder.stop()
        } catch {
          // Ignore errors when stopping
        }
      }
      stopTracks(current.stream)
      current.chunks = []
      current = null
    }
  }

  const fail = (session: number, message: string, reason: 'mic' | 'recorder'): void => {
    hooks.onError(message)
    cleanup()
    dispatch('failed')
    deps.recordingFailed({ session, reason })
  }

  const finish = (rec: Recording): void => {
    const mimeType = rec.recorder.mimeType || 'audio/webm'
    void (async () => {
      const level = rec.meter?.result()
      rec.meter?.stop()
      if (rec.discarded) return
      if (rec.chunks.length === 0) {
        deps.recordingFailed({ session: rec.session, reason: 'empty' })
        return
      }
      try {
        const audioBase64 = await deps.blobToBase64(new Blob(rec.chunks, { type: mimeType }))
        if (rec.discarded) return
        const elapsed = Math.max(1, now() - rec.startedAt)
        deps.sendAudio({
          audioBase64,
          mimeType,
          session: rec.session,
          durationMs: Math.min(elapsed, MAX_REPORTED_DURATION_MS),
          ...(level ? { level } : {})
        })
      } catch {
        if (!rec.discarded) deps.recordingFailed({ session: rec.session, reason: 'empty' })
      }
    })()
  }

  const startRecording = async (session: number): Promise<void> => {
    let acquired: MediaStream | null = null
    try {
      hooks.onError(null)
      cleanup()

      const stream = await gate.acquire(deps.getUserMedia)
      acquired = stream
      // Cancelled (or superseded) while waiting for the microphone
      if (!stream) return

      // Stop was pressed while the microphone was opening: nothing was recorded
      if (mode === 'processing') {
        stopTracks(stream)
        deps.recordingFailed({ session, reason: 'empty' })
        return
      }

      const recorder = deps.createRecorder(stream)
      const rec: Recording = {
        session,
        recorder,
        stream,
        chunks: [],
        startedAt: now(),
        meter: null,
        discarded: false
      }
      current = rec

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) rec.chunks.push(event.data)
      }
      recorder.onstop = () => finish(rec)
      recorder.onerror = () => {
        if (!rec.discarded) fail(session, deps.t('listening.recordingFailed'), 'recorder')
      }

      // 100 ms slices: at most 100 ms to wait when stopping
      recorder.start(100)
      rec.meter = deps.startLevelMeter?.(stream) ?? null

      autoStop = setTimer(() => {
        // Same flow as a manual stop
        clearCountdown()
        if (current === rec && recorder.state === 'recording') {
          dispatch('processing')
          recorder.stop()
          stopTracks(stream)
        }
      }, MAX_RECORDING_DURATION * 1000)

      dispatch('recording')
      startedAt = now()
      startCountdown(startedAt + MAX_RECORDING_DURATION * 1000)
      deps.recordingStarted(session)
    } catch (err) {
      // The recorder was never stored, so cleanup() cannot release the microphone
      if (acquired && !current) stopTracks(acquired)
      fail(session, micErrorText(err, deps.t), 'mic')
    }
  }

  // Stop recording; the recorder's onstop sends the audio
  const stopRecording = (): void => {
    clearAutoStop()
    if (current && current.recorder.state === 'recording') current.recorder.stop()
    if (current) stopTracks(current.stream)
  }

  return {
    getMode: (): ListeningMode => mode,
    /** When the current recording started, in `now()` time. */
    getStartedAt: (): number => startedAt,
    onStart(session: number): Promise<void> {
      dispatch('start')
      return startRecording(session)
    },
    onProcessing(retrying = false): void {
      hooks.onRetrying?.(retrying)
      hooks.onProcessingText?.('') // a retry starts the text again
      dispatch('processing')
      stopRecording()
    },
    /** Text arriving after Stop; late text after the end is ignored. */
    onProcessingText(text: string): void {
      if (mode === 'processing') hooks.onProcessingText?.(text)
    },
    onCopied(hint: CopiedHint = null): void {
      if (nextMode(mode, 'copied') !== 'copied') return
      hooks.onError(null)
      hooks.onCopiedHint?.(hint)
      dispatch('copied')
    },
    onDictationError(payload: DictationErrorPayload): void {
      if (nextMode(mode, 'error') !== 'error') return
      cleanup() // an error that ends a recording also stops it
      hooks.onError(null)
      hooks.onDictationError?.(payload)
      dispatch('error')
    },
    onStop(): void {
      cleanup()
      hooks.onRetrying?.(false)
      hooks.onProcessingText?.('')
      hooks.onCopiedHint?.(null)
      hooks.onDictationError?.(null)
      dispatch('stop')
      hooks.onError(null)
    },
    dispose: cleanup
  }
}

export type RecorderController = ReturnType<typeof createRecorderController>

/** The part of `window.electronAPI` that delivers indicator events from main. */
export interface ListeningEvents {
  onListeningStart: (callback: (session: number) => void) => () => void
  onListeningProcessing: (callback: (retrying: boolean) => void) => () => void
  onListeningCopied: (callback: (hint: CopiedHint) => void) => () => void
  onListeningError: (callback: (payload: DictationErrorPayload) => void) => () => void
  onListeningText: (callback: (text: string) => void) => () => void
  onListeningStop: (callback: () => void) => () => void
}

/** Connects main's events to the controller; returns the unsubscribe function. */
export function bindListeningEvents(
  api: ListeningEvents,
  controller: RecorderController,
  onStopped: () => void = () => undefined
): () => void {
  const offs = [
    api.onListeningStart((session) => void controller.onStart(session)),
    api.onListeningProcessing((retrying) => controller.onProcessing(retrying)),
    api.onListeningText((text) => controller.onProcessingText(text)),
    api.onListeningCopied((hint) => controller.onCopied(hint)),
    api.onListeningError((payload) => controller.onDictationError(payload)),
    api.onListeningStop(() => {
      controller.onStop()
      onStopped()
    })
  ]
  return () => offs.forEach((off) => off())
}
