/**
 * Missing or rejected key -> the setup screen opens. Other failures do not.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { dialogs, ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { registerResultHandlers } = require('../src/main/ipc/result')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete
} = require('../src/main/services/dictation')
const { recoverFromKeyProblem } = require('../src/main/core/key-recovery')

const SELECTION = { x: 0, y: 0, width: 200, height: 100 }

function geminiWith(getApiKey: () => string, failure?: Error) {
  return new GeminiTranslationService({
    getApiKey,
    maxAttempts: 1,
    modelFactory: () =>
      asModel({
        generateContent: async () => {
          if (failure) throw failure
          return { response: { text: () => 'ok' } }
        }
      })
  })
}

describe('missing key opens the setup screen', () => {
  let shown: string[]
  const showSetup = (reason: string) => void shown.push(reason)

  beforeEach(() => {
    resetRecorded()
    shown = []
    Object.defineProperty(process, 'platform', { value: 'linux' })
  })

  it('screenshot without a key', async () => {
    setTranslationService(geminiWith(() => ''))
    registerCaptureHandlers({
      fromOverlay: () => true,
      captureScreen: async () => 'IMG',
      showSetup
    })
    await ipc.listeners.get('selection-made')!(trustedEvent, SELECTION)
    assert.deepEqual(shown, ['MISSING_KEY'])
  })

  it('text actions without a key', async () => {
    setTranslationService(geminiWith(() => ''))
    registerResultHandlers({ showSetup })
    const reply = await ipc.handlers.get('improve-text')!(trustedEvent, 'some text')
    assert.equal(reply.errorCode, 'MISSING_KEY')
    assert.deepEqual(shown, ['MISSING_KEY'])
  })

  it('dictation without a key opens setup instead of an error box', async () => {
    setTranslationService(geminiWith(() => ''))
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(
      { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' },
      { paste: async () => undefined, showSetup }
    )
    assert.deepEqual(shown, ['MISSING_KEY'])
    assert.equal(dialogs.length, 0)
  })

  it('a key Google rejects opens setup with the INVALID_KEY reason', async () => {
    const rejected = Object.assign(new Error('API key not valid'), { status: 400 })
    setTranslationService(geminiWith(() => 'bad', rejected))
    registerResultHandlers({ showSetup })
    const reply = await ipc.handlers.get('summarize-text')!(trustedEvent, 'text')
    assert.equal(reply.errorCode, 'INVALID_KEY')
    assert.deepEqual(shown, ['INVALID_KEY'])
  })

  it('quota and network problems do not send the user to setup', async () => {
    for (const failure of [
      Object.assign(new Error('quota'), { status: 429 }),
      new Error('fetch failed')
    ]) {
      setTranslationService(geminiWith(() => 'good', failure))
      registerResultHandlers({ showSetup })
      await ipc.handlers.get('comment-text')!(trustedEvent, 'text')
    }
    assert.deepEqual(shown, [])
  })

  it('a working key never opens setup', async () => {
    setTranslationService(new FakeTranslationService())
    registerResultHandlers({ showSetup })
    await ipc.handlers.get('comment-text')!(trustedEvent, 'text')
    assert.deepEqual(shown, [])
  })

  it('recoverFromKeyProblem only reacts to key errors', () => {
    assert.equal(recoverFromKeyProblem({ success: true, text: 'x' }, showSetup), false)
    assert.equal(recoverFromKeyProblem({ success: false, errorCode: 'NETWORK' }, showSetup), false)
    assert.equal(
      recoverFromKeyProblem({ success: false, errorCode: 'MISSING_KEY' }, showSetup),
      true
    )
  })
})
