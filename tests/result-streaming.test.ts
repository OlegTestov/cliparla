/** Batch 3 item 1: the result window shows text as it arrives (G4, G5). */

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
const {
  ResultController,
  isStreaming,
  canCopyText,
  canRetry
} = require('../src/renderer/src/result/result-controller')
const { heightToAsk } = require('../src/renderer/src/result/fit')
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { registerResultHandlers } = require('../src/main/ipc/result')
const windowManager = require('../src/main/core/window-manager')

const MESSAGES = { failed: 'failed', unexpected: 'unexpected' }

describe('G4: chunks render in order and Copy waits for the end', () => {
  it('the window shows the latest text, Copy stays off until the translation completes', () => {
    const c = new ResultController()
    c.start()
    const shown: string[] = []
    for (const text of ['Ho', 'Hola', 'Hola mundo']) {
      c.partial(text)
      shown.push(c.getState().streamText)
      assert.equal(isStreaming(c.getState()), true)
      assert.equal(canCopyText(c.getState()), false)
    }
    assert.deepEqual(shown, ['Ho', 'Hola', 'Hola mundo'])
    c.complete({ success: true, text: 'Hola mundo' })
    assert.equal(c.getState().streamText, '')
    assert.equal(isStreaming(c.getState()), false)
    assert.equal(canCopyText(c.getState()), true)
  })

  it('text that arrives after the end or after a new capture is ignored', () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    c.partial('late')
    assert.equal(c.getState().streamText, '')
    c.actionPartial(1, 'late action')
    assert.equal(c.getState().streamText, '')
  })

  it('an AI action streams too, and Copy waits for it', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    let release!: () => void
    const done = c.runAction(
      'summarize',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true, text: 'Summary' })
        }),
      MESSAGES
    )
    c.actionPartial(1, 'Sum')
    assert.equal(c.getState().streamText, 'Sum')
    assert.equal(isStreaming(c.getState()), true)
    assert.equal(canCopyText(c.getState()), false)
    release()
    await done
    assert.equal(c.getState().streamText, '')
    assert.equal(canCopyText(c.getState()), true)
  })

  it('a new capture drops the text of the old one', () => {
    const c = new ResultController()
    c.start()
    c.partial('old')
    c.start()
    assert.equal(c.getState().streamText, '')
  })
})

describe('a stale action stream is ignored', () => {
  it('text tagged with an older request does not replace the running action', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    const ids: number[] = []
    let release!: () => void
    const first = c.runAction(
      'summarize',
      (_t: string, id: number) =>
        new Promise((resolve) => {
          ids.push(id)
          release = () => resolve({ success: false, error: 'x' })
        }),
      MESSAGES
    )
    release()
    await first
    const second = c.runAction(
      'comment',
      (_t: string, id: number) =>
        new Promise((resolve) => {
          ids.push(id)
          release = () => resolve({ success: true, text: 'done' })
        }),
      MESSAGES
    )
    assert.notEqual(ids[0], ids[1])
    c.actionPartial(ids[0], 'from the old stream')
    assert.equal(c.getState().streamText, '')
    c.actionPartial(ids[1], 'from the current one')
    assert.equal(c.getState().streamText, 'from the current one')
    release()
    await second
  })
})

describe('G5: a failure mid-stream keeps the text and offers Retry', () => {
  it('a failed translation keeps its partial text and can be retried', () => {
    const c = new ResultController()
    c.start()
    c.partial('Hola mu')
    c.complete({ success: false, errorCode: 'NETWORK', error: 'offline', partial: 'Hola mu' })
    const state = c.getState()
    assert.equal(state.result.partial, 'Hola mu')
    assert.equal(canRetry(state), true)
    assert.equal(canCopyText(state), false)
  })

  it('a failure the app made itself has nothing to retry', () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: false, error: 'Nothing to translate' })
    assert.equal(canRetry(c.getState()), false)
  })

  it('a failed action keeps its partial text and can be retried', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    await c.runAction(
      'comment',
      async () => ({ success: false, error: 'cut', partial: 'So far' }),
      MESSAGES
    )
    assert.equal(c.getState().result.partial, 'So far')
    assert.equal(c.getState().view, 'comment')
    assert.equal(canRetry(c.getState()), true)
  })
})

describe('the window grows with the text and never shrinks meanwhile', () => {
  it('asks for more height only when the text does not fit', () => {
    // 400 px window, 360 px scroll area (40 px title bar)
    assert.equal(heightToAsk(300, 360, 400), null)
    assert.equal(heightToAsk(360, 360, 400), null)
    assert.equal(heightToAsk(520, 360, 400), 560)
  })
})

type Stream = { onText?: (t: string) => void }

describe('main streams the translation into the result window', () => {
  const IMAGE = 'IMG'
  let calls: Array<{ image: string; hasStream: boolean }>
  let script: (stream: Stream) => Promise<unknown>

  const service = {
    translateScreenshot: async (image: string, _lang: string, stream?: Stream) => {
      calls.push({ image, hasStream: !!stream?.onText })
      return script(stream ?? {})
    },
    extractText: async () => ({ success: true, text: '' }),
    translateSpeech: async () => ({ success: true, text: '' }),
    commentText: async (_t: string, stream?: Stream) => {
      stream?.onText?.('Comm')
      stream?.onText?.('Comment')
      return { success: true, text: 'Comment' }
    },
    improveText: async () => ({ success: true, text: '' }),
    summarizeText: async () => ({ success: true, text: '' }),
    testKey: async () => ({ ok: true })
  }
  const select = (): unknown =>
    ipc.listeners.get('selection-made')!(trustedEvent, { x: 0, y: 0, width: 200, height: 100 })
  const channels = (): string[] => sentMessages.map((m) => m.channel)

  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    mediaAccess.screen = 'granted'
    setTranslationService(service)
  })

  beforeEach(() => {
    resetRecorded()
    registerCaptureHandlers({ fromOverlay: () => true, captureScreen: async () => IMAGE })
    registerResultHandlers()
    calls = []
  })

  it('retry with no earlier capture does nothing', async () => {
    await ipc.listeners.get('retry-translation')!(trustedEvent)
    assert.deepEqual(calls, [])
    assert.deepEqual(channels(), [])
  })

  it('partial texts go out in order, then the final result', async () => {
    script = async (stream) => {
      stream.onText?.('Ho')
      stream.onText?.('Hola')
      return { success: true, text: 'Hola' }
    }
    await select()
    const flow = sentMessages.filter((m) => m.channel.startsWith('translation-'))
    assert.deepEqual(
      flow.map((m) => m.channel),
      ['translation-start', 'translation-partial', 'translation-partial', 'translation-complete']
    )
    assert.deepEqual(
      flow.filter((m) => m.channel === 'translation-partial').map((m) => m.args[0]),
      ['Ho', 'Hola']
    )
  })

  it('a failure mid-stream sends the error with the text that had arrived', async () => {
    script = async (stream) => {
      stream.onText?.('Hola mu')
      return { success: false, errorCode: 'NETWORK', error: 'offline', partial: 'Hola mu' }
    }
    await select()
    const done = sentMessages.find((m) => m.channel === 'translation-complete')!
    assert.equal((done.args[0] as { partial: string }).partial, 'Hola mu')
    assert.equal((done.args[0] as { success: boolean }).success, false)
  })

  it('Retry translates the same picture again and streams it', async () => {
    script = async () => ({ success: false, errorCode: 'NETWORK', error: 'offline' })
    await select()
    sentMessages.length = 0
    calls = []
    script = async (stream) => {
      stream.onText?.('Hola')
      return { success: true, text: 'Hola' }
    }
    await ipc.listeners.get('retry-translation')!(trustedEvent)
    assert.deepEqual(calls, [{ image: IMAGE, hasStream: true }])
    assert.deepEqual(
      channels().filter((c) => c.startsWith('translation-')),
      ['translation-start', 'translation-partial', 'translation-complete']
    )
  })

  it('an AI action sends its text to the window that asked, as it arrives', async () => {
    const sent: unknown[][] = []
    const event = {
      ...trustedEvent,
      sender: { isDestroyed: () => false, send: (...args: unknown[]) => sent.push(args) }
    }
    const reply = await ipc.handlers.get('comment-text')!(event, 'some text', 7)
    assert.deepEqual(sent, [
      ['action-partial', { requestId: 7, text: 'Comm' }],
      ['action-partial', { requestId: 7, text: 'Comment' }]
    ])
    assert.equal(reply.text, 'Comment')
  })
})
