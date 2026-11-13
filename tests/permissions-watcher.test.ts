/**
 * The permissions screen must leave "Loading" even when the main process sent
 * its "window shown" event before the page subscribed to it.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createPermissionsWatcher } = require('../src/renderer/src/permissions/watcher')

const STATUS = { screenRecording: 'granted', microphone: 'denied', accessibility: false }

function harness(fetchStatus: () => Promise<unknown>) {
  const statuses: unknown[] = []
  const failures: unknown[] = []
  const timers: Array<() => void> = []
  const watcher = createPermissionsWatcher({
    fetchStatus,
    onStatus: (s: unknown) => statuses.push(s),
    onError: (e: unknown) => failures.push(e),
    setInterval: (fn: () => void) => {
      timers.push(fn)
      return timers.length
    },
    clearInterval: () => timers.splice(0)
  })
  return { watcher, statuses, failures, timers }
}

const tick = () => new Promise((r) => setImmediate(r))

describe('permissions watcher', () => {
  it('loads the status on mount without waiting for a shown event', async () => {
    const { watcher, statuses } = harness(async () => STATUS)
    watcher.init(true)
    await tick()
    assert.deepEqual(statuses, [STATUS])
  })

  it('does not poll while the window is hidden, and starts when it is shown', async () => {
    const { watcher, timers } = harness(async () => STATUS)
    watcher.init(false)
    await tick()
    assert.equal(timers.length, 0)
    watcher.start()
    assert.equal(timers.length, 1)
    watcher.start() // repeated events do not stack timers
    assert.equal(timers.length, 1)
    watcher.stop()
    assert.equal(timers.length, 0)
  })

  it('keeps retrying after a failed first fetch until one succeeds', async () => {
    let attempt = 0
    const { watcher, statuses, failures, timers } = harness(async () => {
      if (++attempt === 1) throw new Error('not ready')
      return STATUS
    })
    watcher.init(false)
    await tick()
    assert.equal(failures.length, 1)
    assert.equal(timers.length, 1, 'retry timer runs even though the window is hidden')
    timers[0]()
    await tick()
    assert.deepEqual(statuses, [STATUS])
    assert.equal(timers.length, 0, 'retry stops after the first success when hidden')
  })

  it('ignores results after dispose', async () => {
    const { watcher, statuses } = harness(async () => STATUS)
    watcher.init(true)
    watcher.dispose()
    await tick()
    assert.deepEqual(statuses, [])
  })
})
