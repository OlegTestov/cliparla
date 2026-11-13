/**
 * Cancelling while the microphone prompt is pending must not leave a live
 * stream behind. Uses a deferred getUserMedia, never a real microphone.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { StreamGate } = require('../src/renderer/src/listening/stream-gate')

function fakeStream() {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true
    }
  }
  return { track, stream: { getTracks: () => [track] } }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('StreamGate', () => {
  it('returns the stream when nothing cancelled the request', async () => {
    const gate = new StreamGate()
    const { stream, track } = fakeStream()
    assert.equal(await gate.acquire(async () => stream), stream)
    assert.equal(track.stopped, false)
  })

  it('stops and drops a stream that arrives after cancel', async () => {
    const gate = new StreamGate()
    const pending = deferred<unknown>()
    const result = gate.acquire(() => pending.promise)
    gate.invalidate() // user pressed Cancel
    const { stream, track } = fakeStream()
    pending.resolve(stream)
    assert.equal(await result, null)
    assert.equal(track.stopped, true)
  })

  it('a newer request supersedes an older pending one', async () => {
    const gate = new StreamGate()
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const a = gate.acquire(() => first.promise)
    const b = gate.acquire(() => second.promise)
    const one = fakeStream()
    const two = fakeStream()
    first.resolve(one.stream)
    second.resolve(two.stream)
    assert.equal(await a, null)
    assert.equal(one.track.stopped, true)
    assert.equal(await b, two.stream)
    assert.equal(two.track.stopped, false)
  })

  it('a rejection after cancel is swallowed, a current rejection is thrown', async () => {
    const gate = new StreamGate()
    const stale = deferred<unknown>()
    const a = gate.acquire(() => stale.promise)
    gate.invalidate()
    stale.reject(new Error('denied'))
    assert.equal(await a, null)

    const current = deferred<unknown>()
    const b = gate.acquire(() => current.promise)
    current.reject(new Error('denied'))
    await assert.rejects(b, /denied/)
  })
})
