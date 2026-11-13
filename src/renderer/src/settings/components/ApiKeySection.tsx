import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import KeyForm, { UnreadableKeyNotice } from '../../components/KeyForm'
import { createRemoveConfirm } from '../remove-confirm'
import type { ApiKeyStatus, KeyTestResult } from '../../../../shared/types'

/**
 * Settings view of the API key. Shows only a masked status; the key itself
 * never reaches this process.
 */
export default function ApiKeySection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ApiKeyStatus | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [testResult, setTestResult] = useState<KeyTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [asking, setAsking] = useState(false)
  const [remover] = useState(() =>
    createRemoveConfirm(async () => {
      setStatus(await window.electronAPI.removeKey())
      setTestResult(null)
      setReplacing(false)
    }, setAsking)
  )
  const removeButton = useRef<HTMLButtonElement>(null)
  const cancelRemove = () => {
    remover.cancel()
    // The question unmounts: give the keyboard focus back to the button that opened it
    setTimeout(() => removeButton.current?.focus(), 0)
  }

  useEffect(() => {
    let active = true
    window.electronAPI.getKeyStatus().then((next) => {
      if (active) setStatus(next)
    })
    return () => {
      active = false
    }
  }, [])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.electronAPI.testKey())
    } finally {
      setTesting(false)
    }
  }

  // Escape closes only the question, not the whole Settings window
  useEffect(() => {
    if (!asking) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      remover.cancel()
      setTimeout(() => removeButton.current?.focus(), 0)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [asking, remover])

  if (!status) return null

  if (!status.configured || replacing) {
    return (
      <>
        {status.unreadable && (
          <UnreadableKeyNotice
            onRetry={() => void window.electronAPI.getKeyStatus({ retry: true }).then(setStatus)}
          />
        )}
        <KeyForm
          autoFocus
          onSaved={(next) => {
            setStatus(next)
            setReplacing(false)
            setTestResult(null)
          }}
          onCancel={status.configured ? () => setReplacing(false) : undefined}
        />
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/60">{t('key.statusLabel')}</span>
        <span className="text-sm font-mono text-emerald-300">{status.masked}</span>
      </div>

      {testResult && (
        <p
          role="status"
          className={`text-sm rounded-lg p-3 border ${
            testResult.ok
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
              : 'text-red-300 bg-red-500/10 border-red-500/20'
          }`}
        >
          {testResult.ok ? t('key.works') : (testResult.error ?? t('key.testFailed'))}
        </p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={handleTest} disabled={testing} className="glass-button">
          {testing ? t('key.testing') : t('key.test')}
        </button>
        <button
          type="button"
          onClick={() => {
            remover.cancel()
            setReplacing(true)
          }}
          className="glass-button"
        >
          {t('key.replace')}
        </button>
        {!asking && (
          <button
            ref={removeButton}
            type="button"
            onClick={remover.ask}
            className="glass-button glass-button-danger"
          >
            {t('key.remove')}
          </button>
        )}
      </div>

      {asking && (
        <div
          role="alertdialog"
          aria-label={t('key.removeConfirm')}
          className="text-sm rounded-lg p-3 border text-red-300 bg-red-500/10 border-red-500/20 space-y-3"
        >
          <p>{t('key.removeConfirm')}</p>
          <div className="flex gap-3">
            <button type="button" autoFocus onClick={cancelRemove} className="glass-button">
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void remover.confirm()}
              className="glass-button glass-button-danger"
            >
              {t('key.removeConfirmYes')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
