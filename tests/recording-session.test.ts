/**
 * Messages from the indicator renderer carry the dictation session. Only the
 * current session may change main's state, and no dictation may leave main
 * stuck in `listening` or `processing`.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { dialogs, ipc, resetRecorded, sentMessages, trustedEvent } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'
import { indicatorEvent, sessionOfLastStart } from './helpers/indicator'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { setTranslationService } = require('../src/main/services/translation')
const { registerDictationHandlers } = require('../src/main/ipc/dictation')
const {
  startDictation,
  toggleDictation,
  cancelDictation,
  getDictationState
} = require('../src/main/services/dictation')

const channels = (): string[] => sentMessages.map((m) => m.channel)
const otherWindowEvent = { ...trustedEvent, sender: { id: -1 } }
const send = (channel: string, payload?: unknown, event: object = indicatorEvent()): unknown =>
  ipc.listeners.get(channel)!(event, payload)
const audioFor = (session: number): object => ({
  audioBase64: 'QVVESU8=',
  mimeType: 'audio/webm',
  session,
  durationMs: 4000
})
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

let translated: number
let durations: unknown[]

beforeEach(() => {
  resetRecorded()
  cancelDictation()
  windowManager.registerDefaultWindows()
  windowManager.createAll()
  registerDictationHandlers()
  const service = new FakeTranslationService()
  service.translateSpeech = (async (...args: unknown[]) => {
    translated++
    durations.push(args[3])
    return { success: true, text: 'TEXT' }
  }) as never
  setTranslationService(service)
  translated = 0
  durations = []
  mock.timers.enable({ apis: ['setTimeout'] })
  sentMessages.length = 0
})

afterEach(() => {
  cancelDictation()
  mock.timers.reset()
})

describe('the session travels with the start message', () => {
  it('each dictation gets a new number', () => {
    startDictation()
    const a = sessionOfLastStart()
    cancelDictation()
    startDictation()
    assert.ok(typeof a === 'number' && sessionOfLastStart() !== a)
  })
})

describe('recording-failed', () => {
  it('a stale failure from A does not cancel B', () => {
    startDictation()
    const a = sessionOfLastStart()
    cancelDictation()
    startDictation()
    send('recording-failed', { session: a, reason: 'mic' })
    assert.equal(getDictationState(), 'listening')
  })

  it('"empty" in processing returns to idle, closes the indicator and the next hotkey records', () => {
    startDictation()
    toggleDictation()
    assert.equal(getDictationState(), 'processing')
    const session = sessionOfLastStart()
    sentMessages.length = 0
    send('recording-failed', { session, reason: 'empty' })
    assert.equal(getDictationState(), 'idle')
    assert.ok(channels().includes('listening-mode-stop'))
    assert.equal(windowManager.isVisible('listening'), false)
    toggleDictation()
    assert.equal(getDictationState(), 'listening')
  })

  it('"empty" while listening (track ended without data) also returns to idle', () => {
    startDictation()
    send('recording-failed', { session: sessionOfLastStart(), reason: 'empty' })
    assert.equal(getDictationState(), 'idle')
  })

  it('a real failure returns to idle but leaves the indicator with its error', () => {
    startDictation()
    const session = sessionOfLastStart()
    sentMessages.length = 0
    send('recording-failed', { session, reason: 'mic' })
    assert.equal(getDictationState(), 'idle')
    assert.ok(!channels().includes('listening-mode-stop'))
    assert.equal(windowManager.isVisible('listening'), true)
  })

  it('the same report twice does nothing the second time', () => {
    startDictation()
    const session = sessionOfLastStart()
    send('recording-failed', { session, reason: 'mic' })
    startDictation()
    send('recording-failed', { session, reason: 'mic' })
    assert.equal(getDictationState(), 'listening')
  })

  it('malformed payloads are ignored', () => {
    startDictation()
    const session = sessionOfLastStart()
    for (const bad of [
      undefined,
      null,
      'empty',
      {},
      { session },
      { reason: 'empty' },
      { session: String(session), reason: 'empty' },
      { session, reason: 'because' }
    ])
      send('recording-failed', bad)
    assert.equal(getDictationState(), 'listening')
  })

  it('only the indicator window may send it', () => {
    startDictation()
    send('recording-failed', { session: sessionOfLastStart(), reason: 'empty' }, otherWindowEvent)
    send('recording-failed', { session: sessionOfLastStart(), reason: 'empty' }, trustedEvent)
    assert.equal(getDictationState(), 'listening')
  })
})

describe('audio-data-ready', () => {
  it('audio of the current session is translated', async () => {
    startDictation()
    toggleDictation()
    send('audio-data-ready', audioFor(sessionOfLastStart()))
    await flush()
    assert.equal(translated, 1)
  })

  it('stale audio from A is ignored while B is listening', async () => {
    startDictation()
    const a = sessionOfLastStart()
    cancelDictation()
    startDictation()
    send('audio-data-ready', audioFor(a))
    await flush()
    assert.equal(translated, 0)
    assert.equal(getDictationState(), 'listening')
  })

  it('malformed audio payloads without the current session are ignored', async () => {
    startDictation()
    toggleDictation()
    const session = sessionOfLastStart()
    for (const bad of [
      undefined,
      { audioBase64: 'x', mimeType: 'audio/webm' },
      { audioBase64: 5, mimeType: 'audio/webm', session: session + 1, durationMs: 1000 },
      { audioBase64: 'x', mimeType: 'audio/webm', session: '1', durationMs: 1000 }
    ])
      send('audio-data-ready', bad)
    await flush()
    assert.equal(translated, 0)
    assert.equal(getDictationState(), 'processing')
    assert.deepEqual(dialogs, [])
  })

  it('usable audio with a bad duration is still translated, with the longest deadline', async () => {
    for (const durationMs of [undefined, 0, -5, Number.NaN, 185_001, '4000']) {
      startDictation()
      toggleDictation()
      send('audio-data-ready', { ...(audioFor(sessionOfLastStart()) as object), durationMs })
      await flush()
      cancelDictation()
    }
    assert.equal(translated, 6)
    assert.deepEqual(durations, Array(6).fill(180_000))
    assert.deepEqual(dialogs, [])
  })

  it('unusable audio of the current session ends the dictation at once, in the indicator', async () => {
    for (const bad of [
      { ...(audioFor(0) as object), audioBase64: 5 },
      { ...(audioFor(0) as object), mimeType: {} },
      { mimeType: 'audio/webm', durationMs: 1000 }
    ]) {
      startDictation()
      toggleDictation()
      send('audio-data-ready', { ...bad, session: sessionOfLastStart() })
      await flush()
      assert.equal(translated, 0)
      assert.equal(getDictationState(), 'idle')
      assert.equal(dialogs.length, 0)
      assert.equal(channels().filter((c) => c === 'listening-mode-error').length, 1)
      sentMessages.length = 0
    }
  })

  it('the measured level travels with the audio; a malformed one is dropped, not trusted', async () => {
    const levels = [
      [{ peak: 0, activeMs: 0 }, 0],
      [{ peak: 0.4, activeMs: 900 }, 1],
      [{ peak: Number.NaN, activeMs: 900 }, 1],
      ['loud', 1],
      [{ peak: 9, activeMs: 1 }, 1]
    ] as const
    for (const [level, sent] of levels) {
      translated = 0
      startDictation()
      toggleDictation()
      send('audio-data-ready', { ...(audioFor(sessionOfLastStart()) as object), level })
      await flush()
      assert.equal(translated, sent, JSON.stringify(level))
      cancelDictation()
    }
  })

  it('only the indicator window may send it', async () => {
    startDictation()
    toggleDictation()
    send('audio-data-ready', audioFor(sessionOfLastStart()), otherWindowEvent)
    await flush()
    assert.equal(translated, 0)
  })
})

describe('recording-started', () => {
  const LIMIT = 190_000

  it('from the indicator it restarts the listening clock: the overrun is processed', () => {
    startDictation()
    send('recording-started', sessionOfLastStart())
    mock.timers.tick(LIMIT)
    assert.equal(getDictationState(), 'processing')
  })

  it('from another window it changes nothing: the unstarted dictation is cancelled', () => {
    startDictation()
    send('recording-started', sessionOfLastStart(), otherWindowEvent)
    mock.timers.tick(LIMIT)
    assert.equal(getDictationState(), 'idle')
  })

  it('a malformed or stale session changes nothing', () => {
    startDictation()
    const session = sessionOfLastStart()
    for (const bad of [undefined, null, '1', {}, session + 1]) send('recording-started', bad)
    mock.timers.tick(LIMIT)
    assert.equal(getDictationState(), 'idle')
  })
})

describe('cancel and stop', () => {
  it('only the indicator window may send them', () => {
    startDictation()
    send('stop-dictation', undefined, otherWindowEvent)
    assert.equal(getDictationState(), 'listening')
    send('cancel-dictation', undefined, otherWindowEvent)
    assert.equal(getDictationState(), 'listening')
    send('stop-dictation')
    assert.equal(getDictationState(), 'processing')
    send('cancel-dictation')
    assert.equal(getDictationState(), 'idle')
  })
})
