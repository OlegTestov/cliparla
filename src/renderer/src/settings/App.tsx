import { defaultCaptureShortcut, defaultDictationShortcut } from '../../../shared/default-shortcuts'
import { createPendingChanges } from './pending-changes'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ShortcutInput from './components/ShortcutInput'
import LanguageSelect from './components/LanguageSelect'
import ApiKeySection from './components/ApiKeySection'
import Sidebar, { SectionConfig } from './components/Sidebar'
import GlassCard from './components/GlassCard'
import {
  SUPPORTED_LANGUAGES,
  NOT_SELECTED,
  UI_LANGUAGES,
  KEEP_LANGUAGE
} from '../../../shared/types'
import { languageLabel } from '../../../shared/language-label'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import type { UILanguage } from '../../../shared/types'
import { APP_NAME, SUPPORT_URL } from '../../../shared/app-info'
import i18n from '../i18n'
import { formatShortcut } from '../../../shared/shortcut-format'
import {
  MAX_DICTIONARY_CHARS,
  MAX_DICTIONARY_LINES,
  parseDictionary
} from '../../../shared/dictionary'

interface Settings {
  uiLanguage: UILanguage
  captureShortcut: string
  screenshotTargetLanguage: string
  dictationShortcut: string
  dictationTargetLanguage: string
  removeFillerWords: boolean
  pasteLastShortcut: string
  copyTextShortcut: string
  dictionary: string
  preferredLanguage1: string
  preferredLanguage2: string
  preferredLanguage3: string
}

type ShortcutType = 'capture' | 'dictation' | 'pasteLast' | 'copyText'

const SHORTCUT_FIELDS = {
  capture: 'captureShortcut',
  dictation: 'dictationShortcut',
  pasteLast: 'pasteLastShortcut',
  copyText: 'copyTextShortcut'
} as const

type SectionId = 'general' | 'screenshot' | 'voice' | 'api' | 'about'

export default function App() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings>({
    uiLanguage: 'en',
    captureShortcut: defaultCaptureShortcut('darwin'),
    screenshotTargetLanguage: 'English',
    dictationShortcut: defaultDictationShortcut('darwin'),
    dictationTargetLanguage: 'English',
    removeFillerWords: true,
    pasteLastShortcut: 'Command+Control+V',
    copyTextShortcut: 'Command+Control+C',
    dictionary: '',
    preferredLanguage1: 'English',
    preferredLanguage2: 'Spanish',
    preferredLanguage3: NOT_SELECTED
  })
  const [isLoading, setIsLoading] = useState(true)
  // Hotkeys the system refused at start-up: shown under the field until the user picks another
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [appVersion, setAppVersion] = useState<string>('')
  const [activeSection, setActiveSection] = useState<SectionId>('general')

  const isOnline = useOnlineStatus()
  const isInitialLoad = useRef(true)
  const pending = useRef(createPendingChanges<Settings>())
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load settings and app version on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const { unavailableShortcuts, ...loadedSettings } = await window.electronAPI.getSettings()
        setSettings(loadedSettings)
        setUnavailable(unavailableShortcuts)
        if (loadedSettings.uiLanguage) {
          i18n.changeLanguage(loadedSettings.uiLanguage)
        }
        setIsLoading(false)
        setTimeout(() => {
          isInitialLoad.current = false
        }, 100)
      } catch {
        setIsLoading(false)
      }
    }
    async function loadVersion() {
      try {
        setAppVersion(await window.electronAPI.getAppVersion())
      } catch {
        // Version info unavailable
      }
    }
    loadSettings()
    loadVersion()
  }, [])

  // Listen for settings changes from tray menu
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSettingsChangedFromTray(async () => {
      const { unavailableShortcuts, ...loadedSettings } = await window.electronAPI.getSettings()
      isInitialLoad.current = true
      setSettings(loadedSettings)
      setUnavailable(unavailableShortcuts)
      if (loadedSettings.uiLanguage) {
        i18n.changeLanguage(loadedSettings.uiLanguage)
      }
      setTimeout(() => {
        isInitialLoad.current = false
      }, 100)
    })
    return unsubscribe
  }, [])

  // Another window (the welcome picker) changed the language: follow it, don't re-save it
  useEffect(
    () =>
      window.electronAPI.onUiLanguageChanged((language) =>
        setSettings((prev) => ({ ...prev, uiLanguage: language as UILanguage }))
      ),
    []
  )

  // Auto-save with debounce
  const saveSettings = useCallback(async (newSettings: Partial<Settings>) => {
    setSaveStatus('saving')
    try {
      await window.electronAPI.saveSettings(newSettings)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [])

  useEffect(() => {
    if (isInitialLoad.current || isLoading) return
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      const changes = pending.current.take()
      if (Object.keys(changes).length > 0) saveSettings(changes)
    }, 500)
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [settings, saveSettings, isLoading])

  // Handle ESC key to close window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.close()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    pending.current.set(key, value)
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  // Shortcuts are applied at once (not auto-saved): a refused one keeps the old value
  const [shortcutErrors, setShortcutErrors] = useState<Partial<Record<ShortcutType, string>>>({})
  const shortcutError = (type: ShortcutType): string | undefined =>
    shortcutErrors[type] ?? (unavailable.includes(type) ? t('shortcut.refusedAtStart') : undefined)
  const handleShortcut = async (type: ShortcutType, accelerator: string) => {
    const field = SHORTCUT_FIELDS[type]
    let result: { ok: boolean; error?: string }
    try {
      result = await window.electronAPI.setShortcut(type, accelerator)
    } catch {
      result = {
        ok: false,
        error: t('shortcut.saveFailed', {
          shortcut: `\u2066${formatShortcut(accelerator, window.electronAPI.platform)}\u2069`
        })
      }
    }
    setShortcutErrors((prev) => ({ ...prev, [type]: result.ok ? undefined : result.error }))
    if (result.ok) {
      setUnavailable((prev) => prev.filter((known) => known !== type))
      setSettings((prev) => ({ ...prev, [field]: accelerator }))
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }

  // The dictionary has its own text state: the lines are checked against the limits and saved
  // as typed (not through auto-save), so a refused text stays on screen with its reason.
  const [dictionaryText, setDictionaryText] = useState('')
  const [dictionaryError, setDictionaryError] = useState<string | undefined>()
  const dictionaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dictionaryLoaded = useRef(false)

  useEffect(() => {
    if (isLoading || dictionaryLoaded.current) return
    dictionaryLoaded.current = true
    setDictionaryText(settings.dictionary ?? '')
  }, [isLoading, settings.dictionary])

  const saveDictionary = async (text: string) => {
    const parsed = parseDictionary(text)
    if (!parsed.ok) {
      setDictionaryError(
        parsed.problem === 'tooManyLines'
          ? t('settings.general.dictionaryTooMany', { max: MAX_DICTIONARY_LINES })
          : t('settings.general.dictionaryTooLong', {
              max: MAX_DICTIONARY_CHARS.toLocaleString(i18n.language)
            })
      )
      return
    }
    try {
      const result = await window.electronAPI.setDictionary(text)
      setDictionaryError(result.ok ? undefined : result.error)
      if (result.ok) {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      }
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const handleDictionaryChange = (text: string) => {
    setDictionaryText(text)
    if (dictionaryTimer.current) clearTimeout(dictionaryTimer.current)
    dictionaryTimer.current = setTimeout(() => void saveDictionary(text), 500)
  }

  const handleDictionaryBlur = () => {
    if (dictionaryTimer.current) clearTimeout(dictionaryTimer.current)
    dictionaryTimer.current = null
    // Leaving the field lays the terms out as they are stored; a refused text stays as typed.
    const parsed = parseDictionary(dictionaryText)
    if (parsed.ok) setDictionaryText(parsed.lines.join('\n'))
    void saveDictionary(dictionaryText)
  }

  const handleLanguageChange = (lang: UILanguage) => {
    i18n.changeLanguage(lang)
    updateSetting('uiLanguage', lang)
  }

  // SVG Icons for sidebar
  const icons = {
    general: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        />
      </svg>
    ),
    screenshot: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
        />
      </svg>
    ),
    voice: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
        />
      </svg>
    ),
    api: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
        />
      </svg>
    ),
    about: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
        />
      </svg>
    )
  }

  // Define sections for sidebar
  const sections: SectionConfig[] = [
    {
      id: 'general',
      label: t('settings.sidebar.general'),
      icon: icons.general,
      accentColor: 'text-blue-400'
    },
    {
      id: 'screenshot',
      label: t('settings.sidebar.screenshot'),
      icon: icons.screenshot,
      accentColor: 'text-orange-400'
    },
    {
      id: 'voice',
      label: t('settings.sidebar.voice'),
      icon: icons.voice,
      accentColor: 'text-emerald-400'
    },
    {
      id: 'api',
      label: t('settings.sidebar.apiKey'),
      icon: icons.api,
      accentColor: 'text-violet-400'
    },
    {
      id: 'about',
      label: t('settings.sidebar.about'),
      icon: icons.about,
      accentColor: 'text-teal-400'
    }
  ]

  // Render section content
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">
                {t('settings.general.title')}
              </h2>
              <p className="text-sm text-white/50">{t('settings.general.description')}</p>
            </div>
            {/* Interface Language */}
            <GlassCard>
              <label className="block text-sm font-medium text-white/80 mb-1">
                {t('settings.general.uiLanguage')}
              </label>
              <p className="text-xs text-white/40 mb-3">
                {t('settings.general.uiLanguageDescription')}
              </p>
              <select
                value={settings.uiLanguage}
                onChange={(e) => handleLanguageChange(e.target.value as UILanguage)}
                className="glass-select"
              >
                {UI_LANGUAGES.map(({ code, nativeName }) => (
                  <option key={code} value={code}>
                    {nativeName}
                  </option>
                ))}
              </select>
            </GlassCard>

            {/* Personal dictionary */}
            <GlassCard>
              <label htmlFor="dictionary" className="block text-sm font-medium text-white/80 mb-1">
                {t('settings.general.dictionary')}
              </label>
              <p className="text-xs text-white/40 mb-3">
                {t('settings.general.dictionaryDescription')}
              </p>
              <textarea
                id="dictionary"
                dir="auto"
                rows={5}
                value={dictionaryText}
                onChange={(e) => handleDictionaryChange(e.target.value)}
                onBlur={handleDictionaryBlur}
                aria-invalid={!!dictionaryError}
                aria-describedby={dictionaryError ? 'dictionary-error' : undefined}
                className={`w-full resize-y rounded-xl bg-white/5 border px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                  dictionaryError ? 'border-red-400/50' : 'border-white/10'
                }`}
              />
              {dictionaryError && (
                <p id="dictionary-error" role="alert" className="mt-2 text-xs text-red-300">
                  {dictionaryError}
                </p>
              )}
            </GlassCard>

            {/* Preferred Translation Languages */}
            <GlassCard>
              <label className="block text-sm font-medium text-white/80 mb-3">
                {t('settings.general.preferredLanguages')}
              </label>
              <p className="text-xs text-white/40 mb-4">
                {t('settings.general.preferredLanguagesDescription')}
              </p>
              <div className="flex gap-3">
                {[
                  {
                    label: t('settings.general.preferredLanguage1st'),
                    key: 'preferredLanguage1' as const
                  },
                  {
                    label: t('settings.general.preferredLanguage2nd'),
                    key: 'preferredLanguage2' as const
                  },
                  {
                    label: t('settings.general.preferredLanguage3rd'),
                    key: 'preferredLanguage3' as const
                  }
                ].map(({ label, key }) => (
                  <div key={key} className="flex-1">
                    <label className="block text-xs font-medium text-white/50 mb-1.5">
                      {label}
                    </label>
                    <select
                      value={settings[key]}
                      onChange={(e) => updateSetting(key, e.target.value)}
                      className="glass-select glass-select-small text-sm"
                    >
                      <option value={NOT_SELECTED}>{t('settings.general.notSelected')}</option>
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.name}>
                          {languageLabel(lang.name, i18n.language)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        )

      case 'screenshot':
        return (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">
                  {t('settings.screenshot.title')}
                </h2>
                <p className="text-sm text-white/50">{t('settings.screenshot.description')}</p>
              </div>
            </div>
            <GlassCard className="space-y-6">
              <ShortcutInput
                value={settings.captureShortcut}
                onChange={(shortcut) => void handleShortcut('capture', shortcut)}
                error={shortcutError('capture')}
                label={t('settings.screenshot.captureHotkey')}
                description={t('settings.screenshot.captureHotkeyDescription')}
              />
              <ShortcutInput
                value={settings.copyTextShortcut}
                onChange={(shortcut) => void handleShortcut('copyText', shortcut)}
                onDisable={() => void handleShortcut('copyText', '')}
                error={shortcutError('copyText')}
                label={t('settings.screenshot.copyTextHotkey')}
                description={t('settings.screenshot.copyTextHotkeyDescription')}
              />
              <LanguageSelect
                value={settings.screenshotTargetLanguage}
                onChange={(language) => updateSetting('screenshotTargetLanguage', language)}
                label={t('settings.screenshot.translateTo')}
                description={t('settings.screenshot.translateToDescription')}
              />
            </GlassCard>
          </div>
        )

      case 'voice':
        return (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">
                  {t('settings.voice.title')}
                </h2>
                <p className="text-sm text-white/50">{t('settings.voice.description')}</p>
              </div>
            </div>
            <GlassCard className="space-y-6">
              <ShortcutInput
                value={settings.dictationShortcut}
                onChange={(shortcut) => void handleShortcut('dictation', shortcut)}
                error={shortcutError('dictation')}
                label={t('settings.voice.dictationHotkey')}
                description={t('settings.voice.dictationHotkeyDescription')}
              />
              <ShortcutInput
                value={settings.pasteLastShortcut}
                onChange={(shortcut) => void handleShortcut('pasteLast', shortcut)}
                onDisable={() => void handleShortcut('pasteLast', '')}
                error={shortcutError('pasteLast')}
                label={t('settings.voice.pasteLastHotkey')}
                description={t('settings.voice.pasteLastHotkeyDescription')}
              />
              <LanguageSelect
                value={settings.dictationTargetLanguage}
                onChange={(language) => updateSetting('dictationTargetLanguage', language)}
                leading={{ value: KEEP_LANGUAGE, label: t('language.keepMine') }}
                label={t('settings.voice.translateTo')}
                description={
                  settings.dictationTargetLanguage === KEEP_LANGUAGE
                    ? t('settings.voice.keepDescription')
                    : t('settings.voice.translateToDescription')
                }
              />
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label
                    htmlFor="remove-filler-words"
                    className="block text-sm font-medium text-white/80 mb-1"
                  >
                    {t('settings.voice.removeFillerWords')}
                  </label>
                  <p id="remove-filler-words-hint" className="text-xs text-white/40">
                    {t('settings.voice.removeFillerWordsHint')}
                  </p>
                </div>
                <input
                  id="remove-filler-words"
                  type="checkbox"
                  role="switch"
                  checked={settings.removeFillerWords}
                  onChange={(e) => updateSetting('removeFillerWords', e.target.checked)}
                  aria-describedby="remove-filler-words-hint"
                  className="h-5 w-5 shrink-0 accent-emerald-400"
                />
              </div>
            </GlassCard>
          </div>
        )

      case 'api':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">{t('settings.api.title')}</h2>
              <p className="text-sm text-white/50">{t('settings.api.description')}</p>
            </div>
            <GlassCard>
              <ApiKeySection />
            </GlassCard>
            <p className="text-xs text-white/40">{t('setup.privacy')}</p>
          </div>
        )

      case 'about':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">{t('settings.about.title')}</h2>
              <p className="text-sm text-white/50">{t('settings.about.description')}</p>
            </div>
            <GlassCard>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">{APP_NAME}</span>
                  <span className="text-sm font-mono text-white">{appVersion || '...'}</span>
                </div>
                <p className="text-xs text-white/40">{t('settings.about.license')}</p>
                <p className="text-xs text-white/60">{t('settings.about.privacy')}</p>
                {SUPPORT_URL && (
                  <button
                    onClick={() => window.electronAPI.openExternal(SUPPORT_URL)}
                    className="text-xs text-white/40 hover:text-white/70 underline transition-colors"
                  >
                    {t('settings.about.support')}
                  </button>
                )}
              </div>
            </GlassCard>
            <GlassCard>
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-white">{t('settings.about.openSource')}</h3>
                <p className="text-xs text-white/40">{t('settings.about.openSourceDescription')}</p>
                <div className="space-y-2 pt-1">
                  {[
                    { name: 'Electron', license: 'MIT' },
                    { name: 'React', license: 'MIT' },
                    { name: 'Google Generative AI SDK', license: 'Apache-2.0' },
                    { name: 'i18next', license: 'MIT' },
                    { name: 'Tailwind CSS', license: 'MIT' },
                    { name: 'TypeScript', license: 'Apache-2.0' },
                    { name: 'Vite', license: 'MIT' }
                  ].map((dep) => (
                    <div
                      key={dep.name}
                      className="flex items-center justify-between py-1 border-b border-white/[0.04] last:border-0"
                    >
                      <span className="text-xs text-white/60">{dep.name}</span>
                      <span className="text-xs text-white/30 font-mono">{dep.license}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </div>
        )

      default:
        return null
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-white/50">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{t('settings.loading')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Draggable title bar area (macOS hiddenInset only) */}
      {window.electronAPI.platform === 'darwin' && (
        <div
          className="h-10 w-full fixed top-0 left-0 right-0 z-50"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}

      <div className={`flex h-screen ${window.electronAPI.platform === 'darwin' ? 'pt-10' : ''}`}>
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 p-4 border-e border-white/[0.06] bg-black/20">
          <Sidebar
            sections={sections}
            activeSection={activeSection}
            onSectionChange={(id) => setActiveSection(id as SectionId)}
            appVersion={appVersion}
            saveStatus={saveStatus}
          />
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-8">
          {!isOnline && (
            <div
              role="alert"
              className="max-w-xl mb-4 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-yellow-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
              <span className="text-yellow-400 text-sm">{t('common.offline')}</span>
            </div>
          )}
          <div className="max-w-xl">{renderSectionContent()}</div>

          {/* Footer */}
          <div className="mt-8 flex items-center justify-between text-xs text-white/30">
            <span>
              {t('settings.footer.escToHide', { interpolation: { escapeValue: false } })
                .split('<kbd>')
                .map((part, i) => {
                  if (i === 0) return part
                  const [inside, rest] = part.split('</kbd>')
                  return (
                    <span key={i}>
                      <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded">{inside}</span>
                      {rest}
                    </span>
                  )
                })}
            </span>
          </div>
        </main>
      </div>
    </div>
  )
}
