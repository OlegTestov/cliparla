import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GEMINI_KEY_URL } from '../../../shared/app-info'
import type { ApiKeyStatus } from '../../../shared/types'

interface KeyFormProps {
  onSaved: (status: ApiKeyStatus) => void
  onCancel?: () => void
  autoFocus?: boolean
}

type Phase = 'idle' | 'testing' | 'error'

/**
 * Paste a key, press "Test key". A key that works is saved right away.
 * The key is only held in this input; after saving it is cleared.
 */
export default function KeyForm({ onSaved, onCancel, autoFocus = false }: KeyFormProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const candidate = value.trim()
    if (!candidate || phase === 'testing') return
    setPhase('testing')
    setError(null)
    try {
      const test = await window.electronAPI.testKey(candidate)
      if (!test.ok) {
        setPhase('error')
        setError(test.error ?? t('key.testFailed'))
        return
      }
      const saved = await window.electronAPI.saveKey(candidate)
      if (!saved.success) {
        setPhase('error')
        setError(saved.error ?? t('key.saveFailed'))
        return
      }
      setValue('')
      setPhase('idle')
      onSaved(saved.status)
    } catch {
      setPhase('error')
      setError(t('key.testFailed'))
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-white/80" htmlFor="gemini-key">
        {t('key.label')}
      </label>
      {/* The key is Latin text: the field and its Show button stay left to right */}
      <div className="relative" dir="ltr">
        <input
          id="gemini-key"
          type={visible ? 'text' : 'password'}
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value)
            if (phase === 'error') setPhase('idle')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder={t('key.placeholder')}
          className="glass-input pr-20 font-mono text-[11px] placeholder:font-sans placeholder:text-sm"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded-md text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
        >
          {visible ? t('key.hide') : t('key.show')}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || phase === 'testing'}
          className="glass-button glass-button-primary whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase === 'testing'
            ? t('key.testing')
            : phase === 'error'
              ? t('key.retry')
              : t('key.test')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="glass-button">
            {t('common.cancel')}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.electronAPI.openExternal(GEMINI_KEY_URL)}
          className="ms-auto text-xs text-blue-400 hover:text-blue-300 hover:underline"
        >
          {t('key.getKey')}
        </button>
      </div>
    </div>
  )
}

/** Shown when a key is stored but the system keychain would not release it. */
export function UnreadableKeyNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="mb-4 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-2"
    >
      <p>{t('key.unreadable')}</p>
      <button type="button" onClick={onRetry} className="glass-button">
        {t('key.retryAccess')}
      </button>
    </div>
  )
}
