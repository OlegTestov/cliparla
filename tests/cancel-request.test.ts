/** Closing the result window stops the Gemini request itself, not only the use of its answer. */

import './helpers/electron-stub'
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ipc,
  mediaAccess,
  resetRecorded,
  sentMessages,
  trustedEvent
} from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { registerResultHandlers } = require('../src/main/ipc/result')
const windowManager = require('../src/main/core/window-manager')

type Stream = { onText?: (t: string) => void; signal?: AbortSignal }
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

describe('closing the result window cancels the request', () => {
  let signals: Array<AbortSignal | undefined>
  let release: (result: unknown) => void

  // Answers only when released, or fails the way the real service does once its signal fires
  const pending = (stream?: Stream): Promise<unknown> => {
    signals.push(stream?.signal)
    return new Promise((resolve) => {
      release = resolve
      stream?.signal?.addEventListener('abort', () =>
        resolve({ success: false, errorCode: 'TIMEOUT', error: 'cancelled' })
      )
    })
  }
  const service = {
    translateScreenshot: (_i: string, _l: string, stream?: Stream) => pending(stream),
    extractText: async () => ({ success: true, text: '' }),
    translateSpeech: async () => ({ success: true, text: '' }),
    commentText: (_t: string, stream?: Stream) => pending(stream),
    improveText: (_t: string, stream?: Stream) => pending(stream),
    summarizeText: (_t: string, stream?: Stream) => pending(stream),
    testKey: async () => ({ ok: true })
  }
  const select = (): unknown =>
    ipc.listeners.get('selection-made')!(trustedEvent, { x: 0, y: 0, width: 200, height: 100 })
  const close = (): unknown => ipc.listeners.get('close-result')!(trustedEvent)

  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    mediaAccess.screen = 'granted'
    setTranslationService(service)
  })

  beforeEach(() => {
    resetRecorded()
    registerCaptureHandlers({ fromOverlay: () => true, captureScreen: async () => 'IMG' })
    registerResultHandlers()
    signals = []
  })

  it('a screen translation gets a signal, closing the window aborts it and nothing more is sent', async () => {
    const running = select()
    await tick()
    assert.equal(signals.length, 1)
    assert.ok(signals[0], 'the request carries a signal')
    assert.equal(signals[0]!.aborted, false)
    sentMessages.length = 0
    close()
    assert.equal(signals[0]!.aborted, true)
    await running
    assert.equal(
      sentMessages.some((m) => m.channel === 'translation-complete'),
      false,
      'a cancelled request sends no result to the window'
    )
  })

  it('a text action is aborted the same way', async () => {
    const action = ipc.handlers.get('summarize-text')!(trustedEvent, 'some text', 1)
    await tick()
    assert.ok(signals[0])
    assert.equal(signals[0]!.aborted, false)
    close()
    assert.equal(signals[0]!.aborted, true)
    await action
  })

  it('a request that already finished is not affected, and the next one starts clean', async () => {
    const first = ipc.handlers.get('comment-text')!(trustedEvent, 'one', 1)
    await tick()
    release({ success: true, text: 'done' })
    await first
    close()
    assert.equal(signals[0]!.aborted, false, 'closing later does not touch a finished request')
    const second = ipc.handlers.get('comment-text')!(trustedEvent, 'two', 2)
    await tick()
    assert.equal(signals[1]!.aborted, false)
    release({ success: true, text: 'done' })
    await second
  })
})
