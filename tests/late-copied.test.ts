/**
 * A late "copied" from dictation A must never touch dictation B, and a
 * recording that cannot start must not leave the app stuck in `processing`.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, notifications, resetRecorded, sentMessages } from './helpers/electron-stub'
import { indicatorEvent, sessionOfLastStart } from './helpers/indicator'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { setTranslationService } = require('../src/main/services/translation')
const { registerDictationHandlers } = require('../src/main/ipc/dictation')
const {
  startDictation,
  stopListeningAndProcess,
  toggleDictation,
  handleDictationComplete,
  cancelDictation,
  getDictationState
} = require('../src/main/services/dictation')
const { nextMode } = require('../src/renderer/src/listening/mode')

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }
const channels = (): string[] => sentMessages.map((m) => m.channel)

function setup(): void {
  resetRecorded()
  cancelDictation()
  windowManager.registerDefaultWindows()
  windowManager.createAll()
  resetRecorded()
  const service = new FakeTranslationService()
  service.translateSpeech = (async () => ({ success: true, text: 'A-TEXT' })) as never
  setTranslationService(service)
  mock.timers.enable({ apis: ['setTimeout'] })
}

describe('a paste that fails after a newer dictation started', () => {
  beforeEach(setup)
  afterEach(() => {
    cancelDictation()
    mock.timers.reset()
  })

  it('shows only the system notice; B keeps recording and gets no "copied"', async () => {
    startDictation()
    stopListeningAndProcess()
    let failPaste: (e: Error) => void = () => {}
    const done = handleDictationComplete(audio, {
      paste: () => new Promise<void>((_, reject) => (failPaste = reject)),
      copy: () => {}
    })
    await new Promise((resolve) => setImmediate(resolve))
    mock.timers.tick(20) // the pre-paste delay
    await new Promise((resolve) => setImmediate(resolve))
    startDictation() // B
    sentMessages.length = 0
    failPaste(new Error('paste helper failed'))
    await done
    mock.timers.tick(5000)
    assert.ok(!channels().includes('listening-mode-copied'))
    assert.ok(!channels().includes('listening-mode-stop'))
    assert.equal(getDictationState(), 'listening')
    assert.equal(notifications.length, 1)
  })

  it("keeps B's error when B started, failed, and then A's paste fails", async () => {
    registerDictationHandlers()
    startDictation()
    stopListeningAndProcess()
    let failPaste: (e: Error) => void = () => {}
    const done = handleDictationComplete(audio, {
      paste: () => new Promise<void>((_, reject) => (failPaste = reject)),
      copy: () => {}
    })
    await new Promise((resolve) => setImmediate(resolve))
    mock.timers.tick(20)
    await new Promise((resolve) => setImmediate(resolve))
    startDictation() // B
    ipc.listeners.get('recording-failed')!(indicatorEvent(), {
      session: sessionOfLastStart(),
      reason: 'mic'
    })
    assert.equal(getDictationState(), 'idle')
    sentMessages.length = 0
    failPaste(new Error('paste helper failed'))
    await done
    mock.timers.tick(5000)
    assert.ok(!channels().includes('listening-mode-copied'))
    assert.ok(!channels().includes('listening-mode-stop'))
    assert.equal(notifications.length, 1)
  })

  it('still shows the indicator when nothing newer started', async () => {
    startDictation()
    stopListeningAndProcess()
    const done = handleDictationComplete(audio, {
      paste: async () => {
        throw new Error('fail')
      },
      copy: () => {}
    })
    await new Promise((resolve) => setImmediate(resolve))
    mock.timers.tick(20)
    await done
    assert.ok(channels().includes('listening-mode-copied'))
  })
})

describe('the renderer ignores "copied" during a dictation', () => {
  it('only idle or copied accept it', () => {
    for (const mode of ['starting', 'listening', 'processing'])
      assert.equal(nextMode(mode, 'copied'), mode)
    assert.equal(nextMode('idle', 'copied'), 'copied')
    assert.equal(nextMode('copied', 'copied'), 'copied')
  })
})

describe('a recording that cannot start', () => {
  beforeEach(setup)
  afterEach(() => {
    cancelDictation()
    mock.timers.reset()
  })

  it('without the report the app waits in processing: no audio, no way out', () => {
    startDictation()
    toggleDictation()
    assert.equal(getDictationState(), 'processing')
    toggleDictation() // ignored while processing
    assert.equal(getDictationState(), 'processing')
  })

  it('the renderer report returns to idle and the next hotkey records again', () => {
    registerDictationHandlers()
    startDictation()
    ipc.listeners.get('recording-failed')!(indicatorEvent(), {
      session: sessionOfLastStart(),
      reason: 'mic'
    })
    assert.equal(getDictationState(), 'idle')
    sentMessages.length = 0
    toggleDictation()
    assert.equal(getDictationState(), 'listening')
    assert.deepEqual(channels(), ['listening-mode-start'])
  })
})
