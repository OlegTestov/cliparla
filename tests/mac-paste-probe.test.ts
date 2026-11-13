/** The first run of the paste helper is slow (measured 160-456 ms, 2231 ms for the signed one): never a failure. */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  probeTimeoutMs,
  hasExternalPasteTarget,
  warmUpPasteHelper
} = require('../src/main/services/mac-paste-helper')

const env = (run: (file: string, args: string[]) => Promise<unknown>) => ({
  packaged: true,
  resourcesPath: '/fake/Resources',
  cwd: '/fake',
  exists: () => true,
  run
})
const killed = (): Error =>
  Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })

describe('helper probes and a slow first start', () => {
  it('the probe limit is above the slowest measured cold start (2231 ms)', () => {
    assert.ok(probeTimeoutMs(['--check-focus', '1']) >= 3000)
    assert.ok(probeTimeoutMs(['--check-secure', '1']) >= 3000)
    assert.equal(probeTimeoutMs(['--paste-for', '1']), 5000)
  })

  it('a focus probe that was killed on timeout does not fail the paste (own windows are still checked)', async () => {
    assert.equal(await hasExternalPasteTarget(env(async () => Promise.reject(killed()))), true)
  })

  it('other probe failures still fail', async () => {
    const broken = Object.assign(new Error('boom'), { code: 3 })
    await assert.rejects(hasExternalPasteTarget(env(async () => Promise.reject(broken))))
  })

  it('warm-up does nothing for an unpackaged app or off macOS', async () => {
    const calls: string[][] = []
    await warmUpPasteHelper({ ...env(async (_f, args) => void calls.push(args)), packaged: false })
    assert.equal(calls.length, 0)
  })

  it('warm-up runs the helper once with a read-only check and never throws', async () => {
    const calls: string[][] = []
    await warmUpPasteHelper(env(async (_f, args) => void calls.push(args)))
    assert.equal(calls.length, 1)
    assert.match(calls[0][0], /^--check-/)
    await warmUpPasteHelper(env(async () => Promise.reject(new Error('x'))))
  })
})
