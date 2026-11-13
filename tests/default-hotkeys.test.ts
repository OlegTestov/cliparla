/** Fresh installs get Ctrl+Option+S / V on a Mac; shortcuts an install already stored are left alone. */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resetRecorded, shortcuts } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  defaultCaptureShortcut,
  defaultDictationShortcut
} = require('../src/shared/default-shortcuts')
const {
  acceleratorToKeyTarget,
  MOD_CONTROL,
  MOD_OPTION
} = require('../src/shared/accelerator-keycode')
const { isTooPlainShortcut } = require('../src/shared/key-event')
const { hotkeyManager } = require('../src/main/core/hotkey-manager')
const store = require('../src/main/services/store')

describe('default hotkeys', () => {
  it('macOS: Ctrl+Option+S for the screen, Ctrl+Option+V for the voice', () => {
    assert.equal(defaultCaptureShortcut('darwin'), 'Control+Alt+S')
    assert.equal(defaultDictationShortcut('darwin'), 'Control+Alt+V')
  })

  it('other systems keep Ctrl+Shift+S / D', () => {
    assert.equal(defaultCaptureShortcut('win32'), 'CommandOrControl+Shift+S')
    assert.equal(defaultDictationShortcut('linux'), 'CommandOrControl+Shift+D')
  })

  it('the store uses them on this system', () => {
    assert.equal(store.defaultShortcut('capture'), defaultCaptureShortcut(process.platform))
    assert.equal(store.defaultShortcut('dictation'), defaultDictationShortcut(process.platform))
  })

  it('the macOS defaults are accepted as shortcuts and the key helper can hold-to-talk on them', () => {
    for (const accelerator of ['Control+Alt+S', 'Control+Alt+V']) {
      assert.equal(isTooPlainShortcut(accelerator), false)
    }
    assert.deepEqual(acceleratorToKeyTarget('Control+Alt+V'), {
      keyCode: 9,
      modifiers: MOD_CONTROL | MOD_OPTION
    })
    assert.deepEqual(acceleratorToKeyTarget('Control+Alt+S'), {
      keyCode: 1,
      modifiers: MOD_CONTROL | MOD_OPTION
    })
  })

  it('an install that stored the old defaults keeps them', () => {
    resetRecorded()
    hotkeyManager.unregisterAll()
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    store.setDictationShortcut('CommandOrControl+Shift+D')
    const noop = { normalCallback: () => {}, protectedCallback: () => {} }
    hotkeyManager.initialize({ capture: noop, dictation: noop })
    hotkeyManager.setMode('normal')
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Shift+S')
    assert.equal(store.getDictationShortcut(), 'CommandOrControl+Shift+D')
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+S'))
    assert.ok(shortcuts.registered.has('CommandOrControl+Shift+D'))
  })
})
