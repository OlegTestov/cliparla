/**
 * Turn a recorded key press into an Electron accelerator.
 */

export interface KeyEventLike {
  key: string
  /** Physical key, independent of layout and modifiers: "KeyC", "Digit4" */
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * The letter or digit of the physical key, by its US position. Electron
 * registers letters and digits by position, and `key` changes with the layout
 * and with Option (Option+Shift+C -> "Ç"), so `code` is the one stable source.
 */
const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Backslash: '\\'
}

const NUMPAD_KEYS: Record<string, string> = {
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

// Positions Electron has no name for: the typed character would fire another key
const UNREGISTRABLE_CODES = ['IntlBackslash', 'IntlRo', 'IntlYen']

const CHAR_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_KEYS)
    .filter(([code]) => code !== 'Space')
    .map(([code, char]) => [char, code])
)

function physicalKey(e: KeyEventLike): string | null {
  const numpad = /^Numpad([0-9])$/.exec(e.code ?? '')
  if (numpad) return `num${numpad[1]}`
  if (NUMPAD_KEYS[e.code ?? '']) return NUMPAD_KEYS[e.code ?? '']
  const letter = /^Key([A-Z])$/.exec(e.code ?? '')
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(e.code ?? '')
  if (digit) return digit[1]
  return CODE_KEYS[e.code ?? ''] ?? null
}

export function keyEventToAccelerator(e: KeyEventLike, isMac: boolean): string | null {
  const parts: string[] = []

  // Mac: Command (metaKey), Control (ctrlKey), Option (altKey), Shift; elsewhere Ctrl, Alt, Shift.
  // Command together with Control is spelled out (CommandOrControl would swallow the Control).
  if (isMac && e.metaKey && e.ctrlKey) parts.push('Command', 'Control')
  else if (isMac ? e.metaKey : e.ctrlKey) parts.push('CommandOrControl')
  else if (isMac && e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  if (UNREGISTRABLE_CODES.includes(e.code ?? '')) return null
  // NumpadEqual, NumpadComma, NumpadEnter...: Electron has no name, the typed key would fire elsewhere
  if (/^Numpad/.test(e.code ?? '') && !physicalKey(e)) return null
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null

  let mainKey = key
  const physical = physicalKey(e)
  if (physical) {
    mainKey = physical
  } else if (key.length === 1 && /^[\x21-\x7e]$/.test(key)) {
    mainKey = key.toUpperCase()
  } else if (key === 'Dead' || key.length === 1) {
    // No physical key to fall back on, and Electron cannot register this character
    return null
  } else if (key === 'ArrowUp') {
    mainKey = 'Up'
  } else if (key === 'ArrowDown') {
    mainKey = 'Down'
  } else if (key === 'ArrowLeft') {
    mainKey = 'Left'
  } else if (key === 'ArrowRight') {
    mainKey = 'Right'
  }

  parts.push(mainKey)

  // Needs at least one modifier
  return parts.length < 2 ? null : parts.join('+')
}

/** One visible character: not a lone combining mark (dead keys), space or control character. */
function isPrintableGrapheme(text: string): boolean {
  if (/^[\p{M}\p{C}\p{Z}]/u.test(text)) return false
  return [...new Intl.Segmenter().segment(text)].length === 1
}

/**
 * Show the recorded shortcut with the letter printed on the user's key.
 * `layout` maps a physical code to its character (navigator.keyboard.getLayoutMap()).
 */
export function layoutAccelerator(accelerator: string, layout: Map<string, string>): string {
  const parts = accelerator.split('+')
  const main = parts[parts.length - 1]
  const code = /^[A-Z]$/.test(main)
    ? `Key${main}`
    : /^[0-9]$/.test(main)
      ? `Digit${main}`
      : (CHAR_CODES[main] ?? null)
  const printed = code ? layout.get(code) : undefined
  if (!printed || !isPrintableGrapheme(printed)) return accelerator
  const upper = printed.toUpperCase()
  // "ß".toUpperCase() is "SS": keep the printed key when uppercasing would widen it
  parts[parts.length - 1] = isPrintableGrapheme(upper) ? upper : printed
  return parts.join('+')
}

const MODIFIER_KINDS: Record<string, 'cmd' | 'ctrl' | 'alt' | 'shift'> = {
  commandorcontrol: 'cmd',
  cmdorctrl: 'cmd',
  command: 'cmd',
  cmd: 'cmd',
  super: 'cmd',
  meta: 'cmd',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  altgr: 'alt',
  shift: 'shift'
}

/**
 * A global hotkey that would take over typing or a standard shortcut everywhere is refused:
 * Command/Control or Shift alone (Cmd+V, Ctrl+Z, Shift+A), Option alone or with Shift plus a
 * character (they type one: Option+L = @ on a German layout), Cmd+F5 (VoiceOver).
 * A bare key with no modifier is refused. Function keys are otherwise fine.
 */
export function isTooPlainShortcut(accelerator: string): boolean {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase())
  const key = parts[parts.length - 1]
  const kinds = new Set(parts.slice(0, -1).map((part) => MODIFIER_KINDS[part] ?? part))
  if (/^f([1-9]|1\d|2[0-4])$/.test(key)) return key === 'f5' && kinds.size === 1 && kinds.has('cmd')
  if (kinds.size === 0) return true // a bare key types or navigates everywhere
  if (kinds.size === 1 && !kinds.has('alt')) return true
  const typesCharacters = [...kinds].every((kind) => kind === 'alt' || kind === 'shift')
  return kinds.has('alt') && typesCharacters && key.length === 1
}
