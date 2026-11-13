import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  bindListeningEvents,
  createRecorderController,
  recorderOptions
} from './recorder-controller'
import { pasteKey } from '../../../shared/paste-key'
import { pillTail } from '../../../shared/pill-text'
import type { ListeningMode } from './mode'
import type { CopiedHint, DictationErrorPayload } from '../../../shared/types'
import { ErrorCard } from './ErrorCard'
import { startLevelMeter } from './level-meter'
import '../i18n'

// Preferred MIME types for audio recording (in order of preference)
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/wav'
]

// Get the best supported MIME type
function getSupportedMimeType(): string {
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }
  // Fallback - let browser decide
  return ''
}

// Convert Blob to base64 string
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result as string
      // Remove data URL prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64.split(',')[1]
      resolve(base64Data)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function App(): React.ReactElement {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<ListeningMode>('idle')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<CopiedHint>(null)
  const [retrying, setRetrying] = useState(false)
  const [processingText, setProcessingText] = useState('')
  const [errorCard, setErrorCard] = useState<DictationErrorPayload | null>(null)

  const [controller] = useState(() =>
    createRecorderController(
      {
        getUserMedia: () =>
          navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          }),
        createRecorder: (stream) => {
          const mimeType = getSupportedMimeType()
          return new MediaRecorder(stream, recorderOptions(mimeType))
        },
        blobToBase64,
        sendAudio: (payload) => window.electronAPI.sendAudioData(payload),
        recordingFailed: (failure) => window.electronAPI.recordingFailed(failure),
        recordingStarted: (session) => window.electronAPI.recordingStarted(session),
        startLevelMeter,
        t: (key) => i18n.t(key)
      },
      {
        onMode: setMode,
        onError: setError,
        onCountdown: setSecondsLeft,
        onCopiedHint: setHint,
        onDictationError: setErrorCard,
        onRetrying: setRetrying,
        onProcessingText: setProcessingText
      }
    )
  )

  // Handle cancel button click
  const handleCancel = useCallback(() => {
    window.electronAPI.cancelDictation()
    // Local cleanup will be triggered by 'listening-mode-stop' event
  }, [])

  // Handle stop button click (stop recording and process)
  const handleStop = useCallback(() => {
    window.electronAPI.stopDictation()
  }, [])

  // Set up IPC event listeners
  useEffect(() => {
    const unbind = bindListeningEvents(window.electronAPI, controller)
    // Main may send only now: messages sent to a page that has not subscribed yet are lost
    window.electronAPI.indicatorPageReady()

    return () => {
      unbind()
      controller.dispose()
    }
  }, [controller])

  if (mode === 'error' && errorCard) {
    return (
      <ErrorCard
        error={errorCard}
        onRetry={() => window.electronAPI.retryDictation()}
        onClose={handleCancel}
      />
    )
  }

  // Don't render anything in idle mode (window should be hidden)
  if (mode === 'idle' && !error) {
    return <div className="h-full w-full" />
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-1">
      <div
        className="relative w-full h-full rounded-full overflow-hidden"
        onMouseEnter={() => window.electronAPI.setIndicatorHover(true)}
        onMouseLeave={() => window.electronAPI.setIndicatorHover(false)}
        style={{
          background: 'rgba(30, 30, 40, 0.85)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        }}
      >
        {/* Cancel button */}
        {mode !== 'copied' && (
          <button
            onClick={handleCancel}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center
                     rounded-full hover:bg-white/10 transition-all duration-200 z-10"
            style={{ opacity: 0.6 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1.0'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
            }}
            aria-label={t('listening.cancelDictation')}
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Last seconds of the recording limit */}
        {mode === 'listening' && secondsLeft !== null && (
          <div
            className="absolute bottom-1 left-0 right-0 px-4 text-center text-[10px] leading-3
                       text-red-400 whitespace-nowrap truncate"
            role="timer"
          >
            {t('listening.endsIn', { s: secondsLeft })}
          </div>
        )}

        {/* The fix for a missing permission, one click from the copied message */}
        {mode === 'copied' && hint && (
          <button
            onClick={() => window.electronAPI.openAccessibilitySettings()}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute bottom-1 left-0 right-0 px-4 text-center text-[10px] leading-3
                       text-sky-300 underline whitespace-nowrap truncate hover:text-sky-200"
          >
            {t(
              hint === 'readd-accessibility'
                ? 'listening.readdAccessibility'
                : 'permissions.openSettings'
            )}
          </button>
        )}

        {/* Main content */}
        <div
          className={`h-full flex items-center justify-center gap-3 ${mode === 'copied' ? 'px-3' : 'px-5'} ${
            (mode === 'listening' && secondsLeft !== null) || (mode === 'copied' && hint)
              ? 'pb-3'
              : ''
          }`}
        >
          {error ? (
            <>
              {/* Error icon */}
              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/20">
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              </div>
              {/* Error text */}
              <span className="text-red-400/90 font-medium text-xs tracking-wide truncate max-w-[140px]">
                {error}
              </span>
            </>
          ) : mode === 'listening' || mode === 'starting' ? (
            <>
              {/* Pulsing microphone icon */}
              <div className="relative">
                <div className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
                <div className="relative w-8 h-8 flex items-center justify-center rounded-full bg-red-500/20">
                  <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                </div>
              </div>
              {/* Listening text */}
              <span className="text-white/90 font-medium text-sm tracking-wide">
                {t('listening.listening')}
              </span>
              {/* Stop button */}
              <button
                onClick={handleStop}
                onMouseDown={(e) => e.preventDefault()}
                className="ml-1 w-8 h-8 flex items-center justify-center
                           rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200"
                aria-label={t('listening.stopDictation')}
              >
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </>
          ) : mode === 'copied' ? (
            <>
              {/* Check icon: the text is on the clipboard */}
              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-emerald-500/20">
                <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
              <span className="text-white/90 font-medium text-sm tracking-wide truncate">
                {t('listening.copied', { paste: pasteKey(window.electronAPI.platform) })}
              </span>
            </>
          ) : (
            <>
              {/* Spinning gear icon for processing */}
              <div className="w-8 h-8 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
              {/* Processing text */}
              {processingText ? (
                // rtl puts the ellipsis at the start, so the newest words stay visible; bdi keeps the text itself in order
                <span
                  className="text-white/90 font-medium text-sm tracking-wide truncate max-w-[130px]"
                  style={{ direction: 'rtl' }}
                >
                  <bdi>{pillTail(processingText)}</bdi>
                </span>
              ) : (
                <span className="text-white/90 font-medium text-sm tracking-wide">
                  {t(retrying ? 'listening.retrying' : 'listening.processing')}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
