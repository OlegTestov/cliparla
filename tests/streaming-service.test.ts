/** Batch 3 item 1: the service streams text to the caller as it arrives. */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { streamingModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { partialTranslation } = require('../src/shared/structured-translation')
const { classifyError } = require('../src/main/services/translation/errors')

function service(model: () => unknown, extra: Record<string, unknown> = {}) {
  return new GeminiTranslationService({
    getApiKey: () => 'k',
    maxAttempts: 2,
    modelFactory: model,
    ...extra
  })
}

const json = (source: string, translation: string): string =>
  JSON.stringify({ source, translation })

describe('partialTranslation reads the translation from unfinished JSON', () => {
  it('shows nothing until the translation key has started', () => {
    assert.equal(partialTranslation(''), null)
    assert.equal(partialTranslation('{"source":"Hel'), null)
    assert.equal(partialTranslation('{"source":"Hello","translation":"'), null)
  })

  it('grows with the text and stops at the closing quote', () => {
    const full = json('Hello', 'Hola "amigo"\nbien')
    const seen = new Set<string | null>()
    for (let i = 1; i <= full.length; i++) seen.add(partialTranslation(full.slice(0, i)))
    assert.ok(seen.has('Hola'))
    assert.equal(partialTranslation(full), 'Hola "amigo"\nbien')
  })

  it('never shows half an escape and decodes unicode escapes', () => {
    assert.equal(partialTranslation('{"translation":"a\\'), 'a')
    assert.equal(partialTranslation('{"translation":"a\\u00'), 'a')
    assert.equal(partialTranslation('{"translation":"caf\\u00e9"}'), 'café')
  })

  it('a source that mentions the key does not confuse it', () => {
    const full = json('say "translation": "x"', 'Hola')
    assert.equal(partialTranslation(full), 'Hola')
  })

  it('a reply that is not JSON is shown as it is', () => {
    assert.equal(partialTranslation('  Just text  '), 'Just text')
  })

  it('reads a fenced JSON reply', () => {
    assert.equal(partialTranslation('```json\n{"translation":"Hi'), 'Hi')
  })
})

describe('G4: chunks reach the caller in order', () => {
  it('a text action reports the text so far after every chunk', async () => {
    const seen: string[] = []
    const svc = service(() => streamingModel([{ text: 'Hel' }, { text: 'lo ' }, { text: 'world' }]))
    const result = await svc.commentText('x', { onText: (t: string) => seen.push(t) })
    assert.deepEqual(seen, ['Hel', 'Hel' + 'lo', 'Hello world'])
    assert.deepEqual(result, { success: true, text: 'Hello world' })
  })

  it('a screen translation streams the translation field and returns the parsed result', async () => {
    const full = json('Hello', 'Hola mundo')
    const cut = full.indexOf('Hola') + 4
    const seen: string[] = []
    const svc = service(() =>
      streamingModel([
        { text: full.slice(0, 12) },
        { text: full.slice(12, cut) },
        { text: full.slice(cut) }
      ])
    )
    const result = await svc.translateScreenshot('IMG', 'Spanish', {
      onText: (t: string) => seen.push(t)
    })
    assert.deepEqual(seen, ['Hola', 'Hola mundo'])
    assert.deepEqual(result, { success: true, text: 'Hola mundo', source: 'Hello' })
  })

  it('the speech marker for "nobody spoke" is never shown', async () => {
    const seen: string[] = []
    const svc = service(() => streamingModel([{ text: '[No sp' }, { text: 'eech detected]' }]))
    const result = await svc.translateSpeech('A', 'audio/webm', 'English', 100, undefined, {
      onText: (t: string) => seen.push(t)
    })
    assert.deepEqual(seen, [])
    assert.equal(result.noSpeech, true)
  })
})

describe('G5: a failure mid-stream keeps what arrived', () => {
  it('returns the error with the partial text', async () => {
    const seen: string[] = []
    const svc = service(() =>
      streamingModel([{ text: 'Hola ' }, { text: 'mun' }], new TypeError('fetch failed'))
    )
    const result = await svc.commentText('x', { onText: (t: string) => seen.push(t) })
    assert.equal(result.success, false)
    assert.equal(result.errorCode, 'NETWORK')
    assert.equal(result.partial, 'Hola mun')
    assert.deepEqual(seen, ['Hola', 'Hola mun'])
  })

  it('is not retried once text has arrived (a retry would repeat it)', async () => {
    let opens = 0
    const svc = service(() => ({
      generateContent: async () => ({}),
      generateContentStream: async () => {
        opens++
        return streamingModel(
          [{ text: 'A' }],
          new TypeError('fetch failed')
        ).generateContentStream()
      }
    }))
    const result = await svc.commentText('x')
    assert.equal(result.success, false)
    assert.equal(opens, 1)
  })

  it('is retried while nothing has arrived yet', async () => {
    let opens = 0
    const svc = service(() => ({
      generateContent: async () => ({}),
      generateContentStream: async () => {
        opens++
        if (opens === 1) throw new TypeError('fetch failed')
        return streamingModel([{ text: 'fine' }]).generateContentStream()
      }
    }))
    const result = await svc.commentText('x')
    assert.deepEqual(result, { success: true, text: 'fine' })
    assert.equal(opens, 2)
  })

  it('a failure before any text has no partial', async () => {
    const svc = service(() => streamingModel([], new TypeError('fetch failed')), { maxAttempts: 1 })
    const result = await svc.commentText('x')
    assert.equal('partial' in result, false)
  })
})

describe('retry is decided by the HTTP status first', () => {
  const failing = (error: Error) => {
    let opens = 0
    const svc = service(() => ({
      generateContent: async () => ({}),
      generateContentStream: async () => {
        opens++
        if (opens === 1) throw error
        return streamingModel([{ text: 'fine' }]).generateContentStream()
      }
    }))
    return { svc, opens: () => opens }
  }
  const apiError = (status: number): Error =>
    Object.assign(new Error(JSON.stringify({ error: { code: status, message: 'x' } })), { status })

  for (const status of [500, 503, 429]) {
    it(`${status} is retried once`, async () => {
      const { svc, opens } = failing(apiError(status))
      assert.equal((await svc.commentText('x')).success, true)
      assert.equal(opens(), 2)
    })
  }

  // Google's body names the quota that ran out; a per-day quota will not recover in seconds
  const quotaError = (quotaId: string): Error =>
    Object.assign(
      new Error(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'You exceeded your current quota.',
            details: [{ violations: [{ quotaId }] }]
          }
        })
      ),
      { status: 429 }
    )

  it('a 429 for the per-day quota is not retried and says the limit is daily', async () => {
    const { svc, opens } = failing(quotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier'))
    const result = await svc.commentText('x')
    assert.equal(result.success, false)
    assert.equal(result.errorCode, 'QUOTA_DAILY')
    assert.match(result.error, /daily/i)
    assert.equal(opens(), 1)
  })

  it('a 429 listing both a per-minute and a per-day quota is not called daily', async () => {
    const error = Object.assign(
      new Error(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                violations: [
                  { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' },
                  { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }
                ]
              }
            ]
          }
        })
      ),
      { status: 429 }
    )
    const result = classifyError(error)
    assert.equal(result.errorCode, 'QUOTA_EXHAUSTED')
    assert.doesNotMatch(result.error, /tomorrow/i)
  })

  it('a 400 saying the location is not supported gets its own message', async () => {
    const error = Object.assign(
      new Error(
        JSON.stringify({
          error: { code: 400, message: 'User location is not supported for the API use.' }
        })
      ),
      { status: 400 }
    )
    const { svc, opens } = failing(error)
    const result = await svc.commentText('x')
    assert.equal(result.errorCode, 'LOCATION_UNSUPPORTED')
    assert.match(result.error, /location|region|country/i)
    assert.equal(opens(), 1)
  })

  it('a 429 for a per-minute quota is still retried', async () => {
    const { svc, opens } = failing(
      quotaError('GenerateRequestsPerMinutePerProjectPerModel-FreeTier')
    )
    assert.equal((await svc.commentText('x')).success, true)
    assert.equal(opens(), 2)
  })

  for (const status of [400, 401, 403, 404]) {
    it(`${status} is not retried`, async () => {
      const { svc, opens } = failing(apiError(status))
      assert.equal((await svc.commentText('x')).success, false)
      assert.equal(opens(), 1)
    })
  }
})

describe('cancelling', () => {
  it("the caller's signal reaches the model and stops further text", async () => {
    const outer = new AbortController()
    let inner: AbortSignal | undefined
    const seen: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const svc = service(() => ({
      generateContent: async () => ({}),
      generateContentStream: async (_p: unknown, signal: AbortSignal) => {
        inner = signal
        return (async function* () {
          yield { text: 'first' }
          await gate
          yield { text: ' second' }
        })()
      }
    }))
    const pending = svc.commentText('x', {
      signal: outer.signal,
      onText: (t: string) => seen.push(t)
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    outer.abort()
    assert.equal(inner?.aborted, true)
    release()
    await pending
    assert.deepEqual(seen, ['first'])
  })

  it('an already aborted signal reaches the model aborted', async () => {
    const outer = new AbortController()
    outer.abort()
    let inner: AbortSignal | undefined
    const svc = service(() => ({
      generateContent: async () => ({}),
      generateContentStream: async (_p: unknown, signal: AbortSignal) => {
        inner = signal
        return streamingModel([{ text: 'x' }]).generateContentStream()
      }
    }))
    await svc.commentText('x', { signal: outer.signal })
    assert.equal(inner?.aborted, true)
  })
})
