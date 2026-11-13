/**
 * Fixes from the review of batch 2: overlapping pastes, the no-text marker, a source-only
 * reply, the new default hotkeys, the copy-text dictionary wording and the toast window.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  FakeBrowserWindow,
  ipc,
  resetRecorded,
  shortcuts,
  trustedEvent
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { pasteText } = require('../src/main/services/keyboard-simulator')
const { pasteLastResult, setPasteLastDepsForTests } = require('../src/main/services/paste-last')
const {
  getLastResult,
  setLastResult,
  resetLastResultForTests
} = require('../src/main/services/last-result')
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { parseScreenTranslation } = require('../src/shared/structured-translation')
const { initializeHotkeys } = require('../src/main/core/app-bootstrap')
const { hotkeyManager } = require('../src/main/core/hotkey-manager')
const {
  buildCopyTextPrompt,
  buildSpeechTranslationPrompt
} = require('../src/shared/gemini-constants')
const store = require('../src/main/services/store')
const windowManager = require('../src/main/core/window-manager')

class Item {
  constructor(public data: Record<string, string>) {}
  get types() {
    return Object.keys(this.data)
  }
  async getType(t: string) {
    return this.data[t]
  }
}

function fakeBoard(initial: string) {
  let items: Item[] = [new Item({ 'text/plain': initial })]
  return {
    board: {
      read: async () => items,
      write: async (next: Item[]) => void (items = next),
      writeText: (t: string) => void (items = [new Item({ 'text/plain': t })]),
      clear: () => void (items = [])
    },
    text: async () => (items[0] ? items[0].getType('text/plain') : undefined)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const simulate = () => sleep(40)

describe('overlapping pastes', () => {
  it('two pastes 60 ms apart keep the user clipboard', async () => {
    const { board, text } = fakeBoard('USER')
    const first = pasteText('LAST', { clipboard: board, Item, simulate, targetReady: () => true })
    await sleep(60)
    const second = pasteText('LAST', { clipboard: board, Item, simulate, targetReady: () => true })
    await Promise.all([first, second])
    assert.equal(await text(), 'USER')
  })

  it('Paste last during a dictation paste waits for it and keeps the user clipboard', async () => {
    const { board, text } = fakeBoard('USER')
    const dictation = pasteText('DICTATED', {
      clipboard: board,
      Item,
      simulate,
      targetReady: () => true
    })
    await sleep(30)
    const last = pasteText('LAST', { clipboard: board, Item, simulate, targetReady: () => true })
    await Promise.all([dictation, last])
    assert.equal(await text(), 'USER')
  })

  it('a failed paste does not block the next one', async () => {
    const { board, text } = fakeBoard('USER')
    await assert.rejects(
      pasteText('A', {
        clipboard: board,
        targetReady: () => true,
        Item,
        simulate: async () => {
          throw new Error('helper failed')
        }
      })
    )
    assert.equal(await text(), 'A') // Failed delivery leaves its text available for manual paste.
    await pasteText('B', { clipboard: board, Item, simulate, targetReady: () => true })
    assert.equal(await text(), 'A')
  })

  it('a Paste last press while one is under way is ignored', async () => {
    resetLastResultForTests()
    setLastResult('LAST')
    const pasted: string[] = []
    const deps = {
      isTrusted: () => true,
      ownWindowFocused: () => false,
      paste: async (t: string) => {
        pasted.push(t)
        await sleep(40)
      }
    }
    const first = pasteLastResult(deps)
    const second = await pasteLastResult(deps)
    assert.equal(second, false)
    assert.equal(await first, true)
    assert.deepEqual(pasted, ['LAST'])
    assert.equal(await pasteLastResult(deps), true) // free again afterwards
  })
})

describe('review fixes', () => {
  beforeEach(() => {
    resetRecorded()
    resetLastResultForTests()
    setPasteLastDepsForTests(null)
    store.saveSettings({ uiLanguage: 'en' })
  })

  it('a screen translation with the no-text marker does not replace the last result', async () => {
    setLastResult('KEEP')
    const service = new FakeTranslationService({
      success: true,
      text: '[No text detected in image]'
    })
    setTranslationService(service)
    registerCaptureHandlers({
      fromOverlay: () => true,
      captureScreen: async () => 'IMG',
      captureAllowed: () => true
    })
    await ipc.listeners.get('selection-made')!(trustedEvent, {
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
    assert.equal(getLastResult(), 'KEEP')
  })

  it('a reply with a source but an empty translation shows the source; both empty is empty', () => {
    assert.deepEqual(parseScreenTranslation('{"source":"Hello","translation":""}'), {
      translation: 'Hello',
      source: 'Hello'
    })
    assert.equal(parseScreenTranslation('{"source":" ","translation":""}'), null)
  })

  it('the copy-text defaults are Cmd+Ctrl+C and do not collide with the other defaults', () => {
    assert.equal(store.getCopyTextShortcut(), 'Command+Control+C')
    const all = [
      store.getCaptureShortcut(),
      store.getDictationShortcut(),
      store.getPasteLastShortcut(),
      store.getCopyTextShortcut()
    ].map((a: string) => a.toLowerCase())
    assert.equal(new Set(all).size, 4)
  })

  it('a new default that clashes with a key the user chose is left off at startup', () => {
    store.setCaptureShortcut('Command+Control+C') // the user's own choice
    store.setDictationShortcut('CommandOrControl+Shift+D')
    store.setCopyTextShortcut('Command+Control+C')
    store.setPasteLastShortcut('Command+Control+V')
    hotkeyManager.unregisterAll()
    initializeHotkeys()
    hotkeyManager.setMode('normal')
    assert.equal(hotkeyManager.getAccelerator('copyText'), '')
    assert.equal(store.getCopyTextShortcut(), '')
    assert.equal(hotkeyManager.getAccelerator('capture'), 'Command+Control+C')
    assert.equal(shortcuts.registered.has('Command+Control+C'), true)
    assert.equal(hotkeyManager.getAccelerator('pasteLast'), 'Command+Control+V')
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    store.setCopyTextShortcut('Command+Control+C')
  })

  it('the copy-text prompt uses the dictionary only where the image shows the terms', () => {
    const copy = buildCopyTextPrompt(['Zorvath'])
    assert.match(copy, /only where the image shows these names or terms/)
    assert.match(copy, /otherwise return the text exactly as it appears/)
    assert.doesNotMatch(copy, /Spell these names/)
    assert.match(
      buildSpeechTranslationPrompt('German', ['Zorvath']),
      /Spell these names and terms exactly as written\./
    )
  })

  it('the toast window ignores the mouse', () => {
    const calls: boolean[] = []
    const proto = FakeBrowserWindow.prototype
    proto.setIgnoreMouseEvents = (value: boolean) => void calls.push(value)
    windowManager.registerDefaultWindows()
    windowManager.destroy('toast')
    windowManager.createAll()
    delete proto.setIgnoreMouseEvents
    assert.deepEqual(calls, [true])
  })
})
