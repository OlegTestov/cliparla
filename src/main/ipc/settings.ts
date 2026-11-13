/**
 * IPC Settings Handler
 *
 * Handles settings-related IPC communication between main and renderer processes.
 * Domain: get-settings, save-settings, set-shortcut
 */

import { BrowserWindow } from 'electron'
import { handle } from '../core/ipc-guard'
import { broadcastUiLanguage } from '../core/language-broadcast'
import { setupApplicationMenu } from '../core/app-menu'
import {
  getAllSettings,
  getCaptureShortcut,
  getCopyTextShortcut,
  getDictationShortcut,
  getPasteLastShortcut,
  saveSettings,
  setDictionary,
  setCaptureShortcut,
  setCopyTextShortcut,
  setDictationShortcut,
  setPasteLastShortcut
} from '../services/store'
import {
  HOTKEY_TYPES,
  hotkeyManager,
  type HotkeyType,
  type ShortcutUpdate
} from '../core/hotkey-manager'
import { t } from '../core/localize'
import { getUiLanguage } from '../services/store'
import { formatShortcut } from '../../shared/shortcut-format'
import { isTooPlainShortcut } from '../../shared/key-event'
import {
  MAX_DICTIONARY_CHARS,
  MAX_DICTIONARY_LINES,
  parseDictionary
} from '../../shared/dictionary'
import { createLogger } from '../core/logger'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import type { SettingsReply, StoreSchema } from '../../shared/types'
import { updateTrayMenu } from '../services/tray'

const log = createLogger('IPC:Settings')

/**
 * Register settings-related IPC handlers.
 */
export interface SettingsHandlerDeps {
  onUiLanguageChanged?: (language: string) => void
  /** Defaults to the real hotkey manager. */
  updateAccelerator?: (type: HotkeyType, accelerator: string) => ShortcutUpdate
  /** Defaults to the settings store. */
  saveShortcut?: (type: HotkeyType, accelerator: string) => void
  /** Which other hotkey holds this combination; defaults to the real hotkey manager. */
  conflictWith?: (type: HotkeyType, accelerator: string) => HotkeyType | null
  /** Hotkeys the system refused to register; defaults to the real hotkey manager. */
  getUnavailable?: () => HotkeyType[]
}

const SHORTCUT_READERS: Record<HotkeyType, () => string> = {
  capture: getCaptureShortcut,
  dictation: getDictationShortcut,
  pasteLast: getPasteLastShortcut,
  copyText: getCopyTextShortcut
}

const SHORTCUT_WRITERS: Record<HotkeyType, (accelerator: string) => void> = {
  capture: setCaptureShortcut,
  dictation: setDictationShortcut,
  pasteLast: setPasteLastShortcut,
  copyText: setCopyTextShortcut
}

/** Hotkeys the user may switch off */
const CAN_BE_OFF: readonly HotkeyType[] = ['pasteLast', 'copyText']

const OTHER_NAME_KEYS: Record<HotkeyType, string> = {
  capture: 'shortcut.usedByCapture',
  dictation: 'shortcut.usedByDictation',
  pasteLast: 'shortcut.usedByPasteLast',
  copyText: 'shortcut.usedByCopyText'
}

export interface ShortcutResult {
  ok: boolean
  /** Shown under the shortcut field, in the interface language. */
  error?: string
}

const MAX_ACCELERATOR_LENGTH = 64

/** Left-to-right isolate: right-to-left text cannot reorder the shortcut symbols. */
const isolate = (text: string): string => `\u2066${text}\u2069`

/** Text for a refused shortcut, e.g. "⌘⇧D (Cmd+Shift+D) is already used for voice dictation. …" */
export function shortcutMessage(
  update: ShortcutUpdate,
  type: HotkeyType,
  accelerator: string,
  language: string,
  platform: string = process.platform,
  /** The hotkey that holds the combination; without it, the other one of the original pair */
  holder?: HotkeyType | null
): string | undefined {
  if (update === 'ok') return undefined
  // Isolated as left-to-right so right-to-left text cannot reorder the symbols
  const shortcut = isolate(formatShortcut(accelerator, platform))
  if (update === 'conflict') {
    const named = holder ?? (type === 'capture' ? 'dictation' : 'capture')
    const other = t(OTHER_NAME_KEYS[named], language)
    return t('shortcut.conflict', language, { shortcut, other })
  }
  if (update === 'invalid') return t('shortcut.invalid', language, { shortcut })
  return t('shortcut.unavailable', language, { shortcut })
}

const defaultOnUiLanguageChanged = (language: string): void => {
  broadcastUiLanguage(BrowserWindow.getAllWindows(), language)
  setupApplicationMenu()
}

export function registerSettingsHandlers(deps: SettingsHandlerDeps = {}): void {
  const onUiLanguageChanged = deps.onUiLanguageChanged ?? defaultOnUiLanguageChanged
  const saveShortcut =
    deps.saveShortcut ??
    ((type: HotkeyType, accelerator: string) => SHORTCUT_WRITERS[type](accelerator))
  const conflictWith =
    deps.conflictWith ?? ((type, accelerator) => hotkeyManager.conflictWith(type, accelerator))
  const getUnavailable = deps.getUnavailable ?? (() => hotkeyManager.getUnavailable())
  const updateAccelerator =
    deps.updateAccelerator ??
    ((type, accelerator) => hotkeyManager.updateAccelerator(type, accelerator))

  /**
   * Change one shortcut right away. A refused shortcut is not saved; the reply
   * says why, so the field can keep the old value and show the reason inline.
   */
  handle(
    IPC_CHANNELS.SET_SHORTCUT,
    (_event, type: unknown, accelerator: unknown): ShortcutResult => {
      // An empty accelerator turns the hotkey off (capture and dictation always keep one)
      const mayBeOff = CAN_BE_OFF.some((known) => known === type)
      if (
        !HOTKEY_TYPES.some((known) => known === type) ||
        typeof accelerator !== 'string' ||
        (!accelerator && !mayBeOff) ||
        accelerator.length > MAX_ACCELERATOR_LENGTH
      ) {
        return { ok: false }
      }
      const hotkey = type as HotkeyType
      if (accelerator && isTooPlainShortcut(accelerator)) {
        const shortcut = isolate(formatShortcut(accelerator, process.platform))
        return { ok: false, error: t('shortcut.tooPlain', getUiLanguage(), { shortcut }) }
      }
      const previous = SHORTCUT_READERS[hotkey]()
      const update = updateAccelerator(hotkey, accelerator)
      if (update !== 'ok') {
        const holder = update === 'conflict' ? conflictWith(hotkey, accelerator) : null
        return {
          ok: false,
          error: shortcutMessage(
            update,
            hotkey,
            accelerator,
            getUiLanguage(),
            process.platform,
            holder
          )
        }
      }
      try {
        saveShortcut(hotkey, accelerator)
      } catch (error) {
        // The new shortcut is live but not stored: go back so both agree
        log.error(
          'Saving shortcut failed',
          error instanceof Error ? error : new Error(String(error))
        )
        const restored = !!previous && updateAccelerator(hotkey, previous) === 'ok'
        const shortcut = isolate(formatShortcut(accelerator, process.platform))
        // The old shortcut may be gone (e.g. another app took it): do not promise it
        // With no previous shortcut at all there was nothing to restore
        const message = restored
          ? 'shortcut.saveFailed'
          : previous
            ? 'shortcut.saveFailedNoRollback'
            : 'shortcut.saveFailedLive'
        return { ok: false, error: t(message, getUiLanguage(), { shortcut }) }
      }
      log.info('Shortcut updated', { type, accelerator })
      updateTrayMenu()
      return { ok: true }
    }
  )

  /**
   * Save the personal dictionary. Text over the limits is refused with a message, never cut.
   */
  handle(IPC_CHANNELS.SET_DICTIONARY, (_event, text: unknown): ShortcutResult => {
    if (typeof text !== 'string') return { ok: false }
    const parsed = parseDictionary(text)
    if (!parsed.ok) {
      const language = getUiLanguage()
      return parsed.problem === 'tooManyLines'
        ? {
            ok: false,
            error: t('settings.general.dictionaryTooMany', language, { max: MAX_DICTIONARY_LINES })
          }
        : {
            ok: false,
            error: t('settings.general.dictionaryTooLong', language, {
              max: MAX_DICTIONARY_CHARS.toLocaleString(language)
            })
          }
    }
    setDictionary(parsed.lines.join('\n'))
    log.info('Dictionary saved', { lines: parsed.lines.length })
    return { ok: true }
  })

  /**
   * Get all application settings. Never includes the API key.
   */
  handle(IPC_CHANNELS.GET_SETTINGS, (): SettingsReply => {
    log.debug('Getting all settings')
    return { ...getAllSettings(), unavailableShortcuts: getUnavailable() }
  })

  /**
   * Save application settings.
   * Handles shortcut changes separately. The API key has its own channels.
   */
  handle(IPC_CHANNELS.SAVE_SETTINGS, (_event, settings: Partial<StoreSchema>): void => {
    log.debug('Saving settings', { keys: Object.keys(settings) })

    // Track which settings should be excluded from general save
    const handledKeys: string[] = []

    // Handle capture shortcut change
    if (settings.captureShortcut !== undefined) {
      const success =
        !isTooPlainShortcut(settings.captureShortcut) &&
        updateAccelerator('capture', settings.captureShortcut) === 'ok'
      if (success) {
        setCaptureShortcut(settings.captureShortcut)
        log.info('Capture shortcut updated', { shortcut: settings.captureShortcut })
      }
      handledKeys.push('captureShortcut')
    }

    // Handle dictation shortcut change
    if (settings.dictationShortcut !== undefined) {
      const success =
        !isTooPlainShortcut(settings.dictationShortcut) &&
        updateAccelerator('dictation', settings.dictationShortcut) === 'ok'
      if (success) {
        setDictationShortcut(settings.dictationShortcut)
        log.info('Dictation shortcut updated', { shortcut: settings.dictationShortcut })
      }
      handledKeys.push('dictationShortcut')
    }

    // Save remaining settings (excluding already handled ones)
    const remainingSettings = { ...settings } as Record<string, unknown>
    for (const key of handledKeys) {
      delete remainingSettings[key]
    }
    if (Object.keys(remainingSettings).length > 0) {
      saveSettings(remainingSettings as Partial<StoreSchema>)
    }

    // Update tray menu if language-related settings changed
    const languageKeys: (keyof StoreSchema)[] = [
      'uiLanguage',
      'preferredLanguage1',
      'preferredLanguage2',
      'preferredLanguage3',
      'screenshotTargetLanguage',
      'dictationTargetLanguage'
    ]
    if (languageKeys.some((key) => settings[key] !== undefined)) {
      updateTrayMenu()
    }
    if (settings.uiLanguage !== undefined) onUiLanguageChanged(settings.uiLanguage)
  })
}
