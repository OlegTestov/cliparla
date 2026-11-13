/**
 * A refused shortcut is not saved and comes back with a readable reason
 * (human shortcut text, interface language) instead of a blocking dialog.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { dialogs, ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { registerSettingsHandlers, shortcutMessage } = require('../src/main/ipc/settings')
const store = require('../src/main/services/store')

/** The text without the invisible isolate marks around the shortcut. */
const visible = (text: string): string => text.replace(/[\u2066\u2069]/g, '')

describe('set-shortcut', () => {
  beforeEach(() => {
    resetRecorded()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    store.saveSettings({ uiLanguage: 'en' })
    store.setCaptureShortcut('CommandOrControl+Shift+S')
  })

  it('a conflict keeps the old shortcut and explains it in human form', async () => {
    registerSettingsHandlers({ updateAccelerator: () => 'conflict' })
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'capture',
      'CommandOrControl+Shift+D'
    )
    assert.equal(reply.ok, false)
    assert.match(visible(reply.error), /^⌘⇧D \(Cmd\+Shift\+D\) is already used for voice dictation/)
    assert.doesNotMatch(reply.error, /CommandOrControl/)
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Shift+S')
    assert.equal(dialogs.length, 0)
  })

  it('a shortcut taken by another app is explained too', async () => {
    registerSettingsHandlers({ updateAccelerator: () => 'unavailable' })
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'dictation',
      'CommandOrControl+Alt+Space'
    )
    assert.equal(reply.ok, false)
    assert.match(visible(reply.error), /^⌘⌥Space \(Cmd\+Option\+Space\) is taken/)
  })

  it('an accepted shortcut is saved', async () => {
    registerSettingsHandlers({ updateAccelerator: () => 'ok' })
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'capture',
      'CommandOrControl+Alt+K'
    )
    assert.deepEqual(reply, { ok: true })
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Alt+K')
  })

  it('bad input is refused without touching the hotkeys', async () => {
    let called = 0
    registerSettingsHandlers({ updateAccelerator: () => (called++, 'ok') })
    const reply = await ipc.handlers.get('set-shortcut')!(trustedEvent, 'other', 'X')
    assert.equal(reply.ok, false)
    assert.equal(called, 0)
  })

  it('the message follows the interface language', () => {
    const text = shortcutMessage('conflict', 'dictation', 'CommandOrControl+Shift+S', 'ru', 'win32')
    assert.match(visible(text), /^Ctrl\+Shift\+S уже используется для перевода экрана/)
  })
})

describe('set-shortcut with an unparseable shortcut', () => {
  it('explains that the shortcut cannot be used and saves nothing', async () => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    registerSettingsHandlers({ updateAccelerator: () => 'invalid' })
    const reply = await ipc.handlers.get('set-shortcut')!(trustedEvent, 'capture', 'Control+Alt+Ç')
    assert.equal(reply.ok, false)
    assert.match(visible(reply.error), /^⌃⌥Ç \(Ctrl\+Option\+Ç\) cannot be used as a shortcut/)
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Shift+S')
  })
})

describe('shortcut text in right-to-left languages', () => {
  it('the shortcut is isolated as left-to-right and no mark precedes the sentence', () => {
    for (const update of ['conflict', 'unavailable', 'invalid'] as const) {
      const text = shortcutMessage(update, 'capture', 'CommandOrControl+Shift+D', 'ar', 'darwin')
      assert.ok(text.includes('⁦⌘⇧D (Cmd+Shift+D)⁩'), update)
      assert.equal(text.startsWith('‏'), false, update)
    }
  })
})

describe('set-shortcut when the store cannot save', () => {
  it('puts the old shortcut back and says the save failed', async () => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    const calls: string[] = []
    registerSettingsHandlers({
      updateAccelerator: (_type: string, accelerator: string) => (calls.push(accelerator), 'ok'),
      saveShortcut: () => {
        throw new Error('disk full')
      }
    })
    {
      const reply = await ipc.handlers.get('set-shortcut')!(
        trustedEvent,
        'capture',
        'CommandOrControl+Alt+K'
      )
      assert.equal(reply.ok, false)
      assert.match(visible(reply.error), /^Could not save .*Alt\+K|^Could not save ⌘⌥K/)
      assert.ok(reply.error.includes('⁦'))
    }
    assert.deepEqual(calls, ['CommandOrControl+Alt+K', 'CommandOrControl+Shift+S'])
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Shift+S')
  })
})

describe('set-shortcut when the store fails and the old shortcut cannot come back', () => {
  it('does not claim the previous shortcut stays active', async () => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    let attempts = 0
    registerSettingsHandlers({
      // The new shortcut registers; putting the old one back is refused
      updateAccelerator: () => (attempts++ === 0 ? 'ok' : 'unavailable'),
      saveShortcut: () => {
        throw new Error('disk full')
      }
    })
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'capture',
      'CommandOrControl+Alt+K'
    )
    assert.equal(reply.ok, false)
    assert.doesNotMatch(reply.error, /previous shortcut stays active/)
    assert.match(reply.error, /could not be restored/)
    assert.match(reply.error, /hotkey is off/)
  })
})

describe('set-shortcut when the store fails and there was no previous shortcut', () => {
  it('does not talk about a previous shortcut at all', async () => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    store.setCaptureShortcut('')
    registerSettingsHandlers({
      updateAccelerator: () => 'ok',
      saveShortcut: () => {
        throw new Error('disk full')
      }
    })
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'capture',
      'CommandOrControl+Alt+K'
    )
    assert.equal(reply.ok, false)
    assert.doesNotMatch(reply.error, /previous/)
    assert.match(reply.error, /hotkey is off/)
  })
})

describe('set-shortcut for paste-last', () => {
  beforeEach(() => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    store.setPasteLastShortcut('Command+Control+V')
    store.setCaptureShortcut('CommandOrControl+Shift+S')
  })

  it('an empty shortcut turns paste-last off and is stored', async () => {
    registerSettingsHandlers({ updateAccelerator: () => 'ok' })
    const reply = await ipc.handlers.get('set-shortcut')!(trustedEvent, 'pasteLast', '')
    assert.equal(reply.ok, true)
    assert.equal(store.getPasteLastShortcut(), '')
  })

  it('an empty shortcut is refused for the capture hotkey', async () => {
    registerSettingsHandlers({ updateAccelerator: () => 'ok' })
    const reply = await ipc.handlers.get('set-shortcut')!(trustedEvent, 'capture', '')
    assert.equal(reply.ok, false)
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Shift+S')
  })

  it('a conflict names the hotkey that holds the key', async () => {
    registerSettingsHandlers({
      updateAccelerator: () => 'conflict',
      conflictWith: () => 'pasteLast'
    })
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'capture',
      'Command+Control+V'
    )
    assert.equal(reply.ok, false)
    assert.match(visible(reply.error), /already used for paste last result/)
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Shift+S')
  })

  it('an unknown hotkey type is ignored', async () => {
    registerSettingsHandlers({ updateAccelerator: () => 'ok' })
    const reply = await ipc.handlers.get('set-shortcut')!(trustedEvent, 'bogus', 'Alt+K')
    assert.equal(reply.ok, false)
  })
})

describe('get-settings and refused start-up hotkeys', () => {
  it('reports the hotkeys the system refused at start-up', async () => {
    registerSettingsHandlers({ getUnavailable: () => ['capture'] })
    const reply = await ipc.handlers.get('get-settings')!(trustedEvent)
    assert.deepEqual(reply.unavailableShortcuts, ['capture'])
  })
})
