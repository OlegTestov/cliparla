import { contextBridge, ipcRenderer } from 'electron'
import type {
  SettingsReply,
  StoreSchema,
  SelectionCoords,
  TranslationResult,
  AudioPayload,
  RecordingFailure,
  CopiedHint,
  DictationErrorPayload,
  PermissionsStatus,
  ApiKeyStatus,
  KeyTestResult,
  ActionPartial
} from '../shared/types'
import { IPC_CHANNELS } from '../shared/ipc-types'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI = {
  // Platform
  platform: process.platform,

  // Settings
  getSettings: (): Promise<SettingsReply> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Partial<StoreSchema>): Promise<void> =>
    ipcRenderer.invoke('save-settings', settings),

  setDictionary: (text: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_DICTIONARY, text),

  // Capture
  sendSelection: (coords: SelectionCoords): void => ipcRenderer.send('selection-made', coords),
  cancelCapture: (): void => ipcRenderer.send('cancel-capture'),

  // Result
  copyToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('copy-to-clipboard', text),
  copyScreenshot: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.COPY_SCREENSHOT),
  closeResult: (): void => ipcRenderer.send('close-result'),
  retryTranslation: (): void => ipcRenderer.send(IPC_CHANNELS.RETRY_TRANSLATION),

  // Text Processing (Comment/Improve/Summarize)
  commentText: (text: string, requestId?: number): Promise<TranslationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.COMMENT_TEXT, text, requestId),
  improveText: (text: string, requestId?: number): Promise<TranslationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPROVE_TEXT, text, requestId),
  summarizeText: (text: string, requestId?: number): Promise<TranslationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SUMMARIZE_TEXT, text, requestId),

  // Listen for translation result
  onTranslationStart: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('translation-start', handler)
    return () => ipcRenderer.removeListener('translation-start', handler)
  },
  onTranslationComplete: (callback: (result: TranslationResult) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: TranslationResult): void =>
      callback(result)
    ipcRenderer.on('translation-complete', handler)
    return () => ipcRenderer.removeListener('translation-complete', handler)
  },

  onTranslationPartial: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_PARTIAL, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TRANSLATION_PARTIAL, handler)
  },
  onActionPartial: (callback: (partial: ActionPartial) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, partial: ActionPartial): void =>
      callback(partial)
    ipcRenderer.on(IPC_CHANNELS.ACTION_PARTIAL, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ACTION_PARTIAL, handler)
  },

  // A short message near the cursor
  onToast: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on(IPC_CHANNELS.TOAST_SHOW, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TOAST_SHOW, handler)
  },

  // Listening indicator events
  onListeningStart: (callback: (session: number) => void): (() => void) => {
    const handler = (_event: unknown, session: number): void => callback(session)
    ipcRenderer.on('listening-mode-start', handler)
    return () => ipcRenderer.removeListener('listening-mode-start', handler)
  },
  onListeningProcessing: (callback: (retrying: boolean) => void): (() => void) => {
    const handler = (_event: unknown, retrying?: boolean): void => callback(retrying === true)
    ipcRenderer.on('listening-mode-processing', handler)
    return () => ipcRenderer.removeListener('listening-mode-processing', handler)
  },
  onListeningCopied: (callback: (hint: CopiedHint) => void): (() => void) => {
    const handler = (_event: unknown, hint?: CopiedHint): void => callback(hint ?? null)
    ipcRenderer.on('listening-mode-copied', handler)
    return () => ipcRenderer.removeListener('listening-mode-copied', handler)
  },
  onListeningError: (callback: (payload: DictationErrorPayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: DictationErrorPayload): void => callback(payload)
    ipcRenderer.on('listening-mode-error', handler)
    return () => ipcRenderer.removeListener('listening-mode-error', handler)
  },
  onListeningText: (callback: (text: string) => void): (() => void) => {
    const handler = (_event: unknown, text: string): void => callback(text)
    ipcRenderer.on(IPC_CHANNELS.LISTENING_MODE_TEXT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.LISTENING_MODE_TEXT, handler)
  },
  onListeningStop: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('listening-mode-stop', handler)
    return () => ipcRenderer.removeListener('listening-mode-stop', handler)
  },

  // Audio recording - send recorded audio data to main process
  sendAudioData: (audioData: AudioPayload): void => ipcRenderer.send('audio-data-ready', audioData),

  // Dictation control
  cancelDictation: (): void => ipcRenderer.send('cancel-dictation'),
  stopDictation: (): void => ipcRenderer.send('stop-dictation'),
  retryDictation: (): void => ipcRenderer.send('retry-dictation'),
  indicatorPageReady: (): void => ipcRenderer.send('indicator-page-ready'),
  indicatorPageFailed: (): void => ipcRenderer.send('indicator-page-failed'),
  setIndicatorHover: (hovered: boolean): void => ipcRenderer.send('indicator-hover', hovered),
  recordingStarted: (session: number): void => ipcRenderer.send('recording-started', session),
  recordingFailed: (failure: RecordingFailure): void =>
    ipcRenderer.send('recording-failed', failure),

  // Permissions
  getPermissionsStatus: (): Promise<PermissionsStatus> =>
    ipcRenderer.invoke('get-permissions-status'),
  requestScreenRecordingPermission: (): Promise<void> =>
    ipcRenderer.invoke('request-screen-recording-permission'),
  requestMicrophonePermission: (): Promise<string> =>
    ipcRenderer.invoke('request-microphone-permission'),
  requestAccessibilityPermission: (): Promise<boolean> =>
    ipcRenderer.invoke('request-accessibility-permission'),
  openScreenRecordingSettings: (): void => ipcRenderer.send('open-screen-recording-settings'),
  openMicrophoneSettings: (): void => ipcRenderer.send('open-microphone-settings'),
  openAccessibilitySettings: (): void => ipcRenderer.send('open-accessibility-settings'),
  permissionsContinue: (): void => ipcRenderer.send('permissions-continue'),

  // Permissions window visibility events
  onPermissionsWindowShown: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('permissions-window-shown', handler)
    return () => ipcRenderer.removeListener('permissions-window-shown', handler)
  },
  onPermissionsWindowHidden: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('permissions-window-hidden', handler)
    return () => ipcRenderer.removeListener('permissions-window-hidden', handler)
  },

  // API key: the renderer only ever gets a masked status, never the key itself
  getKeyStatus: (options?: { retry: true }): Promise<ApiKeyStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_KEY_STATUS, options),
  testKey: (candidate?: string): Promise<KeyTestResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TEST_KEY, candidate),
  saveKey: (
    candidate: string
  ): Promise<{ success: boolean; status: ApiKeyStatus; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_KEY, candidate),
  removeKey: (): Promise<ApiKeyStatus> => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_KEY),
  setupDone: (): void => ipcRenderer.send(IPC_CHANNELS.SETUP_DONE),
  tryCapture: (): void => ipcRenderer.send(IPC_CHANNELS.TRY_CAPTURE),
  finishOnboarding: (): void => ipcRenderer.send(IPC_CHANNELS.FINISH_ONBOARDING),
  setShortcut: (
    type: 'capture' | 'dictation' | 'pasteLast' | 'copyText',
    accelerator: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SHORTCUT, type, accelerator),
  resetWindowHeight: (): void => ipcRenderer.send(IPC_CHANNELS.RESET_WINDOW_HEIGHT),
  fitWindowHeight: (height: number): void =>
    ipcRenderer.send(IPC_CHANNELS.FIT_WINDOW_HEIGHT, height),
  getSetupReason: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.GET_SETUP_REASON),
  getTryItPending: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.GET_TRY_IT_PENDING),
  onSetupReset: (callback: (reason?: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, reason?: string): void => callback(reason)
    ipcRenderer.on(IPC_CHANNELS.SETUP_RESET, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SETUP_RESET, handler)
  },

  onUiLanguageChanged: (callback: (language: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, language: string): void =>
      callback(language)
    ipcRenderer.on(IPC_CHANNELS.UI_LANGUAGE_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UI_LANGUAGE_CHANGED, handler)
  },

  // Settings changed from tray (for syncing UI when user changes language from tray menu)
  onSettingsChangedFromTray: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('settings-changed-from-tray', handler)
    return () => ipcRenderer.removeListener('settings-changed-from-tray', handler)
  },

  // App
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI
