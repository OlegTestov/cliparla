import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UI_LANGUAGES, type UILanguage } from '../../../shared/types'
import '../i18n'
import KeyForm, { UnreadableKeyNotice } from '../components/KeyForm'
import iconPath from '../../../../resources/icon.png'
import { formatShortcut } from '../../../shared/shortcut-format'
import { savedSubtitleKey, screenAfterKeySaved, screenOnRequest, type SetupStep } from './flow'

/**
 * First-run screens: paste the Gemini key and test it, key saved, then (after the
 * permissions window) "Try it now".
 * Also shown again whenever a request fails because the key is missing or rejected.
 */
export default function App() {
  const { t, i18n } = useTranslation()
  const [step, setStep] = useState<SetupStep>('key')
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [unreadable, setUnreadable] = useState(false)
  const [shortcuts, setShortcuts] = useState({ capture: '', dictation: '' })
  const [justSaved, setJustSaved] = useState(false)
  // The "saved" button fires setup-done once: a second click would open the next window twice
  const [finishing, setFinishing] = useState(false)
  const [screenReady, setScreenReady] = useState(false)
  const [offerOptional, setOfferOptional] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Long texts (some languages, an error plus a notice) must not need a scrollbar
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const PAGE_PADDING = 64
    const observer = new ResizeObserver(() =>
      window.electronAPI.fitWindowHeight(
        Math.ceil(card.getBoundingClientRect().height) + PAGE_PADDING
      )
    )
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  const loadShortcuts = async () => {
    try {
      const settings = await window.electronAPI.getSettings()
      setShortcuts({
        capture: formatShortcut(settings.captureShortcut, window.electronAPI.platform),
        dictation: formatShortcut(settings.dictationShortcut, window.electronAPI.platform)
      })
    } catch {
      // Hints stay empty
    }
  }

  const handleSaved = async () => {
    await loadShortcuts()
    const screen = await screenAfterKeySaved(window.electronAPI)
    setScreenReady(screen.screenReady)
    setOfferOptional(screen.offerOptional)
    setJustSaved(screen.justSaved)
    setFinishing(false)
    setStep(screen.step)
  }

  const checkStoredKey = async () => {
    const status = await window.electronAPI.getKeyStatus({ retry: true })
    setUnreadable(!!status.unreadable)
    if (status.configured) await handleSaved()
  }

  useEffect(() => {
    const showScreen = (nextReason?: string) => {
      const next = screenOnRequest(nextReason)
      setJustSaved(next.justSaved)
      if (next.step === 'try') {
        void loadShortcuts().then(() => setStep('try'))
        return
      }
      setFinishing(false)
      setStep(next.step)
      setReason(nextReason)
      // A key may be stored but blocked by the keychain: say so instead of asking blindly
      void window.electronAPI.getKeyStatus().then((status) => setUnreadable(!!status.unreadable))
    }
    const unsubscribe = window.electronAPI.onSetupReset(showScreen)
    // A request sent while this page was still loading was lost: read it now
    void window.electronAPI.getSetupReason().then((current) => showScreen(current ?? undefined))
    return unsubscribe
  }, [])

  const handleLanguage = (language: UILanguage) => {
    void i18n.changeLanguage(language)
    // Remember the choice for every window and later launches
    void window.electronAPI.saveSettings({ uiLanguage: language })
  }

  const reasonText =
    reason === 'MISSING_KEY' || reason === 'INVALID_KEY' ? t(`setup.reason.${reason}`) : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-8">
      {/* Draggable title bar area (macOS hiddenInset only) */}
      {window.electronAPI.platform === 'darwin' && (
        <div
          className="h-10 w-full fixed top-0 left-0 right-0 z-50"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      <div ref={cardRef} className="w-full max-w-md glass p-8 relative">
        <select
          aria-label={t('settings.general.uiLanguage')}
          value={i18n.language}
          onChange={(e) => handleLanguage(e.target.value as UILanguage)}
          className="absolute top-3 end-3 bg-white/5 border border-white/10 rounded-lg text-xs text-white/70 px-2 py-1 focus:outline-none"
        >
          {UI_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="text-black">
              {l.nativeName}
            </option>
          ))}
        </select>
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl overflow-hidden shadow-lg">
            <img src={iconPath} alt="Cliparla" className="w-full h-full object-cover" />
          </div>
          {step === 'try' && justSaved && (
            <p role="status" className="mb-2 text-sm font-medium text-emerald-300">
              ✓ {t('setup.saved.title')}
            </p>
          )}
          <h1 className="text-2xl font-bold text-white mb-1">
            {step === 'saved'
              ? t('setup.saved.title')
              : step === 'try'
                ? t('setup.try.title')
                : t('setup.title')}
          </h1>
          <p className="text-sm text-white/60">
            {step === 'saved'
              ? t(savedSubtitleKey({ screenReady, offerOptional }))
              : step === 'try'
                ? t('setup.try.subtitle')
                : t('setup.subtitle')}
          </p>
        </div>

        {step === 'key' && (
          <>
            {reasonText && (
              <p
                role="status"
                className="mb-4 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3"
              >
                {reasonText}
              </p>
            )}
            {unreadable && <UnreadableKeyNotice onRetry={() => void checkStoredKey()} />}
            <KeyForm onSaved={handleSaved} autoFocus />
            <p className="mt-6 text-xs text-center text-white/40">{t('setup.privacy')}</p>
          </>
        )}

        {step === 'saved' && (
          <button
            type="button"
            disabled={finishing}
            onClick={() => {
              setFinishing(true)
              window.electronAPI.setupDone()
            }}
            className="w-full glass-button glass-button-primary"
          >
            {t('setup.saved.button')}
          </button>
        )}

        {step === 'try' && (
          <div className="space-y-4">
            <ul className="space-y-2 text-sm text-white/80">
              <li className="flex items-center justify-between glass-subtle px-4 py-3">
                <span>{t('setup.try.capture')}</span>
                <kbd dir="ltr" className="font-mono text-xs bg-white/10 px-2 py-1 rounded">
                  {shortcuts.capture}
                </kbd>
              </li>
              <li className="flex items-center justify-between glass-subtle px-4 py-3">
                <span>{t('setup.try.dictation')}</span>
                <kbd dir="ltr" className="font-mono text-xs bg-white/10 px-2 py-1 rounded">
                  {shortcuts.dictation}
                </kbd>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => window.electronAPI.tryCapture()}
              className="w-full glass-button glass-button-primary"
            >
              {t('setup.try.button')}
            </button>
            <button
              type="button"
              onClick={() => window.electronAPI.finishOnboarding()}
              className="w-full text-xs text-white/50 hover:text-white/80 underline"
            >
              {t('setup.try.skip')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
