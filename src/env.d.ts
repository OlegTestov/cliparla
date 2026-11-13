/// <reference types="vite/client" />

import type {
  SettingsReply,
  StoreSchema,
  SelectionCoords,
  TranslationResult,
  ActionPartial,
  AudioPayload,
  RecordingFailure,
  CopiedHint,
  DictationErrorPayload,
  PermissionsStatus,
  ApiKeyStatus,
  KeyTestResult
} from './shared/types'

// Module declarations for static assets
declare module '*.png' {
  const value: string
  export default value
}

declare module '*.jpg' {
  const value: string
  export default value
}

declare module '*.jpeg' {
  const value: string
  export default value
}

declare module '*.gif' {
  const value: string
  export default value
}

declare module '*.svg' {
  const value: string
  export default value
}

declare module '@resources/*' {
  const value: string
  export default value
}

// Environment variables
interface ImportMetaEnv {
  readonly ELECTRON_RENDERER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Electron API exposed via preload script
interface ElectronAPI {
  // Platform
  platform: string

  // Settings
  getSettings: () => Promise<SettingsReply>
  saveSettings: (settings: Partial<StoreSchema>) => Promise<void>

  setDictionary: (text: string) => Promise<{ ok: boolean; error?: string }>

  // Capture
  sendSelection: (coords: SelectionCoords) => void
  cancelCapture: () => void

  // Result
  copyToClipboard: (text: string) => Promise<void>
  copyScreenshot: () => Promise<{ success: boolean }>
  closeResult: () => void
  /** Translate the last captured region again */
  retryTranslation: () => void

  // Text Processing (Comment/Improve/Summarize)
  commentText: (text: string, requestId?: number) => Promise<TranslationResult>
  improveText: (text: string, requestId?: number) => Promise<TranslationResult>
  summarizeText: (text: string, requestId?: number) => Promise<TranslationResult>

  // Event listeners
  onTranslationStart: (callback: () => void) => () => void
  onTranslationComplete: (callback: (result: TranslationResult) => void) => () => void
  /** The translation text received so far, while it is still arriving */
  onTranslationPartial: (callback: (text: string) => void) => () => void
  /** The text of the running AI action received so far */
  onActionPartial: (callback: (partial: ActionPartial) => void) => () => void

  onToast: (callback: (text: string) => void) => () => void

  // Listening indicator events
  onListeningStart: (callback: (session: number) => void) => () => void
  onListeningProcessing: (callback: (retrying: boolean) => void) => () => void
  onListeningCopied: (callback: (hint: CopiedHint) => void) => () => void
  onListeningError: (callback: (payload: DictationErrorPayload) => void) => () => void
  /** The dictation text received so far, while the answer is still arriving */
  onListeningText: (callback: (text: string) => void) => () => void
  onListeningStop: (callback: () => void) => () => void

  // Audio recording
  sendAudioData: (audioData: AudioPayload) => void

  // Dictation control
  cancelDictation: () => void
  stopDictation: () => void
  retryDictation: () => void
  indicatorPageReady: () => void
  indicatorPageFailed: () => void
  setIndicatorHover: (hovered: boolean) => void
  recordingStarted: (session: number) => void
  recordingFailed: (failure: RecordingFailure) => void

  // Permissions
  getPermissionsStatus: () => Promise<PermissionsStatus>
  requestScreenRecordingPermission: () => Promise<string>
  requestMicrophonePermission: () => Promise<string>
  requestAccessibilityPermission: () => Promise<boolean>
  openScreenRecordingSettings: () => void
  openMicrophoneSettings: () => void
  openAccessibilitySettings: () => void
  permissionsContinue: () => void
  onPermissionsWindowShown: (callback: () => void) => () => void
  onPermissionsWindowHidden: (callback: () => void) => () => void

  // API key (masked status only; the key never reaches the renderer)
  /** `retry` reads a key the keychain refused earlier again (only on the user's request). */
  getKeyStatus: (options?: { retry: true }) => Promise<ApiKeyStatus>
  testKey: (candidate?: string) => Promise<KeyTestResult>
  saveKey: (
    candidate: string
  ) => Promise<{ success: boolean; status: ApiKeyStatus; error?: string }>
  removeKey: () => Promise<ApiKeyStatus>
  setupDone: () => void
  tryCapture: () => void
  finishOnboarding: () => void
  /** Change a shortcut now; a refused one is not saved and comes back with a reason. */
  setShortcut: (
    type: 'capture' | 'dictation' | 'pasteLast' | 'copyText',
    accelerator: string
  ) => Promise<{ ok: boolean; error?: string }>
  /** Ask for a taller window when the page does not fit (it never shrinks). */
  /** The page was just cleared: give the window back its configured height */
  resetWindowHeight: () => void
  fitWindowHeight: (height: number) => void
  /** The screen the setup window was last asked to show (read once on load). */
  getSetupReason: () => Promise<string | null>
  /** True until the first-run "Try it now" step was used or skipped. */
  getTryItPending: () => Promise<boolean>
  onSetupReset: (callback: (reason?: string) => void) => () => void

  // Settings changed from tray
  onUiLanguageChanged: (callback: (language: string) => void) => () => void
  onSettingsChangedFromTray: (callback: () => void) => () => void

  // App
  getAppVersion: () => Promise<string>
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
