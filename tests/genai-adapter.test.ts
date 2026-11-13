/** The real SDK adapter, run against a stubbed fetch that returns a streamed body. */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  GeminiTranslationService,
  defaultModelFactory
} = require('../src/main/services/translation/gemini-service')

interface Seen {
  url: string
  headers: Headers
  body: Record<string, any>
  signal?: AbortSignal
}

const sse = (...events: unknown[]): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('')
const textChunk = (text: string, finishReason?: string, extra: object = {}) => ({
  candidates: [
    { content: { role: 'model', parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }
  ],
  ...extra
})

describe('defaultModelFactory against a stubbed fetch', () => {
  const realFetch = globalThis.fetch
  let seen: Seen[]
  let reply: () => string
  let contentType = 'text/event-stream'

  beforeEach(() => {
    seen = []
    contentType = 'text/event-stream'
    globalThis.fetch = (async (url: unknown, init: any) => {
      seen.push({
        url: String(url),
        headers: new Headers(init.headers),
        body: JSON.parse(init.body),
        signal: init.signal
      })
      return new Response(reply(), {
        status: 200,
        headers: { 'content-type': contentType }
      })
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const service = () =>
    new GeminiTranslationService({ getApiKey: () => 'k', maxAttempts: 1, deadlineMs: 4321 })

  it('streams the text, sends the deadline and an abort signal, and makes one request', async () => {
    reply = () => sse(textChunk('Hel'), textChunk('lo', 'STOP'))
    const seenText: string[] = []
    const result = await service().commentText('x', { onText: (t: string) => seenText.push(t) })
    assert.deepEqual(result, { success: true, text: 'Hello' })
    assert.deepEqual(seenText, ['Hel', 'Hello'])
    assert.equal(seen.length, 1)
    assert.match(seen[0].url, /:streamGenerateContent/)
    assert.equal(
      seen[0].headers.get('x-server-timeout'),
      '5',
      'httpOptions.timeout reaches the SDK (4321 ms, in whole seconds)'
    )
    assert.ok(seen[0].signal, 'an abort signal is attached to the request')
  })

  it('does not re-send the request when a reply ends with CONTINUATION (automaticContinuation: false)', async () => {
    reply = () =>
      sse({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'part' }] },
            finishReason: 'CONTINUATION',
            continuationToken: 'tok'
          }
        ]
      })
    await service().commentText('x')
    assert.equal(seen.length, 1)
  })

  it('a signal that is already aborted stops the request before it is sent on', async () => {
    reply = () => sse(textChunk('x', 'STOP'))
    globalThis.fetch = (async (_url: unknown, init: any) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response(reply(), { status: 200, headers: { 'content-type': contentType } })
    }) as typeof fetch
    const controller = new AbortController()
    controller.abort()
    const model = defaultModelFactory('k', 'm', { timeout: 60_000 })
    await assert.rejects(model.generateContentStream(['hi'], controller.signal), {
      name: 'AbortError'
    })
  })

  it('structured output carries the property order', async () => {
    reply = () => sse(textChunk('{"source":"a","translation":"b"}', 'STOP'))
    const result = await service().translateScreenshot('IMG', 'Spanish')
    assert.equal(result.success, true)
    const config = seen[0].body.generationConfig
    assert.equal(config.responseMimeType, 'application/json')
    assert.deepEqual(config.responseSchema.propertyOrdering, ['source', 'translation'])
  })

  it('a blocked prompt becomes BLOCKED', async () => {
    reply = () => sse({ promptFeedback: { blockReason: 'SAFETY' } })
    assert.equal((await service().commentText('x')).errorCode, 'BLOCKED')
  })

  it('a SAFETY finish with no text becomes BLOCKED', async () => {
    reply = () => sse({ candidates: [{ finishReason: 'SAFETY' }] })
    assert.equal((await service().commentText('x')).errorCode, 'BLOCKED')
  })

  it('the factory used without the service also reaches the stubbed fetch', async () => {
    contentType = 'application/json'
    reply = () => JSON.stringify(textChunk('ok', 'STOP'))
    const model = defaultModelFactory('k', 'm', { timeout: 1000 })
    const chunk = await model.generateContent(['hi'], new AbortController().signal)
    assert.equal(chunk.text, 'ok')
  })
})
