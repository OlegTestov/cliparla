/**
 * A speech request that fails is sent again after 1 s, then after 3 s, then the card with Retry
 * stays. The audio is never lost, Esc stops the retries, and the whole thing has a cap.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resetRecorded, sentMessages } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  retryDictation,
  getDictationState
} = require('../src/main/services/dictation')
const { keptAudio } = require('../src/main/services/dictation/kept-audio')
const { isRetryable } = require('../src/main/services/dictation/speech-retry')
const {
  PROCESSING_LIMIT_MS,
  clearWatchdogForTests
} = require('../src/main/services/dictation/watchdog')
const { resetEscapeShortcutForTests } = require('../src/main/services/dictation/escape-shortcut')
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const {
  BASE_DEADLINE_MS,
  SPEECH_RETRY_EXTRA_MS,
  speechDeadlineMs
} = require('../src/shared/gemini-constants')
const { MAX_RECORDING_DURATION } = require('../src/shared/recording-limits')

type Outcome = {
  noSpeech?: boolean
  success: boolean
  text?: string
  errorCode?: string
  error?: string
}
const fail = (errorCode: string): Outcome => ({ success: false, errorCode, error: errorCode })
const ok = (text: string): Outcome => ({ success: true, text })

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm', durationMs: 4000 }
const FIRST_DEADLINE = speechDeadlineMs(BASE_DEADLINE_MS, 4000) // 31 s

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms)
  await flush()
  await flush()
}
const cards = (): Array<{ message: string; retry: boolean }> =>
  sentMessages.filter((m) => m.channel === 'listening-mode-error').map((m) => m.args[0] as never)
const waitingMessages = (): number =>
  sentMessages.filter((m) => m.channel === 'listening-mode-processing' && m.args[0] === true).length

/** Answers from a script; an attempt takes `latencyMs` of (mocked) time and is recorded. */
class ScriptedService extends FakeTranslationService {
  attempts: Array<{ at: number; deadline: number }> = []
  constructor(
    private readonly script: Outcome[],
    private readonly latencyMs = 0
  ) {
    super()
  }
  translateSpeech(
    _audio: string,
    _mime: string,
    _language: string,
    _duration?: number,
    deadline?: number
  ): Promise<never> {
    this.attempts.push({ at: Date.now(), deadline: deadline ?? -1 })
    const result = this.script[Math.min(this.attempts.length, this.script.length) - 1]
    if (!this.latencyMs) return Promise.resolve(result as never)
    return new Promise((resolve) =>
      setTimeout(() => resolve(result as never), this.latencyMs)
    ) as Promise<never>
  }
}

const pasted: string[] = []
const deps = { paste: async (text: string) => void pasted.push(text) }
let t0 = 0
const relative = (s: ScriptedService): number[] => s.attempts.map((a) => a.at - t0)

async function dictate(service: ScriptedService, showSetup?: () => void): Promise<void> {
  setTranslationService(service)
  startDictation()
  stopListeningAndProcess()
  void handleDictationComplete(audio, { ...deps, showSetup })
  await flush()
}

const realPlatform = process.platform
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  cancelDictation()
  resetRecorded()
  resetEscapeShortcutForTests()
  pasted.length = 0
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  t0 = Date.now()
})
afterEach(() => {
  cancelDictation()
  mock.timers.reset()
  clearWatchdogForTests()
  Object.defineProperty(process, 'platform', { value: realPlatform })
})

describe('retry decision per error code', () => {
  const table: Array<[string, boolean]> = [
    ['NETWORK', true],
    ['TIMEOUT', true],
    ['QUOTA_EXHAUSTED', true], // HTTP 429 rate limits pass within seconds
    ['UNKNOWN', true], // 5xx and an empty reply
    ['QUOTA_DAILY', false], // the daily limit resets tomorrow, not in seconds
    ['MISSING_KEY', false],
    ['INVALID_KEY', false],
    ['BLOCKED', false],
    ['INVALID_REQUEST', false]
  ]
  for (const [code, retry] of table)
    it(`${code}: ${retry ? 'retried' : 'not retried'}`, () => {
      assert.equal(isRetryable(fail(code)), retry)
    })

  it('a success is never retried', () => {
    assert.equal(isRetryable(ok('x')), false)
  })
})

describe('the schedule', () => {
  it('three attempts at 0, +1 s and +3 s after the previous failure, then the card with Retry', async () => {
    const service = new ScriptedService([fail('NETWORK')])
    await dictate(service)
    assert.deepEqual(relative(service), [0])
    await advance(999)
    assert.equal(service.attempts.length, 1)
    await advance(1)
    assert.deepEqual(relative(service), [0, 1000])
    await advance(2999)
    assert.equal(service.attempts.length, 2)
    assert.equal(cards().length, 0)
    await advance(1)
    assert.deepEqual(relative(service), [0, 1000, 4000])
    await advance(60_000)
    assert.equal(service.attempts.length, 3, 'no fourth attempt')
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, true)
    assert.ok(keptAudio(), 'the audio is kept for Retry')
    assert.deepEqual(pasted, [])
    assert.equal(getDictationState(), 'idle')
  })

  it('the pill says it is retrying while it waits', async () => {
    await dictate(new ScriptedService([fail('NETWORK')]))
    await advance(0)
    assert.equal(waitingMessages(), 1)
  })

  it('success on the 2nd attempt pastes once and stops', async () => {
    const service = new ScriptedService([fail('TIMEOUT'), ok('SECOND')])
    await dictate(service)
    await advance(1000)
    await advance(100)
    assert.equal(service.attempts.length, 2)
    assert.deepEqual(pasted, ['SECOND'])
    await advance(60_000)
    assert.equal(service.attempts.length, 2)
    assert.deepEqual(pasted, ['SECOND'])
    assert.equal(cards().length, 0)
    assert.equal(keptAudio(), null)
  })

  it('success on the 3rd attempt pastes once', async () => {
    const service = new ScriptedService([fail('NETWORK'), fail('UNKNOWN'), ok('THIRD')])
    await dictate(service)
    await advance(1000)
    await advance(3000)
    await advance(100)
    assert.equal(service.attempts.length, 3)
    assert.deepEqual(pasted, ['THIRD'])
    assert.equal(cards().length, 0)
  })

  for (const code of ['BLOCKED', 'INVALID_REQUEST']) {
    it(`${code}: one attempt, no retry`, async () => {
      const service = new ScriptedService([fail(code), ok('NEVER')])
      await dictate(service)
      await advance(60_000)
      assert.equal(service.attempts.length, 1)
      assert.equal(cards().length, 1)
      assert.deepEqual(pasted, [])
      assert.equal(waitingMessages(), 0)
    })
  }

  it('the model hearing no speech: one attempt, the audio is kept, card with Retry', async () => {
    const service = new ScriptedService([
      { ...fail('INVALID_REQUEST'), noSpeech: true },
      ok('NEVER')
    ])
    await dictate(service)
    await advance(60_000)
    assert.equal(service.attempts.length, 1)
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, true)
    assert.ok(keptAudio())
  })

  it('a malformed request (HTTP 400): no Retry, the audio is not kept', async () => {
    const service = new ScriptedService([fail('INVALID_REQUEST')])
    await dictate(service)
    await advance(60_000)
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, false)
    assert.equal(keptAudio(), null)
  })

  it("the service marks the model's no-speech reply and only that", async () => {
    const make = (text: string, status?: number) =>
      new GeminiTranslationService({
        getApiKey: () => 'k',
        modelFactory: () =>
          asModel({
            generateContent: async () => {
              if (status) throw Object.assign(new Error('bad'), { status })
              return { response: { text: () => text } }
            }
          })
      })
    const silent = await make('[No speech detected]').translateSpeech('A', 'audio/webm', 'English')
    assert.equal(silent.noSpeech, true)
    assert.equal(silent.errorCode, 'INVALID_REQUEST')
    const bad = await make('', 400).translateSpeech('A', 'audio/webm', 'English')
    assert.equal(bad.errorCode, 'INVALID_REQUEST')
    assert.equal(bad.noSpeech, undefined)
  })

  it('a rejected key: one attempt, setup opens, the card keeps the audio', async () => {
    const shown: string[] = []
    const service = new ScriptedService([fail('INVALID_KEY'), ok('NEVER')])
    await dictate(service, () => void shown.push('setup'))
    await advance(60_000)
    assert.equal(service.attempts.length, 1)
    assert.deepEqual(shown, ['setup'])
    assert.ok(keptAudio())
  })
})

describe('Esc', () => {
  it('during the wait: no further attempt, no paste, no card', async () => {
    const service = new ScriptedService([fail('NETWORK'), ok('LATE')])
    await dictate(service)
    await advance(500)
    cancelDictation()
    await advance(60_000)
    assert.equal(service.attempts.length, 1)
    assert.deepEqual(pasted, [])
    assert.equal(cards().length, 0)
    assert.equal(keptAudio(), null, 'a deliberate cancel drops the audio')
    assert.equal(getDictationState(), 'idle')
  })

  it('during the second wait stops the third attempt', async () => {
    const service = new ScriptedService([fail('NETWORK')])
    await dictate(service)
    await advance(1000)
    await advance(1500)
    cancelDictation()
    await advance(60_000)
    assert.equal(service.attempts.length, 2)
    assert.equal(cards().length, 0)
  })

  it('a newer dictation is not touched by the old one still waiting', async () => {
    const first = new ScriptedService([fail('NETWORK')])
    await dictate(first)
    await advance(500)
    cancelDictation()
    const second = new ScriptedService([ok('NEW')])
    await dictate(second)
    await advance(60_000)
    assert.equal(first.attempts.length, 1)
    assert.deepEqual(pasted, ['NEW'])
  })
})

describe('the cap and the deadlines', () => {
  it('each attempt has its own deadline; the cap is the first deadline plus 20 s', async () => {
    // Every attempt runs to its deadline and times out
    const service = new (class extends ScriptedService {
      translateSpeech(a: string, m: string, l: string, d?: number, deadline?: number) {
        this.attempts.push({ at: Date.now(), deadline: deadline ?? -1 })
        return new Promise((resolve) =>
          setTimeout(() => resolve(fail('TIMEOUT') as never), deadline)
        ) as Promise<never>
      }
    })([])
    await dictate(service)
    await advance(FIRST_DEADLINE)
    await advance(1000)
    await advance(SPEECH_RETRY_EXTRA_MS - 1000)
    assert.deepEqual(
      service.attempts.map((a) => a.deadline),
      [FIRST_DEADLINE, SPEECH_RETRY_EXTRA_MS - 1000]
    )
    assert.equal(service.attempts.length, 2, 'the cap leaves no room for the third')
    assert.ok(Date.now() - t0 <= FIRST_DEADLINE + SPEECH_RETRY_EXTRA_MS)
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, true)
    assert.ok(keptAudio())
    assert.equal(getDictationState(), 'idle')
  })

  it('no retry when too little of the cap would be left for it', async () => {
    // Attempt 1 fails just before its deadline, attempt 2 after 12 s: 20 - 1 - 12 - 3 < 5 s left
    const lags = [FIRST_DEADLINE - 100, 12_000]
    const service = new (class extends ScriptedService {
      translateSpeech(a: string, m: string, l: string, d?: number, deadline?: number) {
        const lag = lags[this.attempts.length] ?? 0
        this.attempts.push({ at: Date.now(), deadline: deadline ?? -1 })
        return new Promise((resolve) =>
          setTimeout(() => resolve(fail('UNKNOWN') as never), lag)
        ) as Promise<never>
      }
    })([])
    await dictate(service)
    await advance(FIRST_DEADLINE - 100)
    await advance(1000)
    await advance(12_000)
    await advance(3000)
    assert.equal(service.attempts.length, 2, 'the third attempt would get under 5 s')
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, true)
    assert.ok(keptAudio())
  })

  it('the watchdog limit is beyond the longest retry run, so it cannot fire first', () => {
    const longest =
      speechDeadlineMs(BASE_DEADLINE_MS, MAX_RECORDING_DURATION * 1000) + SPEECH_RETRY_EXTRA_MS
    assert.ok(PROCESSING_LIMIT_MS > longest)
  })

  it('a full retry run ends in the card before the watchdog could act', async () => {
    const service = new ScriptedService([fail('NETWORK')])
    await dictate(service)
    await advance(1000)
    await advance(3000)
    assert.equal(cards().length, 1)
    assert.ok(Date.now() - t0 < PROCESSING_LIMIT_MS)
    assert.ok(keptAudio())
  })

  it('the service honours the deadline it is given and makes a single attempt', async () => {
    const seen: number[] = []
    let calls = 0
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 2,
      modelFactory: (_k: string, _m: string, o: { timeout: number }) => {
        seen.push(o.timeout)
        return asModel({
          generateContent: async () => {
            calls++
            throw Object.assign(new Error('fetch failed'), { status: 503 })
          }
        })
      }
    })
    const result = await svc.translateSpeech('A', 'audio/webm', 'English', 4000, 12_345)
    assert.deepEqual(seen, [12_345])
    assert.equal(calls, 1)
    assert.equal(result.success, false)
  })
})

describe('manual Retry', () => {
  it('runs the same schedule', async () => {
    const service = new ScriptedService([fail('NETWORK')])
    await dictate(service)
    await advance(1000)
    await advance(3000)
    assert.equal(service.attempts.length, 3)
    assert.equal(cards().length, 1)

    const before = Date.now()
    service.attempts = []
    retryDictation(deps)
    await flush()
    await advance(1000)
    await advance(3000)
    await advance(100)
    assert.deepEqual(
      service.attempts.map((a) => a.at - before),
      [0, 1000, 4000]
    )
    assert.equal(cards().length, 2)
    assert.equal(cards()[1].retry, true)
    assert.ok(keptAudio())
  })

  it('succeeds on a later attempt of the retry and pastes once', async () => {
    const failing = new ScriptedService([fail('NETWORK')])
    await dictate(failing)
    await advance(1000)
    await advance(3000)
    const recovering = new ScriptedService([fail('TIMEOUT'), ok('BACK')])
    setTranslationService(recovering)
    retryDictation(deps)
    await flush()
    await advance(1000)
    await advance(100)
    assert.deepEqual(pasted, ['BACK'])
    assert.equal(keptAudio(), null)
  })
})
