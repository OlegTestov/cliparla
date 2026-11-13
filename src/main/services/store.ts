import Store from 'electron-store'
import { app } from 'electron'
import { resolveSystemLanguages } from '../core/localize'
import { NOT_SELECTED } from '../../shared/types'
import type { StoreSchema, UILanguage } from '../../shared/types'
import { defaultCaptureShortcut, defaultDictationShortcut } from '../../shared/default-shortcuts'

// Default values (single source of truth)
// uiLanguage has no stored default: until the user picks one it follows the system language
const DEFAULTS: Omit<StoreSchema, 'uiLanguage'> & { tryItSeen: boolean } = {
  captureShortcut: defaultCaptureShortcut(process.platform),
  screenshotTargetLanguage: 'English',
  dictationShortcut: defaultDictationShortcut(process.platform),
  dictationTargetLanguage: 'English',
  removeFillerWords: true,
  pasteLastShortcut: process.platform === 'darwin' ? 'Command+Control+V' : 'Control+Shift+Alt+V',
  copyTextShortcut: process.platform === 'darwin' ? 'Command+Control+C' : 'Control+Shift+Alt+C',
  dictionary: '',
  preferredLanguage1: 'English',
  preferredLanguage2: 'Spanish',
  preferredLanguage3: NOT_SELECTED,
  tryItSeen: false
}

// JSON Schema for validation
const schema = {
  uiLanguage: { type: 'string' },
  captureShortcut: { type: 'string', default: DEFAULTS.captureShortcut },
  screenshotTargetLanguage: { type: 'string', default: DEFAULTS.screenshotTargetLanguage },
  dictationShortcut: { type: 'string', default: DEFAULTS.dictationShortcut },
  dictationTargetLanguage: { type: 'string', default: DEFAULTS.dictationTargetLanguage },
  removeFillerWords: { type: 'boolean', default: DEFAULTS.removeFillerWords },
  pasteLastShortcut: { type: 'string', default: DEFAULTS.pasteLastShortcut },
  copyTextShortcut: { type: 'string', default: DEFAULTS.copyTextShortcut },
  dictionary: { type: 'string', default: DEFAULTS.dictionary },
  preferredLanguage1: { type: 'string', default: DEFAULTS.preferredLanguage1 },
  preferredLanguage2: { type: 'string', default: DEFAULTS.preferredLanguage2 },
  preferredLanguage3: { type: 'string', default: DEFAULTS.preferredLanguage3 },
  tryItSeen: { type: 'boolean', default: DEFAULTS.tryItSeen }
} as const

/** The built-in shortcut of an optional hotkey (what a reset returns to). */
export function defaultShortcut(type: 'capture' | 'dictation' | 'pasteLast' | 'copyText'): string {
  return DEFAULTS[`${type}Shortcut` as const]
}

// What is stored on disk: the same as StoreSchema, except the language may be unset
type StoredSettings = Omit<StoreSchema, 'uiLanguage'> & {
  uiLanguage?: UILanguage
  /** The "Try it now" step of the first run was shown (or skipped). */
  tryItSeen: boolean
}

// Create store instance with schema and defaults
export const store = new Store<StoredSettings>({
  name: 'config',
  schema,
  defaults: DEFAULTS,
  clearInvalidConfig: true
})

// ============================================
// Screenshot Translation Settings
// ============================================

export function getCaptureShortcut(): string {
  return store.get('captureShortcut')
}

export function setCaptureShortcut(shortcut: string): void {
  store.set('captureShortcut', shortcut)
}

export function getScreenshotTargetLanguage(): string {
  return store.get('screenshotTargetLanguage')
}

export function setScreenshotTargetLanguage(language: string): void {
  store.set('screenshotTargetLanguage', language)
}

// ============================================
// Voice Dictation Settings
// ============================================

export function getDictationShortcut(): string {
  return store.get('dictationShortcut')
}

export function setDictationShortcut(shortcut: string): void {
  store.set('dictationShortcut', shortcut)
}

export function getDictationTargetLanguage(): string {
  return store.get('dictationTargetLanguage')
}

export function setDictationTargetLanguage(language: string): void {
  store.set('dictationTargetLanguage', language)
}

/** Missing in older settings files: keep the default ON. An explicit OFF must survive. */
export function getRemoveFillerWords(): boolean {
  return store.get('removeFillerWords') ?? DEFAULTS.removeFillerWords
}

export function getPasteLastShortcut(): string {
  return store.get('pasteLastShortcut')
}

export function setPasteLastShortcut(shortcut: string): void {
  store.set('pasteLastShortcut', shortcut)
}

export function getCopyTextShortcut(): string {
  return store.get('copyTextShortcut')
}

export function setCopyTextShortcut(shortcut: string): void {
  store.set('copyTextShortcut', shortcut)
}

export function getDictionary(): string {
  return store.get('dictionary')
}

/** Saved on its own (not through saveSettings): it is checked against its limits first. */
export function setDictionary(text: string): void {
  store.set('dictionary', text)
}

// ============================================
// Preferred Languages Settings
// ============================================

export function getPreferredLanguages(): string[] {
  const lang1 = store.get('preferredLanguage1')
  const lang2 = store.get('preferredLanguage2')
  const lang3 = store.get('preferredLanguage3')
  return [lang1, lang2, lang3].filter((lang) => lang && lang !== NOT_SELECTED)
}

// ============================================
// Bulk Operations
// ============================================

/** The chosen interface language, or the system language until one is chosen. */
export function getUiLanguage(): UILanguage {
  return store.get('uiLanguage') ?? resolveSystemLanguages(app.getPreferredSystemLanguages())
}

export function hasSeenTryIt(): boolean {
  return store.get('tryItSeen')
}

export function markTryItSeen(): void {
  store.set('tryItSeen', true)
}

export function getAllSettings(): StoreSchema {
  return {
    uiLanguage: getUiLanguage(),
    captureShortcut: store.get('captureShortcut'),
    screenshotTargetLanguage: store.get('screenshotTargetLanguage'),
    dictationShortcut: store.get('dictationShortcut'),
    dictationTargetLanguage: store.get('dictationTargetLanguage'),
    removeFillerWords: getRemoveFillerWords(),
    pasteLastShortcut: store.get('pasteLastShortcut'),
    copyTextShortcut: store.get('copyTextShortcut'),
    dictionary: store.get('dictionary'),
    preferredLanguage1: store.get('preferredLanguage1'),
    preferredLanguage2: store.get('preferredLanguage2'),
    preferredLanguage3: store.get('preferredLanguage3')
  }
}

export function saveSettings(settings: Partial<StoreSchema>): void {
  const keys: (keyof StoreSchema)[] = [
    'uiLanguage',
    'captureShortcut',
    'screenshotTargetLanguage',
    'dictationShortcut',
    'dictationTargetLanguage',
    'removeFillerWords',
    'preferredLanguage1',
    'preferredLanguage2',
    'preferredLanguage3'
  ]

  for (const key of keys) {
    if (settings[key] !== undefined) {
      store.set(key, settings[key] as StoreSchema[typeof key])
    }
  }
}
