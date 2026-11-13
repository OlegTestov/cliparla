/**
 * IPC Channel Types
 *
 * Centralized definition of all IPC channel names used for communication
 * between main and renderer processes.
 *
 * CRITICAL: String values MUST match exactly what renderer/preload expects.
 * Changing these values will break renderer compatibility.
 */

// ============================================================================
// IPC Channel Constants
// ============================================================================

export const IPC_CHANNELS = {
  // Settings
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  SET_DICTIONARY: 'set-dictionary',

  // Capture
  SELECTION_MADE: 'selection-made',
  CANCEL_CAPTURE: 'cancel-capture',

  // Result
  COPY_TO_CLIPBOARD: 'copy-to-clipboard',
  CLOSE_RESULT: 'close-result',
  TRANSLATION_START: 'translation-start',
  TRANSLATION_COMPLETE: 'translation-complete',
  /** Text of the translation that has arrived so far */
  TRANSLATION_PARTIAL: 'translation-partial',
  /** Text of an AI action that has arrived so far */
  ACTION_PARTIAL: 'action-partial',
  RETRY_TRANSLATION: 'retry-translation',

  // Toast
  TOAST_SHOW: 'toast-show',

  // Dictation
  AUDIO_DATA_READY: 'audio-data-ready',
  CANCEL_DICTATION: 'cancel-dictation',
  STOP_DICTATION: 'stop-dictation',
  INDICATOR_HOVER: 'indicator-hover',
  RECORDING_FAILED: 'recording-failed',
  RECORDING_STARTED: 'recording-started',
  LISTENING_MODE_START: 'listening-mode-start',
  LISTENING_MODE_PROCESSING: 'listening-mode-processing',
  LISTENING_MODE_COPIED: 'listening-mode-copied',
  LISTENING_MODE_STOP: 'listening-mode-stop',
  LISTENING_MODE_ERROR: 'listening-mode-error',
  /** Text of the dictation that has arrived so far, shown in the processing pill */
  LISTENING_MODE_TEXT: 'listening-mode-text',
  RETRY_DICTATION: 'retry-dictation',
  INDICATOR_PAGE_READY: 'indicator-page-ready',
  INDICATOR_PAGE_FAILED: 'indicator-page-failed',

  // Permissions
  GET_PERMISSIONS_STATUS: 'get-permissions-status',
  REQUEST_SCREEN_RECORDING: 'request-screen-recording-permission',
  REQUEST_MICROPHONE: 'request-microphone-permission',
  REQUEST_ACCESSIBILITY: 'request-accessibility-permission',
  OPEN_SCREEN_RECORDING_SETTINGS: 'open-screen-recording-settings',
  OPEN_MICROPHONE_SETTINGS: 'open-microphone-settings',
  OPEN_ACCESSIBILITY_SETTINGS: 'open-accessibility-settings',
  PERMISSIONS_CONTINUE: 'permissions-continue',
  PERMISSIONS_WINDOW_SHOWN: 'permissions-window-shown',
  PERMISSIONS_WINDOW_HIDDEN: 'permissions-window-hidden',

  // API key (the renderer only ever sees a masked status)
  GET_KEY_STATUS: 'get-key-status',
  TEST_KEY: 'test-key',
  SAVE_KEY: 'save-key',
  REMOVE_KEY: 'remove-key',
  SETUP_RESET: 'setup-reset',
  GET_SETUP_REASON: 'get-setup-reason',
  GET_TRY_IT_PENDING: 'get-try-it-pending',
  SET_SHORTCUT: 'set-shortcut',
  FIT_WINDOW_HEIGHT: 'fit-window-height',
  /** A page whose content was just cleared asks for its window's base height back */
  RESET_WINDOW_HEIGHT: 'reset-window-height',
  UI_LANGUAGE_CHANGED: 'ui-language-changed',
  SETUP_DONE: 'setup-done',
  TRY_CAPTURE: 'try-capture',
  FINISH_ONBOARDING: 'finish-onboarding',

  // Text Processing (Comment/Improve/Summarize)
  COMMENT_TEXT: 'comment-text',
  IMPROVE_TEXT: 'improve-text',
  SUMMARIZE_TEXT: 'summarize-text',

  // Screenshot
  COPY_SCREENSHOT: 'copy-screenshot',

  // App
  OPEN_EXTERNAL: 'open-external',
  GET_APP_VERSION: 'get-app-version'
} as const

// ============================================================================
// Type Exports
// ============================================================================

/** Union type of all IPC channel names */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** IPC channels that use ipcMain.handle (request-response pattern) */
export type IpcInvokeChannel =
  | typeof IPC_CHANNELS.GET_SETTINGS
  | typeof IPC_CHANNELS.SAVE_SETTINGS
  | typeof IPC_CHANNELS.SET_DICTIONARY
  | typeof IPC_CHANNELS.COPY_TO_CLIPBOARD
  | typeof IPC_CHANNELS.GET_PERMISSIONS_STATUS
  | typeof IPC_CHANNELS.REQUEST_SCREEN_RECORDING
  | typeof IPC_CHANNELS.REQUEST_MICROPHONE
  | typeof IPC_CHANNELS.REQUEST_ACCESSIBILITY
  | typeof IPC_CHANNELS.GET_KEY_STATUS
  | typeof IPC_CHANNELS.GET_SETUP_REASON
  | typeof IPC_CHANNELS.GET_TRY_IT_PENDING
  | typeof IPC_CHANNELS.SET_SHORTCUT
  | typeof IPC_CHANNELS.TEST_KEY
  | typeof IPC_CHANNELS.SAVE_KEY
  | typeof IPC_CHANNELS.REMOVE_KEY
  | typeof IPC_CHANNELS.OPEN_EXTERNAL
  | typeof IPC_CHANNELS.GET_APP_VERSION
  | typeof IPC_CHANNELS.COMMENT_TEXT
  | typeof IPC_CHANNELS.IMPROVE_TEXT
  | typeof IPC_CHANNELS.SUMMARIZE_TEXT
  | typeof IPC_CHANNELS.COPY_SCREENSHOT

/** IPC channels that use ipcMain.on (fire-and-forget pattern) */
export type IpcSendChannel =
  | typeof IPC_CHANNELS.SELECTION_MADE
  | typeof IPC_CHANNELS.CANCEL_CAPTURE
  | typeof IPC_CHANNELS.CLOSE_RESULT
  | typeof IPC_CHANNELS.RETRY_TRANSLATION
  | typeof IPC_CHANNELS.AUDIO_DATA_READY
  | typeof IPC_CHANNELS.CANCEL_DICTATION
  | typeof IPC_CHANNELS.STOP_DICTATION
  | typeof IPC_CHANNELS.RETRY_DICTATION
  | typeof IPC_CHANNELS.INDICATOR_PAGE_READY
  | typeof IPC_CHANNELS.INDICATOR_PAGE_FAILED
  | typeof IPC_CHANNELS.INDICATOR_HOVER
  | typeof IPC_CHANNELS.RECORDING_FAILED
  | typeof IPC_CHANNELS.RECORDING_STARTED
  | typeof IPC_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS
  | typeof IPC_CHANNELS.OPEN_MICROPHONE_SETTINGS
  | typeof IPC_CHANNELS.OPEN_ACCESSIBILITY_SETTINGS
  | typeof IPC_CHANNELS.PERMISSIONS_CONTINUE
  | typeof IPC_CHANNELS.SETUP_DONE
  | typeof IPC_CHANNELS.TRY_CAPTURE
  | typeof IPC_CHANNELS.FINISH_ONBOARDING
  | typeof IPC_CHANNELS.FIT_WINDOW_HEIGHT
  | typeof IPC_CHANNELS.RESET_WINDOW_HEIGHT

/** IPC channels sent from main to renderer */
export type IpcMainToRendererChannel =
  | typeof IPC_CHANNELS.TRANSLATION_START
  | typeof IPC_CHANNELS.TRANSLATION_COMPLETE
  | typeof IPC_CHANNELS.TRANSLATION_PARTIAL
  | typeof IPC_CHANNELS.ACTION_PARTIAL
  | typeof IPC_CHANNELS.TOAST_SHOW
  | typeof IPC_CHANNELS.LISTENING_MODE_START
  | typeof IPC_CHANNELS.LISTENING_MODE_PROCESSING
  | typeof IPC_CHANNELS.LISTENING_MODE_STOP
  | typeof IPC_CHANNELS.LISTENING_MODE_ERROR
  | typeof IPC_CHANNELS.LISTENING_MODE_TEXT
  | typeof IPC_CHANNELS.SETUP_RESET
  | typeof IPC_CHANNELS.UI_LANGUAGE_CHANGED
  | typeof IPC_CHANNELS.PERMISSIONS_WINDOW_SHOWN
  | typeof IPC_CHANNELS.PERMISSIONS_WINDOW_HIDDEN
