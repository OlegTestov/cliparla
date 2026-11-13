/**
 * "Paste last result": a tray item and a global hotkey deliver the last dictation or
 * screen translation again, through the same path as a dictation. Memory only.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetRecorded, shortcuts, trayMenu } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation
} = require('../src/main/services/dictation')
const {
  getLastResult,
  setLastResult,
  resetLastResultForTests
} = require('../src/main/services/last-result')
const { pasteLastResult, setPasteLastDepsForTests } = require('../src/main/services/paste-last')
const { resetPromptForTests } = require('../src/main/services/paste-delivery')
const { initializeHotkeys } = require('../src/main/core/app-bootstrap')
const { hotkeyManager } = require('../src/main/core/hotkey-manager')
const { createTray, updateTrayMenu } = require('../src/main/services/tray')
const store = require('../src/main/services/store')

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }

interface Spy {
  pasted: string[]
  copied: string[]
  notices: number
  deps: Record<string, unknown>
}

function spy(trusted = true): Spy {
  const s: Spy = {
    pasted: [],
    copied: [],
    notices: 0,
    deps: {}
  }
  s.deps = {
    isTrusted: () => trusted,
    paste: async (text: string) => void s.pasted.push(text),
    copy: (text: string) => void s.copied.push(text),
    notify: () => void s.notices++,
    prompt: () => undefined,
    watchGrant: () => undefined,
    ownWindowFocused: () => false
  }
  return s
}

async function dictate(result: unknown, s: Spy): Promise<void> {
  const service = new FakeTranslationService()
  service.translateSpeech = (async () => result) as never
  setTranslationService(service)
  startDictation()
  stopListeningAndProcess()
  await handleDictationComplete(audio, s.deps)
}

describe('paste last result', () => {
  beforeEach(() => {
    resetRecorded()
    cancelDictation()
    resetLastResultForTests()
    resetPromptForTests()
  })
  afterEach(() => setPasteLastDepsForTests(null))

  it('L1: the tray item is disabled with a tooltip when empty and enabled after a result', () => {
    createTray()
    updateTrayMenu()
    const find = () =>
      trayMenu.items.find((i) => i.label === 'Paste last result') as unknown as {
        enabled: boolean
        toolTip?: string
      }
    assert.equal(find().enabled, false)
    assert.equal(find().toolTip, 'Nothing to paste yet')
    setLastResult('Hello')
    assert.equal(find().enabled, true)
    assert.equal(find().toolTip, undefined)
  })

  it('L2: the hotkey pastes the last dictation once', async () => {
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    store.setDictationShortcut('CommandOrControl+Shift+D')
    hotkeyManager.unregisterAll()
    initializeHotkeys()
    hotkeyManager.setMode('normal')
    const s = spy()
    await dictate({ success: true, text: 'Hola mundo' }, s)
    assert.deepEqual(s.pasted, ['Hola mundo'])
    setPasteLastDepsForTests(s.deps)
    const press = shortcuts.registered.get(hotkeyManager.getAccelerator('pasteLast'))!
    press()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(s.pasted, ['Hola mundo', 'Hola mundo'])
  })

  it('L3: without Accessibility the text is copied and the user is told', async () => {
    setLastResult('Hallo')
    const s = spy(false)
    assert.equal(await pasteLastResult(s.deps), true)
    assert.deepEqual(s.pasted, [])
    assert.deepEqual(s.copied, ['Hallo'])
    assert.equal(s.notices, 1)
  })

  it('a Cliparla window with the keyboard gets no paste: the text is copied instead', async () => {
    setLastResult('Hallo')
    const s = spy()
    await pasteLastResult({ ...s.deps, ownWindowFocused: () => true })
    assert.deepEqual(s.pasted, [])
    assert.deepEqual(s.copied, ['Hallo'])
    assert.equal(s.notices, 1)
  })

  it('L4: nothing is kept across a restart (memory only)', () => {
    setLastResult('secret')
    resetLastResultForTests() // a new run starts with an empty module
    assert.equal(getLastResult(), null)
    const source = readFileSync(join(__dirname, '../src/main/services/last-result.ts'), 'utf8')
    assert.doesNotMatch(source, /from '(node:)?fs|from '\.\/store|electron-store/)
  })

  it('L5: a failed dictation does not replace the last result', async () => {
    const s = spy()
    await dictate({ success: true, text: 'First' }, s)
    cancelDictation()
    await dictate({ success: false, errorCode: 'BLOCKED', error: 'blocked' }, s)
    assert.equal(getLastResult(), 'First')
    cancelDictation()
  })

  it('with nothing kept the hotkey does nothing', async () => {
    const s = spy()
    assert.equal(await pasteLastResult(s.deps), false)
    assert.deepEqual(s.pasted.concat(s.copied), [])
  })
})
