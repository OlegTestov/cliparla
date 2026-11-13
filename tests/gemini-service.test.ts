import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { classifyError, isDailyQuota } = require('../src/main/services/translation/errors')
const { GEMINI_MODEL } = require('../src/shared/gemini-constants')

type Call = { key: string; model: string; parts: unknown[] }

function fakeFactory(reply: string | Error, calls: Call[] = []) {
  return (key: string, model: string) =>
    asModel({
      generateContent: async (parts: unknown[]) => {
        calls.push({ key, model, parts })
        if (reply instanceof Error) throw reply
        return { response: { text: () => reply } }
      }
    })
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

function service(reply: string | Error, getApiKey = () => 'user-key', calls: Call[] = []) {
  return new GeminiTranslationService({
    getApiKey,
    modelFactory: fakeFactory(reply, calls),
    maxAttempts: 1
  })
}

describe('GeminiTranslationService', () => {
  it('translates with the user key and the single configured model', async () => {
    const calls: Call[] = []
    const result = await service('  Hola  ', () => 'user-key', calls).translateScreenshot(
      'IMG',
      'Spanish'
    )
    assert.deepEqual(result, { success: true, text: 'Hola' })
    assert.equal(calls[0].key, 'user-key')
    assert.equal(calls[0].model, GEMINI_MODEL)
    assert.ok(String(calls[0].parts[0]).includes('Spanish'))
  })

  it('reads the key on every call, so a replaced key applies immediately', async () => {
    const calls: Call[] = []
    let key = 'first'
    const svc = service('ok', () => key, calls)
    await svc.commentText('a')
    key = 'second'
    await svc.commentText('b')
    assert.deepEqual(
      calls.map((c) => c.key),
      ['first', 'second']
    )
  })

  it('a missing key fails with MISSING_KEY and never contacts the provider', async () => {
    const calls: Call[] = []
    const svc = service('ok', () => '', calls)
    for (const result of [
      await svc.translateScreenshot('IMG', 'English'),
      await svc.translateSpeech('AUDIO', 'audio/webm', 'English'),
      await svc.commentText('x'),
      await svc.improveText('x'),
      await svc.summarizeText('x')
    ]) {
      assert.equal(result.success, false)
      assert.equal(result.errorCode, 'MISSING_KEY')
      assert.match(result.error, /API key/)
    }
    assert.equal(calls.length, 0)
  })

  it('maps provider failures to actionable messages', async () => {
    const cases: Array<[Error, string, RegExp]> = [
      [
        httpError(400, '[400 Bad Request] API key not valid. Please pass a valid API key.'),
        'INVALID_KEY',
        /Test key/
      ],
      [httpError(403, 'PERMISSION_DENIED'), 'INVALID_KEY', /key/],
      [httpError(429, 'RESOURCE_EXHAUSTED quota'), 'QUOTA_EXHAUSTED', /Wait a minute/],
      [new Error('fetch failed'), 'NETWORK', /internet/],
      [new Error('Response was blocked due to SAFETY'), 'BLOCKED', /safety/]
    ]
    for (const [error, code, message] of cases) {
      const result = await service(error).translateScreenshot('IMG', 'English')
      assert.equal(result.errorCode, code, error.message)
      assert.match(result.error, message)
      assert.ok(!result.error.includes('user-key'))
    }
  })

  it('treats an empty reply as a failure with a reason', async () => {
    const result = await service('   ').translateScreenshot('IMG', 'English')
    assert.equal(result.success, false)
    assert.match(result.error, /No text/)
  })

  it('speech marked as silent becomes an error', async () => {
    const result = await service('[No speech detected]').translateSpeech(
      'A',
      'audio/webm',
      'English'
    )
    assert.equal(result.success, false)
    assert.match(result.error, /No speech/)
  })

  it('validates inputs without calling the provider', async () => {
    const calls: Call[] = []
    const svc = service('ok', () => 'user-key', calls)
    assert.equal((await svc.translateScreenshot('', 'English')).success, false)
    assert.equal((await svc.translateScreenshot('IMG', '')).success, false)
    assert.equal((await svc.translateSpeech('A', '', 'English')).success, false)
    assert.equal((await svc.commentText('  ')).success, false)
    assert.equal(calls.length, 0)
  })

  it('testKey checks the candidate key and reports what to do', async () => {
    const calls: Call[] = []
    assert.deepEqual(await service('OK', () => 'stored', calls).testKey('candidate'), { ok: true })
    assert.equal(calls[0].key, 'candidate')

    const bad = await service(httpError(400, 'API key not valid')).testKey('candidate')
    assert.equal(bad.ok, false)
    assert.equal(bad.errorCode, 'INVALID_KEY')

    const none = await service('OK').testKey('  ')
    assert.equal(none.errorCode, 'MISSING_KEY')
  })
})

describe('classifyError', () => {
  it('falls back to UNKNOWN with a retry hint', () => {
    const result = classifyError(new Error('boom'))
    assert.equal(result.errorCode, 'UNKNOWN')
    assert.match(result.error, /try again/i)
  })

  it("the SDK's abort error (its own request timeout) is a TIMEOUT", () => {
    const error = new DOMException('This operation was aborted', 'AbortError')
    assert.equal(classifyError(error).errorCode, 'TIMEOUT')
  })

  const body = (...ids: string[]): string =>
    JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: ids.map((quotaId) => ({ quotaId, quotaValue: '0' }))
          }
        ]
      }
    })
  const DAY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
  const MINUTE = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'

  it('a 429 listing both a per-minute and a per-day limit is not told "resets tomorrow"', () => {
    const error = httpError(429, body(MINUTE, DAY))
    const result = classifyError(error)
    assert.equal(result.errorCode, 'QUOTA_EXHAUSTED')
    assert.doesNotMatch(result.error, /tomorrow/i)
    assert.equal(isDailyQuota(error), false)
  })

  it('a 429 with only the per-day limit is the daily message, and is not retried', () => {
    const error = httpError(429, body(DAY))
    assert.equal(classifyError(error).errorCode, 'QUOTA_DAILY')
    assert.equal(isDailyQuota(error), true)
  })

  it('a 429 with only the per-minute limit is the short wait message', () => {
    assert.equal(classifyError(httpError(429, body(MINUTE))).errorCode, 'QUOTA_EXHAUSTED')
  })
})
