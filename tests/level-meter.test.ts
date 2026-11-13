/**
 * The page's level meter must not pass a verdict it cannot back: a suspended audio context or
 * too little of the recording read means "no result" (the clip is sent), and the context is
 * always closed.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { startLevelMeter } = require('../src/renderer/src/listening/level-meter')

interface Fake {
  state: string
  closed: number
  fill: number
  /** audio clock stands still (no frames processed) */
  frozen: boolean
}
let fake: Fake
let failOn: 'analyser' | 'source' | null

class FakeAudioContext {
  sampleRate = 48000
  constructor() {
    this.state = fake.state
    contexts.push(this)
  }
  state: string
  private audioS = clock / 1000
  get currentTime(): number {
    if (!fake.frozen) this.audioS = clock / 1000
    return this.audioS
  }
  close(): Promise<void> {
    fake.closed++
    return Promise.resolve()
  }
  createAnalyser() {
    if (failOn === 'analyser') throw new Error('no analyser')
    return {
      fftSize: 0,
      getFloatTimeDomainData: (frame: Float32Array) => frame.fill(fake.fill)
    }
  }
  createMediaStreamSource() {
    if (failOn === 'source') throw new Error('no source')
    return { connect: () => undefined }
  }
}
const contexts: FakeAudioContext[] = []

let clock = 0
const now = (): number => clock
const advance = (ms: number, step = 40): void => {
  for (let t = 0; t < ms; t += step) {
    clock += step
    mock.timers.tick(step)
  }
}

beforeEach(() => {
  fake = { state: 'running', closed: 0, fill: 0.1, frozen: false }
  failOn = null
  clock = 1000
  contexts.length = 0
  mock.timers.enable({ apis: ['setInterval'] })
  ;(globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext
})
afterEach(() => {
  mock.timers.reset()
  delete (globalThis as { AudioContext?: unknown }).AudioContext
})

const start = () => startLevelMeter({} as MediaStream, now)

describe('level meter', () => {
  it('reports the level of a running context', () => {
    const meter = start()
    advance(1000)
    const level = meter.result()
    assert.ok(level.peak > 0.09)
    assert.ok(level.activeMs >= 900, `active ${level.activeMs}`)
    meter.stop()
  })

  it('a context that was not running gives no result (suspended, e.g. AirPods connecting)', () => {
    fake.state = 'suspended'
    const meter = start()
    advance(1000)
    assert.equal(meter.result(), null)
    meter.stop()
  })

  it('a context that stopped running mid-recording gives no result', () => {
    const meter = start()
    advance(400)
    contexts[0].state = 'interrupted'
    advance(400)
    contexts[0].state = 'running'
    advance(400)
    assert.equal(meter.result(), null)
    meter.stop()
  })

  it('under 60% of the recording read gives no result', () => {
    const meter = start()
    advance(1000, 400) // timers throttled: each read covers only one analyser window
    assert.equal(meter.result(), null)
    meter.stop()
  })

  it('active time is real elapsed time between reads, not 40 ms per tick', () => {
    const meter = start()
    advance(1000, 100) // 10 reads, 100 ms apart
    const level = meter.result()
    assert.equal(level, null) // 10 windows of ~43 ms cover 43% only
    meter.stop()
    const second = start()
    advance(2000, 50)
    const l2 = second.result()
    assert.ok(l2.activeMs >= 1950 && l2.activeMs <= 2050, `active ${l2.activeMs}`)
    second.stop()
  })

  it('audio that starts flowing late gives no result (first word may be missed)', () => {
    fake.frozen = true
    const meter = start()
    advance(300)
    fake.frozen = false
    advance(700)
    assert.equal(meter.result(), null)
    meter.stop()
  })

  it('a stall while the context still says running gives no result, not silence', () => {
    fake.fill = 0
    const meter = start()
    advance(200)
    fake.frozen = true
    advance(800)
    fake.frozen = false
    advance(200)
    assert.equal(meter.result(), null)
    meter.stop()
  })

  it('real silence with audio flowing is measured as silence', () => {
    fake.fill = 0
    const meter = start()
    advance(1000)
    const level = meter.result()
    assert.equal(level.peak, 0)
    assert.equal(level.activeMs, 0)
    meter.stop()
  })

  it('the context is closed on stop, once', () => {
    const meter = start()
    advance(80)
    meter.stop()
    meter.stop()
    assert.equal(fake.closed, 1)
  })

  it('the context is closed when the graph cannot be built', () => {
    for (const where of ['analyser', 'source'] as const) {
      fake.closed = 0
      failOn = where
      assert.equal(start(), null)
      assert.equal(fake.closed, 1, where)
    }
  })
})
