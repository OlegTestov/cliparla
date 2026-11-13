/**
 * One way to show a keyboard shortcut everywhere: never the raw Electron
 * accelerator ("CommandOrControl+Shift+D").
 * macOS: symbols, then words, e.g. "⌘⇧D (Cmd+Shift+D)". Elsewhere: "Ctrl+Shift+D".
 */

const MAC_MODIFIERS: Record<string, { symbol: string; word: string }> = {
  commandorcontrol: { symbol: '⌘', word: 'Cmd' },
  cmdorctrl: { symbol: '⌘', word: 'Cmd' },
  command: { symbol: '⌘', word: 'Cmd' },
  cmd: { symbol: '⌘', word: 'Cmd' },
  super: { symbol: '⌘', word: 'Cmd' },
  meta: { symbol: '⌘', word: 'Cmd' },
  control: { symbol: '⌃', word: 'Ctrl' },
  ctrl: { symbol: '⌃', word: 'Ctrl' },
  alt: { symbol: '⌥', word: 'Option' },
  option: { symbol: '⌥', word: 'Option' },
  altgr: { symbol: '⌥', word: 'Option' },
  shift: { symbol: '⇧', word: 'Shift' }
}

const OTHER_MODIFIERS: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  command: 'Win',
  cmd: 'Win',
  super: 'Win',
  meta: 'Win',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift'
}

const MAC_KEY_SYMBOLS: Record<string, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  space: 'Space',
  return: '↩',
  enter: '↩',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  escape: 'Esc',
  esc: 'Esc'
}

const NUMPAD_NAMES: Record<string, string> = {
  numadd: 'Num +',
  numsub: 'Num -',
  nummult: 'Num *',
  numdiv: 'Num /',
  numdec: 'Num .'
}

/** Key name for the field: "num3" -> "Num 3"; other keys unchanged. */
function keyName(part: string): string {
  const lower = part.toLowerCase()
  const digit = /^num([0-9])$/.exec(lower)
  return digit ? `Num ${digit[1]}` : (NUMPAD_NAMES[lower] ?? part)
}

/** Apple lists Control before Command (⌃⌘V); the rest keep their order. */
function controlFirst(parts: string[]): string[] {
  const rank = (part: string): number => (MAC_MODIFIERS[part.toLowerCase()]?.symbol === '⌃' ? 0 : 1)
  const modifiers = parts.slice(0, -1).sort((a, b) => rank(a) - rank(b))
  return [...modifiers, parts[parts.length - 1]]
}

export function formatShortcut(accelerator: string, platform: string): string {
  const raw = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (raw.length === 0) return ''
  const parts = platform === 'darwin' ? controlFirst(raw) : raw
  if (platform === 'darwin') {
    const symbols = parts
      .map(
        (p) =>
          MAC_MODIFIERS[p.toLowerCase()]?.symbol ?? MAC_KEY_SYMBOLS[p.toLowerCase()] ?? keyName(p)
      )
      .join('')
    const words = parts.map((p) => MAC_MODIFIERS[p.toLowerCase()]?.word ?? keyName(p)).join('+')
    return `${symbols} (${words})`
  }
  return parts.map((p) => OTHER_MODIFIERS[p.toLowerCase()] ?? keyName(p)).join('+')
}
