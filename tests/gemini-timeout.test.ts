/**
 * A stalled provider request must end with a clear, retryable error instead of
 * leaving Test key or capture waiting forever.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, trustedEvent } from './helpers/electron-stub'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')

const neverAnswers = () => asModel({ generateContent: () => new Promise(() => undefined) })

function stalled(deadlineMs = 25) {
  return new GeminiTranslationService({
    getApiKey: () => 'k',
    modelFactory: neverAnswers,
    maxAttempts: 2,
    deadlineMs,
    testDeadlineMs: deadlineMs
  })
}

describe('speech deadline scales with the audio', () => {
  const seenTimeouts = (): { svc: any; seen: number[] } => {
    const seen: number[] = []
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      modelFactory: (_k: string, _m: string, o: { timeout: number }) => {
        seen.push(o.timeout)
        return asModel({ generateContent: async () => ({ response: { text: () => 'ok' } }) })
      }
    })
    return { svc, seen }
  }

  it('is 30 s plus 0.25 s per second of audio: 75 s for 180 s', async () => {
    const { svc, seen } = seenTimeouts()
    await svc.translateSpeech('A', 'audio/webm', 'English', 180_000)
    await svc.translateSpeech('A', 'audio/webm', 'English', 10_000)
    assert.deepEqual(seen, [75_000, 32_500])
  })

  it('screenshots and text keep 30 s', async () => {
    const { svc, seen } = seenTimeouts()
    await svc.translateScreenshot('IMG', 'English')
    await svc.commentText('x')
    assert.deepEqual(seen, [30_000, 30_000])
  })

  it('also bounds the whole speech request including the retry', async () => {
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      modelFactory: neverAnswers,
      maxAttempts: 2,
      deadlineMs: 20
    })
    const started = Date.now()
    const result = await svc.translateSpeech('A', 'audio/webm', 'English', 200)
    assert.equal(result.errorCode, 'TIMEOUT')
    assert.ok(Date.now() - started >= 60, 'waited the 20 ms base plus 50 ms for the audio')
  })
})

describe('provider deadlines', () => {
  it('translation requests fail with TIMEOUT and a retry hint', async () => {
    const started = Date.now()
    const result = await stalled().translateScreenshot('IMG', 'English')
    assert.equal(result.success, false)
    assert.equal(result.errorCode, 'TIMEOUT')
    assert.match(result.error, /try again/i)
    assert.ok(Date.now() - started < 1000)
  })

  it('every action is bounded', async () => {
    const svc = stalled()
    const results = await Promise.all([
      svc.translateSpeech('A', 'audio/webm', 'English'),
      svc.commentText('x'),
      svc.improveText('x'),
      svc.summarizeText('x')
    ])
    assert.ok(results.every((r) => r.errorCode === 'TIMEOUT'))
  })

  it('Test key ends with TIMEOUT instead of waiting forever', async () => {
    const result = await stalled().testKey('candidate')
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'TIMEOUT')
  })

  it('the SDK request is also given the deadline so the socket is aborted', async () => {
    let seen: unknown
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      deadlineMs: 4321,
      modelFactory: (_key: string, _model: string, requestOptions: unknown) => {
        seen = requestOptions
        return asModel({ generateContent: async () => ({ response: { text: () => 'ok' } }) })
      }
    })
    await svc.commentText('x')
    assert.deepEqual(seen, { timeout: 4321 })
  })

  it('a stalled capture does not block the next one', async () => {
    const svc = stalled(25)
    let calls = 0
    const original = svc.translateScreenshot.bind(svc)
    svc.translateScreenshot = (...args: unknown[]) => {
      calls++
      return original(...args)
    }
    setTranslationService(svc)
    registerCaptureHandlers({
      fromOverlay: () => true,
      captureScreen: async () => 'IMG',
      showSetup: () => undefined
    })
    for (let i = 0; i < 2; i++) {
      await ipc.listeners.get('selection-made')!(trustedEvent, {
        x: 0,
        y: 0,
        width: 200,
        height: 100
      })
    }
    assert.equal(calls, 2)
  })
})
