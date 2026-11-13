/**
 * The indicator window is 240x70 for the pill and 360x124 for the error card. The page
 * is told first, the window resizes after, in every path between the two.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callLog, resetRecorded } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  retryDictation
} = require('../src/main/services/dictation')
const { showCopiedNotice } = require('../src/main/services/accessibility-hint')

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm', durationMs: 4000 }
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function openCard(): Promise<void> {
  setTranslationService(
    new FakeTranslationService({ success: false, errorCode: 'NETWORK', error: 'offline' } as never)
  )
  startDictation()
  stopListeningAndProcess()
  await handleDictationComplete(audio, { paste: async () => {} })
}

describe('indicator sizes', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    cancelDictation()
    resetRecorded()
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    callLog.length = 0
  })
  afterEach(() => cancelDictation())

  it('the error card is 360x124 and the pill 240x70', () => {
    windowManager.showListeningIndicator('error')
    windowManager.showListeningIndicator()
    assert.deepEqual(callLog, ['setBounds:360x124', 'setBounds:240x70'])
  })

  it('an error: the page switches to the card first, then the window grows', async () => {
    await openCard()
    const i = callLog.indexOf('send:listening-mode-error')
    assert.ok(i >= 0)
    assert.equal(callLog[i + 1], 'setBounds:360x124')
  })

  it('Retry: the page leaves the card first, then the window shrinks', async () => {
    await openCard()
    callLog.length = 0
    retryDictation({ paste: async () => {} })
    await flush()
    const i = callLog.indexOf('send:listening-mode-processing')
    assert.ok(i >= 0)
    assert.equal(callLog[i + 1], 'setBounds:240x70')
  })

  it('the hotkey while the card is open: start message first, then the pill size', async () => {
    await openCard()
    callLog.length = 0
    startDictation()
    const i = callLog.indexOf('send:listening-mode-start')
    assert.ok(i >= 0)
    assert.equal(callLog[i + 1], 'setBounds:240x70')
  })

  it('the copied pill: message first, then the pill size', () => {
    showCopiedNotice({ reason: 'paste-failed' })
    const i = callLog.indexOf('send:listening-mode-copied')
    assert.ok(i >= 0)
    assert.equal(callLog[i + 1], 'setBounds:240x70')
  })
})
