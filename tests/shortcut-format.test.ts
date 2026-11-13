import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatShortcut } from '../src/shared/shortcut-format'

describe('formatShortcut', () => {
  it('macOS: symbols, then words in brackets', () => {
    assert.equal(formatShortcut('CommandOrControl+Shift+D', 'darwin'), '⌘⇧D (Cmd+Shift+D)')
    assert.equal(formatShortcut('CommandOrControl+Alt+K', 'darwin'), '⌘⌥K (Cmd+Option+K)')
    assert.equal(formatShortcut('Control+Shift+Space', 'darwin'), '⌃⇧Space (Ctrl+Shift+Space)')
    assert.equal(formatShortcut('CommandOrControl+Up', 'darwin'), '⌘↑ (Cmd+Up)')
  })

  it('macOS: Control comes before Command, as Apple writes it', () => {
    assert.equal(formatShortcut('Command+Control+V', 'darwin'), '⌃⌘V (Ctrl+Cmd+V)')
    assert.equal(formatShortcut('Control+Command+V', 'darwin'), '⌃⌘V (Ctrl+Cmd+V)')
    assert.equal(formatShortcut('CommandOrControl+Control+C', 'darwin'), '⌃⌘C (Ctrl+Cmd+C)')
    assert.equal(formatShortcut('Command+Control+V', 'win32'), 'Win+Ctrl+V')
  })

  it('numpad keys get readable names', () => {
    assert.equal(
      formatShortcut('CommandOrControl+Shift+numadd', 'darwin'),
      '⌘⇧Num + (Cmd+Shift+Num +)'
    )
    assert.equal(formatShortcut('CommandOrControl+num1', 'darwin'), '⌘Num 1 (Cmd+Num 1)')
    assert.equal(formatShortcut('CommandOrControl+num1', 'win32'), 'Ctrl+Num 1')
    assert.equal(formatShortcut('CommandOrControl+numdec', 'linux'), 'Ctrl+Num .')
    assert.doesNotMatch(formatShortcut('CommandOrControl+nummult', 'darwin'), /nummult/)
  })

  it('Windows and Linux: words only', () => {
    assert.equal(formatShortcut('CommandOrControl+Shift+D', 'win32'), 'Ctrl+Shift+D')
    assert.equal(formatShortcut('CommandOrControl+Alt+K', 'linux'), 'Ctrl+Alt+K')
  })

  it('never shows the raw accelerator words', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const shown = formatShortcut('CommandOrControl+Shift+S', platform)
      assert.doesNotMatch(shown, /CommandOrControl|CmdOrCtrl/)
    }
  })

  it('empty input gives empty text', () => {
    assert.equal(formatShortcut('', 'darwin'), '')
  })
})

/* eslint-disable @typescript-eslint/no-require-imports */
const { keyEventToAccelerator, layoutAccelerator } = require('../src/shared/key-event')

describe('keyEventToAccelerator', () => {
  const press = (over: Record<string, unknown>) => ({
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over
  })

  it('Option+Shift+C (key "Ç") records the physical key', () => {
    assert.equal(
      keyEventToAccelerator(press({ key: 'Ç', code: 'KeyC', altKey: true, shiftKey: true }), true),
      'Alt+Shift+C'
    )
    assert.equal(
      keyEventToAccelerator(press({ key: '¡', code: 'Digit1', altKey: true, metaKey: true }), true),
      'CommandOrControl+Alt+1'
    )
  })

  it('the same physical key records the same letter with and without Option', () => {
    // German: key printed Z sits at KeyY; French: key printed A sits at KeyQ
    const plain = press({ key: 'z', code: 'KeyY', metaKey: true, shiftKey: true })
    const option = press({ key: '¥', code: 'KeyY', metaKey: true, shiftKey: true, altKey: true })
    assert.equal(keyEventToAccelerator(plain, true), 'CommandOrControl+Shift+Y')
    assert.equal(keyEventToAccelerator(option, true), 'CommandOrControl+Alt+Shift+Y')
    assert.equal(
      keyEventToAccelerator(press({ key: 'a', code: 'KeyQ', metaKey: true }), true),
      'CommandOrControl+Q'
    )
  })

  it('the shortcut is shown with the letter printed on the user key', () => {
    const german = new Map([['KeyY', 'z']])
    assert.equal(layoutAccelerator('CommandOrControl+Shift+Y', german), 'CommandOrControl+Shift+Z')
    assert.equal(layoutAccelerator('CommandOrControl+Up', german), 'CommandOrControl+Up')
    assert.equal(
      layoutAccelerator('CommandOrControl+Shift+Y', new Map()),
      'CommandOrControl+Shift+Y'
    )
  })

  it('punctuation positions show the character printed on the user key', () => {
    const azerty = new Map([['Semicolon', 'm']])
    assert.equal(layoutAccelerator('CommandOrControl+Shift+;', azerty), 'CommandOrControl+Shift+M')
    const german = new Map([
      ['Semicolon', 'ö'],
      ['Quote', 'ä']
    ])
    assert.equal(layoutAccelerator('CommandOrControl+;', german), 'CommandOrControl+Ö')
    assert.equal(layoutAccelerator("CommandOrControl+'", german), 'CommandOrControl+Ä')
    assert.equal(layoutAccelerator('CommandOrControl+,', german), 'CommandOrControl+,')
    assert.equal(layoutAccelerator('CommandOrControl+Space', german), 'CommandOrControl+Space')
  })

  it('a key whose capital is longer keeps its printed character (German ß)', () => {
    assert.equal(
      layoutAccelerator('CommandOrControl+-', new Map([['Minus', 'ß']])),
      'CommandOrControl+ß'
    )
  })

  it('a combining mark or other unprintable value falls back to the US character', () => {
    for (const printed of ['\u0302', '\u0301\u0302', ' ', '\u0007', '', 'ab']) {
      assert.equal(
        layoutAccelerator('CommandOrControl+[', new Map([['BracketLeft', printed]])),
        'CommandOrControl+['
      )
    }
    assert.equal(
      layoutAccelerator('CommandOrControl+[', new Map([['BracketLeft', 'ü']])),
      'CommandOrControl+Ü'
    )
  })

  it('Numpad keys Electron cannot name are not recordable', () => {
    for (const code of ['NumpadEqual', 'NumpadComma', 'NumpadEnter', 'NumpadParenLeft']) {
      assert.equal(
        keyEventToAccelerator(press({ key: '=', code, metaKey: true }), true),
        null,
        code
      )
    }
  })

  it('Numpad keys record as Electron num names', () => {
    const k = (code: string) => press({ key: '1', code, metaKey: true })
    assert.equal(keyEventToAccelerator(k('Numpad1'), true), 'CommandOrControl+num1')
    assert.equal(keyEventToAccelerator(k('NumpadAdd'), true), 'CommandOrControl+numadd')
    assert.equal(keyEventToAccelerator(k('NumpadSubtract'), true), 'CommandOrControl+numsub')
    assert.equal(keyEventToAccelerator(k('NumpadMultiply'), true), 'CommandOrControl+nummult')
    assert.equal(keyEventToAccelerator(k('NumpadDivide'), true), 'CommandOrControl+numdiv')
    assert.equal(keyEventToAccelerator(k('NumpadDecimal'), true), 'CommandOrControl+numdec')
  })

  it('keys with no Electron name by position are not recorded', () => {
    for (const code of ['IntlBackslash', 'IntlRo', 'IntlYen']) {
      assert.equal(keyEventToAccelerator(press({ key: '<', code, metaKey: true }), true), null)
    }
  })

  it('dead keys, Option+punctuation and Space record by position', () => {
    assert.equal(
      keyEventToAccelerator(
        press({ key: 'Dead', code: 'KeyN', metaKey: true, altKey: true }),
        true
      ),
      'CommandOrControl+Alt+N'
    )
    assert.equal(
      keyEventToAccelerator(press({ key: '≤', code: 'Comma', metaKey: true, altKey: true }), true),
      'CommandOrControl+Alt+,'
    )
    assert.equal(
      keyEventToAccelerator(press({ key: '—', code: 'Minus', altKey: true, shiftKey: true }), true),
      'Alt+Shift+-'
    )
    assert.equal(
      keyEventToAccelerator(press({ key: '\u00a0', code: 'Space', altKey: true }), true),
      'Alt+Space'
    )
    assert.equal(
      keyEventToAccelerator(press({ key: ' ', code: 'Space', metaKey: true }), true),
      'CommandOrControl+Space'
    )
  })

  it('a character with no physical key to map is not recorded', () => {
    assert.equal(keyEventToAccelerator(press({ key: 'Dead', code: '', metaKey: true }), true), null)
  })

  it('a non-Latin layout records the physical key too', () => {
    assert.equal(
      keyEventToAccelerator(press({ key: 'с', code: 'KeyC', metaKey: true, shiftKey: true }), true),
      'CommandOrControl+Shift+C'
    )
  })

  it('an ordinary letter and the key name are unchanged', () => {
    assert.equal(
      keyEventToAccelerator(press({ key: 's', code: 'KeyS', metaKey: true, shiftKey: true }), true),
      'CommandOrControl+Shift+S'
    )
    assert.equal(
      keyEventToAccelerator(press({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true }), false),
      'CommandOrControl+Up'
    )
    assert.equal(keyEventToAccelerator(press({ key: 'a', code: 'KeyA' }), true), null)
    assert.equal(keyEventToAccelerator(press({ key: 'Shift', shiftKey: true }), true), null)
  })
})

describe('keyboard layout refresh', () => {
  const {
    readLayout,
    watchLayout
  } = require('../src/renderer/src/settings/components/layout-refresh')

  function target() {
    const listeners = new Set<() => void>()
    return {
      addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
      focus: () => listeners.forEach((fn) => fn()),
      count: () => listeners.size
    }
  }
  const source = (calls: { n: number }, map: Map<string, string>) => ({
    getLayoutMap: async () => (calls.n++, map)
  })
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  it('reads the layout at once and again on every window focus', async () => {
    const calls = { n: 0 }
    const win = target()
    const got: Array<Map<string, string>> = []
    watchLayout(source(calls, new Map([['KeyY', 'z']])), win, (m: Map<string, string>) =>
      got.push(m)
    )
    await flush()
    assert.equal(calls.n, 1)
    win.focus()
    await flush()
    assert.equal(calls.n, 2)
    assert.equal(got[1].get('KeyY'), 'z')
  })

  it('stops listening to focus when cleaned up', async () => {
    const calls = { n: 0 }
    const win = target()
    const stop = watchLayout(source(calls, new Map()), win, () => {})
    assert.equal(win.count(), 1)
    stop()
    assert.equal(win.count(), 0)
    win.focus()
    await flush()
    assert.equal(calls.n, 1)
  })

  it('a browser without getLayoutMap, or one that rejects, changes nothing', async () => {
    const got: unknown[] = []
    readLayout(undefined, (m: unknown) => got.push(m))
    readLayout({}, (m: unknown) => got.push(m))
    readLayout({ getLayoutMap: async () => Promise.reject(new Error('denied')) }, (m: unknown) =>
      got.push(m)
    )
    await flush()
    assert.deepEqual(got, [])
  })
})

describe('ShortcutInput layout refresh', () => {
  // Source check: the component is not rendered in tests
  const source = readFileSync('src/renderer/src/settings/components/ShortcutInput.tsx', 'utf8')

  it('uses the refresh helper on mount and when recording starts', () => {
    assert.match(source, /watchLayout\(keyboard, window, setLayout\)/)
    assert.match(source, /if \(isRecording\) readLayout\(keyboard, setLayout\)/)
  })
})
