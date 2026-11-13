import { useState, useCallback, useEffect, useId, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatShortcut } from '../../../../shared/shortcut-format'
import { keyEventToAccelerator, layoutAccelerator } from '../../../../shared/key-event'
import { readLayout, watchLayout, type LayoutSource } from './layout-refresh'

interface ShortcutInputProps {
  value: string
  onChange: (shortcut: string) => void
  label?: string
  description?: string
  /** Why the last recorded shortcut was refused; the field keeps its old value. */
  error?: string
  /** Offers "Turn off": the hotkey is then unset (value ''). */
  onDisable?: () => void
}

// Format accelerator for display (e.g., "CommandOrControl+Shift+S" -> "Command + Shift + S" on Mac)
export default function ShortcutInput({
  value,
  onChange,
  label,
  description,
  error,
  onDisable
}: ShortcutInputProps) {
  const { t } = useTranslation()
  const [isRecording, setIsRecording] = useState(false)
  const fieldRef = useRef<HTMLButtonElement>(null)
  const isMac = useMemo(() => navigator.platform.toUpperCase().includes('MAC'), [])

  const displayLabel = label || t('settings.shortcut.defaultLabel')
  const recordingHint = isMac
    ? t('settings.shortcut.recordingHintMac')
    : t('settings.shortcut.recordingHintOther')

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return

      e.preventDefault()
      e.stopPropagation()

      // ESC cancels recording
      if (e.key === 'Escape') {
        setIsRecording(false)
        return
      }

      const accelerator = keyEventToAccelerator(e, isMac)
      if (accelerator) {
        onChange(accelerator)
        setIsRecording(false)
      }
    },
    [isRecording, onChange, isMac]
  )

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isRecording, handleKeyDown])

  // A refused shortcut: put the focus back on the field so the user can try again
  useEffect(() => {
    if (error) fieldRef.current?.focus()
  }, [error])

  // Show the letter printed on the user's key (German Z sits where US has Y).
  // The Settings window is reused, so re-read the layout on focus and when recording starts.
  const [layout, setLayout] = useState<Map<string, string>>(new Map())
  const keyboard = (navigator as Navigator & { keyboard?: LayoutSource }).keyboard
  useEffect(() => watchLayout(keyboard, window, setLayout), [keyboard])
  useEffect(() => {
    if (isRecording) readLayout(keyboard, setLayout)
  }, [isRecording, keyboard])
  const formattedValue = formatShortcut(
    layoutAccelerator(value, layout),
    window.electronAPI.platform
  )
  const errorId = `shortcut-error-${useId()}`

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-white/80">{displayLabel}</label>
      <div className="flex items-center gap-3">
        <button
          ref={fieldRef}
          type="button"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onClick={() => setIsRecording(!isRecording)}
          className={`
            flex-1 px-4 py-3 rounded-xl text-start
            transition-all duration-200
            ${
              isRecording
                ? 'bg-blue-500/20 border border-blue-400/50 ring-2 ring-blue-500/30'
                : error
                  ? 'bg-white/5 border border-red-400/50 hover:bg-white/[0.08]'
                  : 'bg-white/5 border border-white/10 hover:bg-white/[0.08] hover:border-white/15'
            }
          `}
        >
          {isRecording ? (
            <span className="text-blue-300 animate-pulse">{t('settings.shortcut.pressKeys')}</span>
          ) : value === '' ? (
            <span className="text-white/50">{t('settings.shortcut.off')}</span>
          ) : (
            <span dir="ltr" className="inline-block text-white">
              {formattedValue}
            </span>
          )}
        </button>
        {isRecording && (
          <button
            type="button"
            onClick={() => setIsRecording(false)}
            className="px-3 py-2 text-sm text-white/50 hover:text-white/80"
          >
            {t('settings.shortcut.cancel')}
          </button>
        )}
        {!isRecording && onDisable && value !== '' && (
          <button
            type="button"
            onClick={onDisable}
            className="shrink-0 px-3 py-2 text-sm text-white/50 hover:text-white/80"
          >
            {t('settings.shortcut.turnOff')}
          </button>
        )}
      </div>
      {error && !isRecording ? (
        <p id={errorId} role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : (
        <p className="text-xs text-white/40">
          {isRecording ? recordingHint : description || t('settings.shortcut.defaultDescription')}
        </p>
      )}
    </div>
  )
}
