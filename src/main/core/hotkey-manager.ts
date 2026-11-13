import { globalShortcut } from 'electron'
import { createLogger } from './logger'
import { resyncEscapeShortcut } from '../services/dictation/escape-shortcut'
import { isTooPlainShortcut } from '../../shared/key-event'
import {
  defaultShortcut,
  getCaptureShortcut,
  getCopyTextShortcut,
  getDictationShortcut,
  getPasteLastShortcut,
  setCaptureShortcut,
  setCopyTextShortcut,
  setDictationShortcut,
  setPasteLastShortcut
} from '../services/store'

const log = createLogger('HotkeyManager')

/**
 * Hotkey mode determines which callbacks are executed when hotkeys are pressed.
 * - 'protected': Both hotkeys open the setup window (no API key yet)
 * - 'normal': Hotkeys execute their normal functions (capture/dictation)
 */
export type HotkeyMode = 'protected' | 'normal'

/** Every global hotkey the app owns. */
export const HOTKEY_TYPES = ['capture', 'dictation', 'pasteLast', 'copyText'] as const
export type HotkeyType = (typeof HOTKEY_TYPES)[number]

const storedAccelerator: Record<HotkeyType, () => string> = {
  capture: getCaptureShortcut,
  dictation: getDictationShortcut,
  pasteLast: getPasteLastShortcut,
  copyText: getCopyTextShortcut
}

/** Why a new shortcut was or was not taken. */
/** 'unavailable': taken by the system or another app. 'invalid': Electron cannot parse it. */
export type ShortcutUpdate = 'ok' | 'conflict' | 'unavailable' | 'invalid'

/**
 * Configuration for a single hotkey
 */
export interface HotkeyCallbacks {
  normalCallback: () => void
  protectedCallback: () => void
}

/**
 * Full configuration for hotkey manager initialization
 */
export interface HotkeyConfig {
  capture: HotkeyCallbacks
  dictation: HotkeyCallbacks
  pasteLast?: HotkeyCallbacks
  copyText?: HotkeyCallbacks
}

/** Electron throws (not returns false) for accelerators it cannot parse, e.g. `Alt+Shift+Ç`. */
function tryRegister(accelerator: string, callback: () => void): 'ok' | 'unavailable' | 'invalid' {
  try {
    return globalShortcut.register(accelerator, callback) ? 'ok' : 'unavailable'
  } catch (error) {
    log.error('Accelerator rejected by Electron', error as Error, { accelerator })
    return 'invalid'
  }
}

function isRegistered(accelerator: string): boolean {
  try {
    return globalShortcut.isRegistered(accelerator)
  } catch {
    return false
  }
}

const MODIFIER_ALIASES: Record<string, string> = {
  cmdorctrl: 'commandorcontrol',
  cmd: 'command',
  ctrl: 'control',
  option: 'alt'
}

/** Same key combination, however spelled (`CmdOrCtrl+Shift+S` = `shift+commandorcontrol+s`). */
export function sameAccelerator(a: string, b: string): boolean {
  const normalise = (value: string): string =>
    value
      .split('+')
      .map((part) => part.toLowerCase())
      .map((part) => MODIFIER_ALIASES[part] ?? part)
      // On a Mac CommandOrControl is Command: both spellings are one key
      .map((part) =>
        process.platform === 'darwin' && part === 'commandorcontrol' ? 'command' : part
      )
      .sort()
      .join('+')
  return normalise(a) === normalise(b)
}

/**
 * Internal state for a registered hotkey
 */
interface HotkeyState {
  /** null: not read yet; '': turned off by the user */
  accelerator: string | null
  callbacks: HotkeyCallbacks | null
}

const OPTIONAL_TYPES: readonly HotkeyType[] = ['pasteLast', 'copyText']
const DISABLERS: Partial<Record<HotkeyType, () => void>> = {
  pasteLast: () => setPasteLastShortcut(''),
  copyText: () => setCopyTextShortcut('')
}

const SETTERS: Record<HotkeyType, (accelerator: string) => void> = {
  capture: setCaptureShortcut,
  dictation: setDictationShortcut,
  pasteLast: setPasteLastShortcut,
  copyText: setCopyTextShortcut
}

// Old non-Mac defaults: Ctrl+Alt is AltGr, so these typed a character on some layouts
const LEGACY_DEFAULTS: Partial<Record<HotkeyType, string>> = {
  pasteLast: 'Control+Alt+V',
  copyText: 'Control+Alt+C'
}

// Used only when a required key's default is held by another key
const REQUIRED_FALLBACKS: Record<'capture' | 'dictation', string[]> = {
  capture: ['CommandOrControl+Shift+Alt+S', 'CommandOrControl+Shift+Alt+K'],
  dictation: ['CommandOrControl+Shift+Alt+D', 'CommandOrControl+Shift+Alt+J']
}

/**
 * A stored shortcut that would hijack typing or editing (a Cmd+V saved by an old recorder,
 * an old AltGr default) is replaced before it is registered: by the default when that is free,
 * else optional hotkeys are turned off.
 */
function repairStoredAccelerator(type: HotkeyType, stored: string, taken: string[]): string {
  const legacy = LEGACY_DEFAULTS[type]
  const isLegacy = process.platform !== 'darwin' && !!legacy && sameAccelerator(stored, legacy)
  // Empty means "off", which only optional hotkeys may be
  const needsRepair = stored
    ? isTooPlainShortcut(stored) || isLegacy
    : !OPTIONAL_TYPES.includes(type)
  if (!needsRepair) return stored
  const isFree = (candidate: string): boolean =>
    !isTooPlainShortcut(candidate) && !taken.some((t) => sameAccelerator(t, candidate))
  const fallback = defaultShortcut(type)
  let next: string
  if (isFree(fallback)) next = fallback
  else if (OPTIONAL_TYPES.includes(type)) next = ''
  else {
    // A required key must keep a shortcut: take a safe free one when its default is held
    const safe = REQUIRED_FALLBACKS[type as keyof typeof REQUIRED_FALLBACKS]
    // then any Cmd+Shift+Alt+letter: other keys hold at most three, so one of 26 is always free
    const letters = Array.from(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      (l) => `CommandOrControl+Shift+Alt+${l}`
    )
    const free = [...safe, ...letters].find(isFree)
    if (!free) throw new Error(`No free shortcut left for ${type}`)
    next = free
  }
  log.warn('Stored hotkey would take over typing, replaced', { type, stored, next })
  SETTERS[type](next)
  return next
}

const emptyStates = (): Record<HotkeyType, HotkeyState> => ({
  capture: { accelerator: null, callbacks: null },
  dictation: { accelerator: null, callbacks: null },
  pasteLast: { accelerator: null, callbacks: null },
  copyText: { accelerator: null, callbacks: null }
})

/**
 * HotkeyManager provides unified management of global hotkeys with support
 * for protected/normal modes and atomic mode switching with rollback.
 */
class HotkeyManagerImpl {
  private mode: HotkeyMode = 'protected'
  private config: HotkeyConfig | null = null
  private initialized = false

  private states = emptyStates()
  private readonly changeListeners = new Set<() => void>()

  /** Called after the mode or any accelerator changed (also when everything was released). */
  onChange(listener: () => void): void {
    this.changeListeners.add(listener)
  }

  private notifyChange(): void {
    this.changeListeners.forEach((listener) => listener())
  }

  /**
   * Initialize the hotkey manager with callbacks for both modes.
   * Must be called before setMode() or updateAccelerator().
   */
  initialize(config: HotkeyConfig): void {
    if (this.initialized) {
      log.warn('HotkeyManager already initialized, re-initializing')
      this.unregisterAll()
    }

    this.config = config
    for (const type of HOTKEY_TYPES) this.states[type].callbacks = config[type] ?? null
    this.initialized = true

    log.info('HotkeyManager initialized')
  }

  /**
   * Get the current hotkey mode.
   */
  getMode(): HotkeyMode {
    return this.mode
  }

  /**
   * Set the hotkey mode and re-register all hotkeys with appropriate callbacks.
   * A hotkey that cannot be registered does not change the mode.
   */
  setMode(mode: HotkeyMode): void {
    if (!this.initialized || !this.config) {
      log.error('Cannot set mode: HotkeyManager not initialized', new Error('Not initialized'))
      return
    }

    // Check if hotkeys need to be registered (first call or mode change)
    const needsRegistration =
      HOTKEY_TYPES.some((type) => this.states[type].accelerator === null) || this.mode !== mode

    if (!needsRegistration) {
      log.debug('Mode already set and hotkeys registered', { mode })
      return
    }

    log.info('Switching hotkey mode', { from: this.mode, to: mode })

    // The mode follows the key state, not the shortcuts: a shortcut another app
    // holds must not flip the app into "no key" mode. Each hotkey registers on
    // its own, and a failed one can be registered again later.
    this.unregisterAllInternal()
    this.mode = mode

    const failed = HOTKEY_TYPES.filter((type) => !this.registerHotkey(type))
    if (failed.length > 0) {
      log.error('Some hotkeys could not be registered', new Error('Registration failed'), {
        failed,
        mode
      })
    }
    // unregisterAll() above also dropped Escape if a dictation is under way
    resyncEscapeShortcut()
    this.notifyChange()
  }

  /**
   * Update the accelerator for a specific hotkey type. The old shortcut stays
   * active when the new one is refused; the caller tells the user why.
   */
  updateAccelerator(type: HotkeyType, accelerator: string): ShortcutUpdate {
    if (!this.initialized) {
      log.error(
        'Cannot update accelerator: HotkeyManager not initialized',
        new Error('Not initialized')
      )
      return 'unavailable'
    }

    const state = this.states[type]

    if (accelerator === '') {
      if (state.accelerator) globalShortcut.unregister(state.accelerator)
      state.accelerator = ''
      log.info('Hotkey turned off', { type })
      this.notifyChange()
      return 'ok'
    }

    if (this.conflictWith(type, accelerator)) {
      log.warn('Shortcut conflict detected', { type, accelerator })
      return 'conflict'
    }
    // Same shortcut: nothing to do only if it is really registered (it may have failed at startup)
    if (
      state.accelerator &&
      sameAccelerator(accelerator, state.accelerator) &&
      isRegistered(state.accelerator)
    ) {
      return 'ok'
    }

    // Register the new shortcut first: the old one is only released once the
    // new one works, so any refusal (taken, or not parseable) changes nothing.
    const callback = this.callbackFor(state)
    const attempt = callback ? tryRegister(accelerator, callback) : 'unavailable'
    if (attempt !== 'ok') {
      log.warn('Shortcut refused, keeping the old one', { type, accelerator, reason: attempt })
      return attempt
    }

    const oldAccelerator = state.accelerator
    if (oldAccelerator && !sameAccelerator(oldAccelerator, accelerator)) {
      globalShortcut.unregister(oldAccelerator)
      log.debug('Unregistered previous hotkey', { type, accelerator: oldAccelerator })
    }
    state.accelerator = accelerator

    log.info('Accelerator updated', { type, accelerator })
    this.notifyChange()
    return 'ok'
  }

  /** The other hotkey that already uses this key combination, if any. */
  conflictWith(type: HotkeyType, accelerator: string): HotkeyType | null {
    return (
      HOTKEY_TYPES.find((other) => {
        const held = this.states[other].accelerator
        return other !== type && !!held && sameAccelerator(accelerator, held)
      }) ?? null
    )
  }

  private callbackFor(state: HotkeyState): (() => void) | null {
    if (!state.callbacks) return null
    return this.mode === 'normal'
      ? state.callbacks.normalCallback
      : state.callbacks.protectedCallback
  }

  /**
   * Unregister all hotkeys. Should be called on app quit or before mode switch.
   */
  unregisterAll(): void {
    this.unregisterAllInternal()
    this.initialized = false
    this.config = null
    this.mode = 'protected'
    this.states = emptyStates()
    log.info('All hotkeys unregistered and manager reset')
    this.notifyChange()
  }

  /**
   * Internal method to unregister all hotkeys without resetting state.
   */
  private unregisterAllInternal(): void {
    globalShortcut.unregisterAll()
    log.debug('All shortcuts unregistered (internal)')
  }

  /**
   * Register a single hotkey with the current mode's callback.
   * Returns true if successful.
   */
  private registerHotkey(type: HotkeyType): boolean {
    const state = this.states[type]

    if (!state.callbacks) {
      // An optional hotkey the app did not configure
      if (type === 'pasteLast' || type === 'copyText') return true
      log.error('Cannot register hotkey: no callbacks configured', new Error('No callbacks'), {
        type
      })
      return false
    }

    // Get accelerator from store if not set
    if (state.accelerator === null) {
      // Every other key's current or stored value counts, registered yet or not
      const held = HOTKEY_TYPES.filter((other) => other !== type)
        .map((other) => this.states[other].accelerator ?? storedAccelerator[other]())
        .filter((a): a is string => !!a)
      state.accelerator = repairStoredAccelerator(type, storedAccelerator[type](), held)
    }
    // A newer default that clashes with a key the user already chose is left off, not shown twice
    if (
      OPTIONAL_TYPES.includes(type) &&
      state.accelerator &&
      this.conflictWith(type, state.accelerator)
    ) {
      log.warn('New default hotkey clashes with an existing one, leaving it off', { type })
      state.accelerator = ''
      DISABLERS[type]?.()
    }
    if (state.accelerator === '') return true // turned off

    const callback =
      this.mode === 'normal' ? state.callbacks.normalCallback : state.callbacks.protectedCallback

    const success = tryRegister(state.accelerator, callback) === 'ok'

    if (success) {
      log.info('Registered hotkey', { type, accelerator: state.accelerator, mode: this.mode })
    } else {
      log.error('Failed to register hotkey', new Error('Registration failed'), {
        type,
        accelerator: state.accelerator,
        mode: this.mode
      })
    }

    return success
  }

  /**
   * Check if the manager is initialized.
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /** Hotkeys that are set but not registered: another app or the system holds the shortcut. */
  getUnavailable(): HotkeyType[] {
    if (!this.initialized) return []
    return HOTKEY_TYPES.filter((type) => {
      const { accelerator, callbacks } = this.states[type]
      return !!accelerator && !!callbacks && !isRegistered(accelerator)
    })
  }

  /**
   * Get the current accelerator for a hotkey type.
   */
  getAccelerator(type: HotkeyType): string | null {
    return this.states[type].accelerator
  }
}

/**
 * Singleton instance of HotkeyManager.
 * Use this for all hotkey operations.
 */
export const hotkeyManager = new HotkeyManagerImpl()
