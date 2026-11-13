/** The Settings recorder keeps Control on macOS, and plain Command/Shift hotkeys are refused. */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'
import { keyEventToAccelerator, isTooPlainShortcut } from '../src/shared/key-event'

/* eslint-disable @typescript-eslint/no-require-imports */
const { registerSettingsHandlers } = require('../src/main/ipc/settings')
const { sameAccelerator } = require('../src/main/core/hotkey-manager')
const store = require('../src/main/services/store')

const press = (code: string, key: string, mods: Partial<Record<string, boolean>>) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('recording Control on a Mac', () => {
  it('Ctrl+Cmd+V is recorded with both modifiers', () => {
    const a = keyEventToAccelerator(press('KeyV', 'v', { metaKey: true, ctrlKey: true }), true)
    assert.equal(a, 'Command+Control+V')
    assert.equal(sameAccelerator(a!, 'Command+Control+V'), true)
  })

  it('Control alone is kept, Command alone stays CommandOrControl', () => {
    assert.equal(
      keyEventToAccelerator(press('KeyK', 'k', { ctrlKey: true, altKey: true }), true),
      'Control+Alt+K'
    )
    assert.equal(
      keyEventToAccelerator(press('KeyS', 's', { metaKey: true, shiftKey: true }), true),
      'CommandOrControl+Shift+S'
    )
  })

  it('elsewhere Ctrl is still CommandOrControl', () => {
    assert.equal(
      keyEventToAccelerator(press('KeyS', 's', { ctrlKey: true, shiftKey: true }), false),
      'CommandOrControl+Shift+S'
    )
  })

  it('the two spellings of Command are one key on a Mac', () => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      assert.equal(sameAccelerator('CommandOrControl+Control+V', 'Command+Control+V'), true)
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
  })
})

describe('too-plain global hotkeys', () => {
  beforeEach(() => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
  })

  it('a lone Command, Control or Shift with a key is plain; two modifiers or an F-key are not', () => {
    for (const plain of [
      'CommandOrControl+C',
      'Command+V',
      'Control+Z',
      'Shift+A',
      'Ctrl+Tab',
      'CommandOrControl+Space'
    ]) {
      assert.equal(isTooPlainShortcut(plain), true, plain)
    }
    for (const fine of [
      'Command+Control+V',
      'Control+Alt+C',
      'Alt+Command+K',
      'Control+Shift+Alt+C',
      'CommandOrControl+F4',
      'Alt+F5',
      'F9'
    ]) {
      assert.equal(isTooPlainShortcut(fine), false, fine)
    }
  })

  it('a bare key with no modifier is plain, except an F-key', () => {
    for (const bare of ['V', 'Escape', 'Space', '1', 'Up', '']) {
      assert.equal(isTooPlainShortcut(bare), true, bare)
    }
    assert.equal(isTooPlainShortcut('F9'), false)
  })

  it('Option alone or with Shift plus a character is plain: it types one', () => {
    for (const typing of [
      'Alt+L',
      'Option+A',
      'Alt+Shift+2',
      'Option+Shift+K',
      'Alt+;',
      'alt+shift+C'
    ]) {
      assert.equal(isTooPlainShortcut(typing), true, typing)
    }
    for (const fine of ['Alt+Space', 'Alt+Up', 'Alt+Shift+F9', 'Alt+Control+K']) {
      assert.equal(isTooPlainShortcut(fine), false, fine)
    }
  })

  it('other spellings of Command are recognised, and Cmd+F5 (VoiceOver) is refused', () => {
    for (const plain of [
      'Super+V',
      'Meta+C',
      'Cmd+Z',
      'CmdOrCtrl+V',
      'CommandOrControl+F5',
      'Cmd+F5'
    ]) {
      assert.equal(isTooPlainShortcut(plain), true, plain)
    }
  })

  it('every default hotkey is accepted', () => {
    for (const a of [
      store.getCaptureShortcut(),
      store.getDictationShortcut(),
      store.getPasteLastShortcut(),
      store.getCopyTextShortcut()
    ]) {
      assert.equal(isTooPlainShortcut(a), false, a)
    }
  })

  it('Settings refuses Cmd+V and Cmd+C with a message and keeps the old hotkey', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    let registered = 0
    registerSettingsHandlers({ updateAccelerator: () => (registered++, 'ok') })
    const before = store.getPasteLastShortcut()
    for (const plain of ['CommandOrControl+V', 'CommandOrControl+C']) {
      const reply = await ipc.handlers.get('set-shortcut')!(trustedEvent, 'pasteLast', plain)
      assert.equal(reply.ok, false)
      assert.match(reply.error.replace(/[⁦⁩]/g, ''), /is too plain/)
    }
    assert.equal(registered, 0)
    assert.equal(store.getPasteLastShortcut(), before)
    const ok = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'pasteLast',
      'Command+Control+V'
    )
    assert.equal(ok.ok, true)
  })

  it('save-settings refuses plain capture and dictation shortcuts without registering them', async () => {
    const asked: string[] = []
    registerSettingsHandlers({
      updateAccelerator: (_t: string, a: string) => (asked.push(a), 'ok')
    })
    const capture = store.getCaptureShortcut()
    const dictation = store.getDictationShortcut()
    await ipc.handlers.get('save-settings')!(trustedEvent, {
      captureShortcut: 'CommandOrControl+V',
      dictationShortcut: 'Alt+L'
    })
    assert.deepEqual(asked, [])
    assert.equal(store.getCaptureShortcut(), capture)
    assert.equal(store.getDictationShortcut(), dictation)
    await ipc.handlers.get('save-settings')!(trustedEvent, {
      captureShortcut: 'CommandOrControl+Alt+K'
    })
    assert.deepEqual(asked, ['CommandOrControl+Alt+K'])
    assert.equal(store.getCaptureShortcut(), 'CommandOrControl+Alt+K')
  })
})
