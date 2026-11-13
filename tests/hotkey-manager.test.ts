/**
 * The real hotkey manager (src/main/core/hotkey-manager.ts) against a fake `globalShortcut` that behaves like
 * Electron 45: an accelerator it cannot parse (`Alt+Shift+Ç`) throws.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetRecorded, shortcuts } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { hotkeyManager, sameAccelerator } = require('../src/main/core/hotkey-manager')
const store = require('../src/main/services/store')

const calls: string[] = []
function start(mode: 'normal' | 'protected' = 'normal'): void {
  calls.length = 0
  hotkeyManager.unregisterAll()
  store.setCaptureShortcut('CommandOrControl+Shift+S')
  store.setDictationShortcut('CommandOrControl+Shift+D')
  hotkeyManager.initialize({
    capture: { normalCallback: () => calls.push('capture'), protectedCallback: () => {} },
    dictation: { normalCallback: () => calls.push('dictation'), protectedCallback: () => {} }
  })
  hotkeyManager.setMode(mode)
}

describe('updateAccelerator with Electron refusals', () => {
  beforeEach(() => {
    resetRecorded()
    start()
  })

  it('a shortcut Electron cannot parse is refused and the old one keeps working', () => {
    const result = hotkeyManager.updateAccelerator('capture', 'Alt+Shift+Ç')
    assert.equal(result, 'invalid')
    assert.equal(hotkeyManager.getAccelerator('capture'), 'CommandOrControl+Shift+S')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    assert.deepEqual(calls, ['capture'])
    assert.equal(shortcuts.registered.has('Alt+Shift+Ç'), false)
  })

  it('a shortcut held by another app is refused and the old one keeps working', () => {
    shortcuts.taken.add('CommandOrControl+Alt+K')
    assert.equal(
      hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Alt+K'),
      'unavailable'
    )
    assert.equal(hotkeyManager.getAccelerator('capture'), 'CommandOrControl+Shift+S')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+S'))
  })

  it('a good shortcut replaces the old one', () => {
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Alt+K'), 'ok')
    assert.equal(hotkeyManager.getAccelerator('capture'), 'CommandOrControl+Alt+K')
    assert.equal(shortcuts.registered.has('CommandOrControl+Shift+S'), false)
    shortcuts.registered.get('CommandOrControl+Alt+K')!()
    assert.deepEqual(calls, ['capture'])
  })

  it('the other hotkey stays registered through a refusal', () => {
    hotkeyManager.updateAccelerator('capture', 'Alt+Shift+Ç')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+D'))
  })

  it('the dictation shortcut is refused the same way', () => {
    assert.equal(hotkeyManager.updateAccelerator('dictation', 'Alt+Shift+Ç'), 'invalid')
    assert.equal(hotkeyManager.getAccelerator('dictation'), 'CommandOrControl+Shift+D')
  })

  it('the other hotkey is a conflict', () => {
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Shift+D'), 'conflict')
  })

  it('recording the same shortcut again registers it when startup failed', () => {
    start()
    hotkeyManager.unregisterAll()
    shortcuts.taken.add('CommandOrControl+Shift+S')
    hotkeyManager.initialize({
      capture: { normalCallback: () => calls.push('capture'), protectedCallback: () => {} },
      dictation: { normalCallback: () => {}, protectedCallback: () => {} }
    })
    hotkeyManager.setMode('normal')
    assert.equal(shortcuts.registered.has('CommandOrControl+Shift+S'), false)

    shortcuts.taken.clear()
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Shift+S'), 'ok')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+S'))
  })

  it('re-recording a differently spelled copy of a dead shortcut leaves it registered', () => {
    hotkeyManager.unregisterAll()
    store.setCaptureShortcut('CmdOrCtrl+Shift+S')
    shortcuts.taken.add('CmdOrCtrl+Shift+S')
    hotkeyManager.initialize({
      capture: { normalCallback: () => calls.push('capture'), protectedCallback: () => {} },
      dictation: { normalCallback: () => {}, protectedCallback: () => {} }
    })
    hotkeyManager.setMode('normal')
    assert.equal(shortcuts.registered.size, 1) // only dictation

    shortcuts.taken.clear()
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Shift+S'), 'ok')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+S'))
  })

  it('recording the shortcut that is already active changes nothing', () => {
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Shift+S'), 'ok')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+S'))
  })
})

describe('modes', () => {
  beforeEach(() => {
    resetRecorded()
    calls.length = 0
  })

  it('protected mode runs the protected callbacks, normal mode the normal ones', () => {
    let protectedCalls = 0
    hotkeyManager.unregisterAll()
    hotkeyManager.initialize({
      capture: {
        normalCallback: () => calls.push('capture'),
        protectedCallback: () => protectedCalls++
      },
      dictation: { normalCallback: () => calls.push('dictation'), protectedCallback: () => {} }
    })
    hotkeyManager.setMode('protected')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    assert.equal(protectedCalls, 1)
    hotkeyManager.setMode('normal')
    assert.equal(hotkeyManager.getMode(), 'normal')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    shortcuts.registered.get('CommandOrControl+Shift+D')!()
    assert.deepEqual(calls, ['capture', 'dictation'])
  })

  it('a shortcut held by another app does not change the mode or the other hotkey', () => {
    start('protected')
    shortcuts.taken.add('CommandOrControl+Shift+D')
    hotkeyManager.setMode('normal')
    assert.equal(hotkeyManager.getMode(), 'normal')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    assert.deepEqual(calls, ['capture'])
    shortcuts.taken.clear()
  })

  it('a startup failure, then re-recording, runs the normal callback (a key is saved)', () => {
    // Fresh manager, as at app start: capture shortcut held by another app
    hotkeyManager.unregisterAll()
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    store.setDictationShortcut('CommandOrControl+Shift+D')
    shortcuts.taken.add('CommandOrControl+Shift+S')
    hotkeyManager.initialize({
      capture: {
        normalCallback: () => calls.push('capture'),
        protectedCallback: () => calls.push('PROTECTED')
      },
      dictation: { normalCallback: () => calls.push('dictation'), protectedCallback: () => {} }
    })
    hotkeyManager.setMode('normal')
    assert.equal(hotkeyManager.getMode(), 'normal')

    shortcuts.taken.clear()
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Shift+S'), 'ok')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    assert.deepEqual(calls, ['capture'])
  })

  it('the same shortcut spelled differently is kept, not reported as taken', () => {
    start()
    assert.equal(hotkeyManager.updateAccelerator('capture', 'Shift+CmdOrCtrl+S'), 'ok')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+S'))
    assert.equal(sameAccelerator('Shift+CmdOrCtrl+S', 'CommandOrControl+Shift+S'), true)
    assert.equal(sameAccelerator('CommandOrControl+Shift+S', 'CommandOrControl+Shift+D'), false)
  })

  it('does nothing before initialize() and after unregisterAll()', () => {
    hotkeyManager.unregisterAll()
    assert.equal(hotkeyManager.isInitialized(), false)
    assert.equal(
      hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Alt+K'),
      'unavailable'
    )
    start()
    assert.equal(hotkeyManager.isInitialized(), true)
    hotkeyManager.unregisterAll()
    assert.equal(hotkeyManager.getAccelerator('capture'), null)
    assert.equal(shortcuts.registered.size, 0)
  })
})

describe('the paste-last hotkey', () => {
  const start3 = (): void => {
    resetRecorded()
    start()
    hotkeyManager.unregisterAll()
    store.setPasteLastShortcut('Command+Control+V')
    hotkeyManager.initialize({
      capture: { normalCallback: () => calls.push('capture'), protectedCallback: () => {} },
      dictation: { normalCallback: () => calls.push('dictation'), protectedCallback: () => {} },
      pasteLast: { normalCallback: () => calls.push('pasteLast'), protectedCallback: () => {} }
    })
    hotkeyManager.setMode('normal')
  }

  it('registers with its default and runs its callback', () => {
    start3()
    shortcuts.registered.get('Command+Control+V')!()
    assert.deepEqual(calls, ['pasteLast'])
  })

  it('does not collide with the other hotkeys by default', () => {
    start3()
    for (const type of ['capture', 'dictation'] as const) {
      assert.equal(
        sameAccelerator(
          hotkeyManager.getAccelerator(type),
          hotkeyManager.getAccelerator('pasteLast')
        ),
        false
      )
    }
  })

  it('C5/L: a key already used by another hotkey is refused, both ways', () => {
    start3()
    assert.equal(
      hotkeyManager.updateAccelerator('pasteLast', 'CommandOrControl+Shift+S'),
      'conflict'
    )
    assert.equal(hotkeyManager.conflictWith('pasteLast', 'CommandOrControl+Shift+S'), 'capture')
    assert.equal(hotkeyManager.updateAccelerator('capture', 'cmd+ctrl+v'), 'conflict')
    assert.equal(hotkeyManager.getAccelerator('pasteLast'), 'Command+Control+V')
  })

  it('can be turned off and back on; an off hotkey blocks nobody', () => {
    start3()
    assert.equal(hotkeyManager.updateAccelerator('pasteLast', ''), 'ok')
    assert.equal(shortcuts.registered.has('Command+Control+V'), false)
    assert.equal(hotkeyManager.updateAccelerator('capture', 'Command+Control+V'), 'ok')
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Shift+S'), 'ok')
    assert.equal(hotkeyManager.updateAccelerator('pasteLast', 'Command+Control+V'), 'ok')
    shortcuts.registered.get('Command+Control+V')!()
    assert.deepEqual(calls, ['pasteLast'])
  })

  it('stays off after the mode changes', () => {
    start3()
    hotkeyManager.updateAccelerator('pasteLast', '')
    hotkeyManager.setMode('protected')
    hotkeyManager.setMode('normal')
    assert.equal(shortcuts.registered.has('Command+Control+V'), false)
    assert.equal(hotkeyManager.getAccelerator('pasteLast'), '')
  })
})

describe('plain shortcuts already saved in the config', () => {
  const noop = { normalCallback: () => {}, protectedCallback: () => {} }
  const startWith = (
    stored: Partial<Record<'paste' | 'copy' | 'capture' | 'dictation', string>>
  ) => {
    resetRecorded()
    hotkeyManager.unregisterAll()
    store.setCaptureShortcut(stored.capture ?? 'CommandOrControl+Shift+S')
    store.setDictationShortcut(stored.dictation ?? 'CommandOrControl+Shift+D')
    store.setPasteLastShortcut(stored.paste ?? 'Command+Control+V')
    store.setCopyTextShortcut(stored.copy ?? 'Command+Control+C')
    hotkeyManager.initialize({ capture: noop, dictation: noop, pasteLast: noop, copyText: noop })
    hotkeyManager.setMode('normal')
  }

  it('Cmd+V and Cmd+C saved for paste-last and copy-text are never registered', () => {
    startWith({ paste: 'CommandOrControl+V', copy: 'CommandOrControl+C' })
    for (const plain of ['CommandOrControl+V', 'CommandOrControl+C']) {
      assert.equal(shortcuts.registered.has(plain), false, plain)
    }
    assert.equal(store.getPasteLastShortcut(), store.defaultShortcut('pasteLast'))
    assert.equal(store.getCopyTextShortcut(), store.defaultShortcut('copyText'))
    assert.ok(shortcuts.registered.has(store.defaultShortcut('pasteLast')))
  })

  it('when the default is taken by another hotkey, the optional one is turned off', () => {
    startWith({
      paste: 'Shift+V',
      capture: store.defaultShortcut('pasteLast')
    })
    assert.equal(shortcuts.registered.has('Shift+V'), false)
    assert.equal(hotkeyManager.getAccelerator('pasteLast'), '')
    assert.equal(store.getPasteLastShortcut(), '')
  })

  it('capture and dictation go back to their defaults and the config is fixed', () => {
    startWith({ capture: 'CommandOrControl+C', dictation: 'Alt+L' })
    assert.equal(shortcuts.registered.has('CommandOrControl+C'), false)
    assert.equal(shortcuts.registered.has('Alt+L'), false)
    assert.equal(store.getCaptureShortcut(), store.defaultShortcut('capture'))
    assert.equal(store.getDictationShortcut(), store.defaultShortcut('dictation'))
    assert.ok(shortcuts.registered.has(store.defaultShortcut('capture')))
  })

  it('the old non-Mac AltGr defaults are replaced at startup', () => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      startWith({ paste: 'Control+Alt+V', copy: 'control+alt+c' })
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
    assert.equal(shortcuts.registered.has('Control+Alt+V'), false)
    assert.equal(shortcuts.registered.has('control+alt+c'), false)
    assert.equal(store.getPasteLastShortcut(), store.defaultShortcut('pasteLast'))
  })

  it('a repaired key never takes a value another key holds: paste-last off, copy-text kept', () => {
    startWith({ paste: 'Command+V', copy: 'Command+Control+V' })
    assert.equal(store.getPasteLastShortcut(), '')
    assert.equal(store.getCopyTextShortcut(), 'Command+Control+V')
    assert.ok(shortcuts.registered.has('Command+Control+V'))
    assert.equal(shortcuts.registered.has('Command+V'), false)
  })

  it('a repaired required key whose default the other required key holds gets a free fallback', () => {
    const held = store.defaultShortcut('capture')
    startWith({ capture: 'Command+S', dictation: held })
    const capture = store.getCaptureShortcut()
    assert.equal(sameAccelerator(capture, 'CommandOrControl+Shift+Alt+S'), true)
    assert.equal(store.getDictationShortcut(), held)
    assert.ok(shortcuts.registered.has(capture))
    assert.ok(shortcuts.registered.has(held))
  })

  it('when every fallback is held by other keys, the required keys still differ', () => {
    // dictation: default, Alt+D and Alt+J are all held; the others hold three of them
    startWith({
      capture: 'CommandOrControl+Shift+Alt+J',
      dictation: 'Command+D',
      paste: 'CommandOrControl+Shift+Alt+D',
      copy: 'CommandOrControl+Shift+D'
    })
    const dictation = store.getDictationShortcut()
    for (const other of [
      store.getCaptureShortcut(),
      store.getPasteLastShortcut(),
      store.getCopyTextShortcut()
    ]) {
      assert.equal(sameAccelerator(dictation, other), false, `${dictation} equals ${other}`)
    }
    assert.ok(shortcuts.registered.has(dictation))
  })

  it('a bare stored key is repaired like any plain shortcut', () => {
    startWith({ paste: 'V', copy: 'Escape' })
    assert.equal(shortcuts.registered.has('V'), false)
    assert.equal(shortcuts.registered.has('Escape'), false)
    assert.equal(store.getPasteLastShortcut(), store.defaultShortcut('pasteLast'))
  })

  it('an empty stored capture or dictation key gets its default back; empty optional stays off', () => {
    startWith({ capture: '', dictation: '', paste: '' })
    assert.equal(store.getCaptureShortcut(), store.defaultShortcut('capture'))
    assert.equal(store.getDictationShortcut(), store.defaultShortcut('dictation'))
    assert.ok(shortcuts.registered.has(store.defaultShortcut('capture')))
    assert.ok(shortcuts.registered.has(store.defaultShortcut('dictation')))
    assert.equal(store.getPasteLastShortcut(), '')
  })

  it('a good stored shortcut is left alone', () => {
    startWith({ paste: 'Command+Control+K' })
    assert.equal(store.getPasteLastShortcut(), 'Command+Control+K')
    assert.ok(shortcuts.registered.has('Command+Control+K'))
  })
})

describe('hotkeys refused at start-up', () => {
  beforeEach(() => {
    resetRecorded()
  })

  it('lists a hotkey another app holds, so Settings can say so', () => {
    shortcuts.taken.add('CommandOrControl+Shift+S')
    start()
    assert.deepEqual(hotkeyManager.getUnavailable(), ['capture'])
  })

  it('lists nothing when every hotkey registered, and forgets a refusal once it is fixed', () => {
    shortcuts.taken.add('CommandOrControl+Shift+S')
    start()
    assert.equal(hotkeyManager.updateAccelerator('capture', 'CommandOrControl+Alt+K'), 'ok')
    assert.deepEqual(hotkeyManager.getUnavailable(), [])
  })

  it('a hotkey that is turned off is not reported', () => {
    start()
    hotkeyManager.updateAccelerator('capture', '')
    assert.deepEqual(hotkeyManager.getUnavailable(), [])
  })
})
