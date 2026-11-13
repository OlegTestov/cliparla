/** Batch 3 item 1: the dictation pill shows the text as it arrives; the paste stays one. */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetRecorded, sentMessages } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const { setRetryDelaysForTests } = require('../src/main/services/dictation/speech-retry')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  getDictationState
} = require('../src/main/services/dictation')
const { createRecorderController } = require('../src/renderer/src/listening/recorder-controller')

const AUDIO = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm', durationMs: 2000 }
const pillTexts = (): unknown[] =>
  sentMessages.filter((m) => m.channel === 'listening-mode-text').map((m) => m.args[0])
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

type Stream = { onText?: (text: string) => void; signal?: AbortSignal }

function scripted(run: (stream: Stream) => Promise<unknown>): FakeTranslationService {
  const service = new FakeTranslationService()
  service.translateSpeech = ((
    _a: string,
    _m: string,
    _l: string,
    _d?: number,
    _t?: number,
    stream?: Stream
  ) => run(stream ?? {})) as never
  setTranslationService(service)
  return service
}

describe('dictation streaming', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    setRetryDelaysForTests([])
    resetRecorded()
  })

  it('G6: the pill gets each text as it arrives and the paste happens once, with the final text', async () => {
    const pasted: string[] = []
    scripted(async (stream) => {
      stream.onText?.('Hel')
      stream.onText?.('Hello wor')
      assert.deepEqual(pasted, [], 'nothing is pasted while the text is still coming')
      return { success: true, text: 'Hello world' }
    })
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(AUDIO, { paste: async (t: string) => void pasted.push(t) })
    assert.deepEqual(pillTexts(), ['Hel', 'Hello wor'])
    assert.deepEqual(pasted, ['Hello world'])
    assert.equal(getDictationState(), 'idle')
  })

  it('G7: Esc during the stream cancels the request, shows nothing more and pastes nothing', async () => {
    const pasted: string[] = []
    let signal: AbortSignal | undefined
    let onText: ((t: string) => void) | undefined
    let finish: (r: unknown) => void = () => undefined
    scripted((stream) => {
      signal = stream.signal
      onText = stream.onText
      return new Promise((resolve) => (finish = resolve))
    })
    startDictation()
    stopListeningAndProcess()
    const done = handleDictationComplete(AUDIO, { paste: async (t: string) => void pasted.push(t) })
    await tick()
    onText?.('Hel')
    cancelDictation()
    assert.equal(signal?.aborted, true, 'the request itself is told to stop')
    onText?.('Hello late')
    finish({ success: true, text: 'Hello late' })
    await done
    assert.deepEqual(pillTexts(), ['Hel'])
    assert.deepEqual(pasted, [])
    assert.equal(getDictationState(), 'idle')
  })
})

describe('the pill shows the end of the text', () => {
  const { pillTail } = require('../src/shared/pill-text')
  const { readFileSync } = require('node:fs')

  it('keeps short text and cuts a long one from the start', () => {
    assert.equal(pillTail('Hello  world\n'), 'Hello world')
    const long = 'word '.repeat(40) + 'LAST'
    const tail = pillTail(long)
    assert.ok(tail.startsWith('…'))
    assert.ok(tail.endsWith('LAST'))
    assert.ok(Array.from(tail).length <= 61)
  })

  it('the page puts the ellipsis at the start of the line', () => {
    const page = readFileSync('src/renderer/src/listening/App.tsx', 'utf8')
    assert.match(page, /direction: 'rtl'/)
    assert.match(page, /<bdi>\{pillTail\(processingText\)\}<\/bdi>/)
  })
})

describe('the pill controller', () => {
  function pill() {
    const texts: string[] = []
    const controller = createRecorderController(
      {
        getUserMedia: async () => ({ getTracks: () => [] }),
        createRecorder: () => ({ state: 'inactive' }),
        blobToBase64: async () => '',
        sendAudio: () => undefined,
        recordingFailed: () => undefined,
        recordingStarted: () => undefined,
        t: (key: string) => key
      },
      {
        onMode: () => undefined,
        onError: () => undefined,
        onCountdown: () => undefined,
        onProcessingText: (text: string) => void texts.push(text)
      }
    )
    return { controller, texts }
  }

  it('shows text only while processing, and clears it at a retry and at the end', () => {
    const { controller, texts } = pill()
    controller.onProcessingText('too early')
    assert.deepEqual(texts, [])
    controller.onProcessing(false)
    controller.onProcessingText('Hel')
    controller.onProcessing(true) // a retry starts again
    controller.onProcessingText('Hello')
    controller.onStop()
    controller.onProcessingText('late')
    assert.deepEqual(texts, ['', 'Hel', '', 'Hello', ''])
  })
})
