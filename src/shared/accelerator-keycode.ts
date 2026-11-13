/**
 * The macOS virtual key code and modifier bits of an Electron accelerator, for the key helper.
 * Null when the key has no code here: hold-to-talk is then off and the hotkey stays a toggle.
 */

export const MOD_COMMAND = 1
export const MOD_CONTROL = 2
export const MOD_OPTION = 4
export const MOD_SHIFT = 8

// ANSI positions, the same positional keys Electron registers
const KEY_CODES: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  '=': 24,
  '9': 25,
  '7': 26,
  '-': 27,
  '8': 28,
  '0': 29,
  ']': 30,
  o: 31,
  u: 32,
  '[': 33,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ';': 41,
  '\\': 42,
  ',': 43,
  '/': 44,
  n: 45,
  m: 46,
  '.': 47,
  '`': 50,
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  escape: 53,
  esc: 53,
  delete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  f13: 105,
  f14: 107,
  f15: 113,
  f16: 106,
  f17: 64,
  f18: 79,
  f19: 80,
  f20: 90,
  num0: 82,
  num1: 83,
  num2: 84,
  num3: 85,
  num4: 86,
  num5: 87,
  num6: 88,
  num7: 89,
  num8: 91,
  num9: 92,
  numdec: 65,
  nummult: 67,
  numadd: 69,
  numdiv: 75,
  numsub: 78
}

const MODIFIERS: Record<string, number> = {
  commandorcontrol: MOD_COMMAND, // macOS only: the helper runs nowhere else
  cmdorctrl: MOD_COMMAND,
  command: MOD_COMMAND,
  cmd: MOD_COMMAND,
  super: MOD_COMMAND,
  meta: MOD_COMMAND,
  control: MOD_CONTROL,
  ctrl: MOD_CONTROL,
  alt: MOD_OPTION,
  option: MOD_OPTION,
  shift: MOD_SHIFT
}

export interface KeyTarget {
  keyCode: number
  modifiers: number
}

export function acceleratorToKeyTarget(accelerator: string): KeyTarget | null {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase())
  // "Ctrl++" style: an empty part before the last one is a literal plus
  const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1]
  const modifierParts = key === '+' ? parts.slice(0, -2) : parts.slice(0, -1)
  let modifiers = 0
  for (const part of modifierParts) {
    const bit = MODIFIERS[part]
    if (bit === undefined) return null // AltGr and anything unknown
    modifiers |= bit
  }
  const keyCode = KEY_CODES[key]
  return keyCode === undefined ? null : { keyCode, modifiers }
}
