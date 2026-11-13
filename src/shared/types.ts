import type { SpeechLevel } from './speech-level'

// Supported UI languages
export type UILanguage =
  | 'en'
  | 'ru'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt'
  | 'it'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'ar'
  | 'hi'
  | 'tr'
  | 'pl'
  | 'uk'
  | 'nl'

// UI language options with native names (autonyms) for the language switcher
export const UI_LANGUAGES: readonly { code: UILanguage; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'ar', nativeName: 'العربية' },
  { code: 'zh', nativeName: '中文' },
  { code: 'nl', nativeName: 'Nederlands' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'hi', nativeName: 'हिन्दी' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'es', nativeName: 'Español' },
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'uk', nativeName: 'Українська' }
]

// Store schema for electron-store
export interface StoreSchema {
  // General settings
  uiLanguage: UILanguage
  // Screenshot translation settings
  captureShortcut: string
  screenshotTargetLanguage: string
  // Voice dictation settings
  dictationShortcut: string
  dictationTargetLanguage: string
  removeFillerWords: boolean
  // Paste the last result again; empty = turned off
  pasteLastShortcut: string
  // Copy the text of a screen region without translating; empty = turned off
  copyTextShortcut: string
  // Preferred languages for quick access in tray menu
  preferredLanguage1: string
  preferredLanguage2: string
  preferredLanguage3: string
  // Encrypted storage (safeStorage), main process only
  /** Names and terms, one per line (see shared/dictionary) */
  dictionary: string
  'apiKey.encrypted'?: string
}

/** What the Settings window loads: the stored settings plus the hotkeys the system refused. */
export type SettingsReply = StoreSchema & { unavailableShortcuts: string[] }

// Selection coordinates from capture overlay
export interface SelectionCoords {
  x: number
  y: number
  width: number
  height: number
}

// Why a translation request failed. The UI uses it to tell the user what to do.
export const TRANSLATION_ERROR_CODES = [
  'MISSING_KEY',
  'INVALID_KEY',
  'QUOTA_EXHAUSTED',
  'QUOTA_DAILY',
  'LOCATION_UNSUPPORTED',
  'NETWORK',
  'TIMEOUT',
  'BLOCKED',
  'INVALID_REQUEST',
  'UNKNOWN'
] as const

export type TranslationErrorCode = (typeof TRANSLATION_ERROR_CODES)[number]

// Translation result
export interface TranslationResult {
  success: boolean
  text?: string
  /** Screen translation: the text as recognised, before translating */
  source?: string
  error?: string
  errorCode?: TranslationErrorCode
  /** A failure mid-stream: the text that had arrived before it */
  partial?: string
  /** The model heard no speech: the audio is fine and stays available for Retry */
  noSpeech?: boolean
}

/** Text of a running AI action that has arrived so far, tagged with the request that asked */
export interface ActionPartial {
  requestId?: number
  text: string
}

// API key state as seen by the renderer. The full key never leaves the main process.
export interface ApiKeyStatus {
  configured: boolean
  masked: string
  /** A key is stored but could not be decrypted (e.g. the keychain blocked access). */
  unreadable?: boolean
}

// Outcome of checking a key against Gemini
export interface KeyTestResult {
  ok: boolean
  error?: string
  errorCode?: TranslationErrorCode
}

// Audio data from voice recording
export interface AudioData {
  audioBase64: string
  mimeType: string
  /** How long the recording ran; scales the provider deadline */
  durationMs?: number
  /** Loudness measured while recording; a clip that never rose above the thresholds is not sent */
  level?: SpeechLevel
}

// Audio data tagged with the dictation session it was recorded for
export interface AudioPayload extends AudioData {
  session: number
  durationMs: number
}

// Why the renderer could not deliver audio; `empty` = nothing was recorded (a deliberate instant stop)
export const RECORDING_FAIL_REASONS = ['empty', 'mic', 'recorder'] as const
export type RecordingFailReason = (typeof RECORDING_FAIL_REASONS)[number]

export interface RecordingFailure {
  session: number
  reason: RecordingFailReason
}

// Dictation target that keeps the spoken language (no translation)
export const KEEP_LANGUAGE = 'Keep my language'

// Special value for unselected preferred language slot
export const NOT_SELECTED = 'Not Selected'

// Supported languages (alphabetically sorted)
export const SUPPORTED_LANGUAGES = [
  { code: 'arabic', name: 'Arabic' },
  { code: 'chinese', name: 'Chinese (Simplified)' },
  { code: 'dutch', name: 'Dutch' },
  { code: 'english', name: 'English' },
  { code: 'french', name: 'French' },
  { code: 'german', name: 'German' },
  { code: 'hindi', name: 'Hindi' },
  { code: 'italian', name: 'Italian' },
  { code: 'japanese', name: 'Japanese' },
  { code: 'korean', name: 'Korean' },
  { code: 'polish', name: 'Polish' },
  { code: 'portuguese', name: 'Portuguese' },
  { code: 'russian', name: 'Russian' },
  { code: 'spanish', name: 'Spanish' },
  { code: 'turkish', name: 'Turkish' },
  { code: 'ukrainian', name: 'Ukrainian' }
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

// Permission status types
export type MediaPermissionStatus = 'granted' | 'denied' | 'not-determined'

export interface PermissionsStatus {
  screenRecording: MediaPermissionStatus
  microphone: MediaPermissionStatus
  accessibility: boolean
  /** The macOS prompt was already shown in this run; the button then opens System Settings */
  accessibilityPrompted: boolean
}

/** The link the "copied" pill offers: it opens System Settings -> Privacy & Security -> Accessibility */
export type CopiedHint = 'open-settings' | 'readd-accessibility' | null

/** A dictation error shown in the indicator instead of a dialog */
export interface DictationErrorPayload {
  /** Already in the user's language */
  message: string
  /** Offer the Retry button (the audio is kept in main) */
  retry: boolean
}
