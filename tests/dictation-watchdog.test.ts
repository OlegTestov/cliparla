/**
 * A dictation that stays in listening or processing too long is cancelled.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { shortcuts } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  isCurrentSession,
  markRecordingStarted,
  getDictationState
} = require('../src/main/services/dictation')
const {
  LISTENING_LIMIT_MS,
  PROCESSING_LIMIT_MS,
  watchDictationState,
  clearWatchdogForTests
} = require('../src/main/services/dictation/watchdog')
const { resetEscapeShortcutForTests } = require('../src/main/services/dictation/escape-shortcut')

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  cancelDictation()
  shortcuts.registered.clear()
  resetEscapeShortcutForTests()
  mock.timers.enable({ apis: ['setTimeout'] })
})
afterEach(() => {
  cancelDictation()
  mock.timers.reset()
  clearWatchdogForTests()
})

describe('dictation watchdog', () => {
  it('the limits are 190 s for listening and 105 s for processing', () => {
    assert.equal(LISTENING_LIMIT_MS, 190_000)
    assert.equal(PROCESSING_LIMIT_MS, 105_000)
  })

  const currentSession = (): number => {
    let session = 0
    while (!isCurrentSession(session)) session++
    return session
  }

  it('a microphone that never opens cancels the dictation (no audio to keep) and frees Esc', () => {
    startDictation()
    assert.equal(shortcuts.registered.has('Escape'), true)
    mock.timers.tick(LISTENING_LIMIT_MS - 1)
    assert.equal(getDictationState(), 'listening')
    mock.timers.tick(1)
    assert.equal(getDictationState(), 'idle')
    assert.equal(shortcuts.registered.has('Escape'), false)
  })

  it('a slow microphone prompt does not eat into the recording time', () => {
    startDictation()
    mock.timers.tick(15_000) // the user is answering the microphone prompt
    markRecordingStarted(currentSession())
    mock.timers.tick(LISTENING_LIMIT_MS - 1) // a full 180 s dictation plus slack
    assert.equal(getDictationState(), 'listening')
  })

  it('a recording that overruns is processed, not thrown away', () => {
    startDictation()
    markRecordingStarted(currentSession())
    mock.timers.tick(LISTENING_LIMIT_MS)
    assert.equal(getDictationState(), 'processing')
  })

  it('a stale or late started report does nothing', () => {
    startDictation()
    const session = currentSession()
    cancelDictation()
    markRecordingStarted(session) // idle now
    startDictation()
    markRecordingStarted(session) // an older session
    mock.timers.tick(LISTENING_LIMIT_MS)
    assert.equal(getDictationState(), 'idle', 'the unstarted dictation was cancelled normally')
  })

  it('cancels a dictation stuck in processing', () => {
    startDictation()
    stopListeningAndProcess()
    mock.timers.tick(PROCESSING_LIMIT_MS - 1)
    assert.equal(getDictationState(), 'processing')
    mock.timers.tick(1)
    assert.equal(getDictationState(), 'idle')
  })

  it('the clock restarts when listening turns into processing', () => {
    startDictation()
    mock.timers.tick(LISTENING_LIMIT_MS - 5000)
    stopListeningAndProcess()
    mock.timers.tick(PROCESSING_LIMIT_MS - 1)
    assert.equal(getDictationState(), 'processing')
  })

  it('a normal finish clears it: a later dictation is not cancelled early', async () => {
    setTranslationService(new FakeTranslationService())
    startDictation()
    stopListeningAndProcess()
    const done = handleDictationComplete(
      { audioBase64: 'QQ==', mimeType: 'audio/webm' },
      { paste: async () => {} }
    )
    await new Promise((resolve) => setImmediate(resolve))
    mock.timers.tick(20) // the short wait before pasting
    await done
    assert.equal(getDictationState(), 'idle')
    let session = 0
    while (!isCurrentSession(session)) session++
    mock.timers.tick(LISTENING_LIMIT_MS + 1)
    assert.ok(isCurrentSession(session), 'no stuck-dictation cancel after a normal finish')
  })

  it('going back to idle stops the clock', () => {
    let stuck = 0
    watchDictationState('processing', () => stuck++)
    watchDictationState('idle', () => stuck++)
    mock.timers.tick(LISTENING_LIMIT_MS * 2)
    assert.equal(stuck, 0)
  })
})
