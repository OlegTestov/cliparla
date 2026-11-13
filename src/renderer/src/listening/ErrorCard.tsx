import { useTranslation } from 'react-i18next'
import type { DictationErrorPayload } from '../../../shared/types'

/** A dictation error in the indicator: the message, Retry (when the audio is kept) and Close. */
export function ErrorCard({
  error,
  onRetry,
  onClose
}: {
  error: DictationErrorPayload
  onRetry: () => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const button = 'px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors'
  return (
    <div className="h-full w-full p-1">
      <div
        className="relative w-full h-full rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(30, 30, 40, 0.92)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        }}
        onMouseEnter={() => window.electronAPI.setIndicatorHover(true)}
        onMouseLeave={() => window.electronAPI.setIndicatorHover(false)}
      >
        <div className="flex items-start gap-3 px-3 pt-3">
          <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-red-500/20">
            <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
          </div>
          <p role="alert" className="text-xs leading-4 text-red-300 line-clamp-4">
            {error.message}
          </p>
        </div>
        <div className="absolute bottom-2 right-3 flex gap-2">
          {error.retry && (
            <button
              onClick={onRetry}
              onMouseDown={(e) => e.preventDefault()}
              className={`${button} bg-white/15 hover:bg-white/25 text-white`}
            >
              {t('common.tryAgain')}
            </button>
          )}
          <button
            onClick={onClose}
            onMouseDown={(e) => e.preventDefault()}
            className={`${button} bg-white/10 hover:bg-white/20 text-white/80`}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
