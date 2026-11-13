/**
 * Only near-certain silence is refused; noise, whispers, short words and any doubt are sent.
 * The fixtures are made by tools/make-speech-fixtures.sh (8 kHz, mono, 16 bit).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LevelMeter,
  SILENCE_ACTIVE_MS,
  SILENCE_PEAK,
  hasSpeechSignal
} from '../src/shared/speech-level'

const RATE = 8000
const FRAME = 320 // 40 ms, about what the page's analyser delivers

function wavSamples(name: string): Float32Array {
  const buf = readFileSync(`${__dirname}/fixtures/speech/${name}.wav`)
  const data = buf.subarray(44) // plain PCM header
  const out = new Float32Array(data.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768
  return out
}

function measure(name: string) {
  const samples = wavSamples(name)
  const meter = new LevelMeter()
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
    meter.push(samples.subarray(i, i + FRAME), (FRAME / RATE) * 1000)
  }
  return meter.result()
}

describe('speech level of the fixtures', () => {
  it('digital silence is not speech', () => {
    assert.equal(hasSpeechSignal(measure('silence')), false)
  })

  it('room noise (peak 0.01) is sent: the model answers "no speech" itself', () => {
    assert.equal(hasSpeechSignal(measure('noise')), true)
  })

  it('quiet speech (peak 0.03) passes', () => {
    const level = measure('quiet-speech')
    assert.ok(level.peak >= SILENCE_PEAK && level.activeMs >= SILENCE_ACTIVE_MS)
    assert.equal(hasSpeechSignal(level), true)
  })

  it('normal speech passes', () => {
    const level = measure('speech')
    assert.ok(level.peak > 0.5)
    assert.equal(hasSpeechSignal(level), true)
  })

  it('a short quiet word ("yes" at peak 0.012, 120 ms) passes', () => {
    assert.equal(hasSpeechSignal({ peak: 0.012, activeMs: 120 }), true)
  })

  it('noise at peak 0.01 with activity passes', () => {
    assert.equal(hasSpeechSignal({ peak: 0.01, activeMs: 2000 }), true)
  })

  it('a very quiet peak with long activity passes', () => {
    assert.equal(hasSpeechSignal({ peak: 0.005, activeMs: 400 }), true)
  })

  it('a one-word burst at peak 0.004 (-48 dBFS) passes', () => {
    assert.equal(hasSpeechSignal({ peak: 0.004, activeMs: 0 }), true)
  })

  it('peak 0.003 (-50.5 dBFS) with no activity is silence', () => {
    assert.equal(hasSpeechSignal({ peak: 0.003, activeMs: 0 }), false)
  })

  it('digital silence is silence', () => {
    assert.equal(hasSpeechSignal({ peak: 0, activeMs: 0 }), false)
  })

  it('near-zero peak and almost no activity is silence', () => {
    assert.equal(hasSpeechSignal({ peak: 0.0005, activeMs: 0 }), false)
  })

  it('a missing, null or invalid measurement is sent', () => {
    assert.equal(hasSpeechSignal(undefined), true)
    assert.equal(hasSpeechSignal(null), true)
    assert.equal(hasSpeechSignal({ peak: NaN, activeMs: 0 }), true)
    assert.equal(hasSpeechSignal({ peak: 0, activeMs: Infinity }), true)
  })
})
