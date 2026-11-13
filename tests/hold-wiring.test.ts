/** The wiring between the hotkey, the key helper, Accessibility grants and app start-up. */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createHoldWiring } = require('../src/main/services/dictation/hold-wiring')

function fixture(mode = true, accelerator: string | null = 'Control+Alt+V') {
  const calls: string[] = []
  const listeners = { active: [] as Array<() => void>, granted: [] as Array<() => void> }
  const wiring = createHoldWiring({
    keyHelper: {
      watch: (a: string | null) => void calls.push(`watch:${a}`),
      stop: () => void calls.push('stop'),
      retryIfNoPermission: () => void calls.push('retry')
    },
    holdToTalk: { press: () => void calls.push('press') },
    getAccelerator: () => accelerator,
    isNormalMode: () => mode,
    onAppActive: (l: () => void) => void listeners.active.push(l),
    onGranted: (l: () => void) => void listeners.granted.push(l)
  })
  return { wiring, calls, listeners }
}

describe('hold-to-talk wiring', () => {
  let f: ReturnType<typeof fixture>
  beforeEach(() => {
    f = fixture()
  })

  it('a hotkey press retries the key helper first, then goes to hold-to-talk', () => {
    f.wiring.pressDictationHotkey()
    assert.deepEqual(f.calls, ['retry', 'press'])
  })

  it('a late Accessibility grant and app activation both retry the helper', () => {
    f.wiring.watchKeyHelperGrants()
    assert.equal(f.listeners.granted.length, 1)
    assert.equal(f.listeners.active.length, 1)
    f.listeners.granted[0]()
    f.listeners.active[0]()
    assert.deepEqual(f.calls, ['retry', 'retry'])
  })

  it('watching is set up once however often it is asked', () => {
    f.wiring.watchKeyHelperGrants()
    f.wiring.watchKeyHelperGrants()
    assert.equal(f.listeners.granted.length, 1)
  })

  it('the helper watches the hotkey in normal mode, nothing in protected mode or without a key', () => {
    f.wiring.syncKeyHelper()
    assert.deepEqual(f.calls, ['watch:Control+Alt+V'])
    const p = fixture(false)
    p.wiring.syncKeyHelper()
    assert.deepEqual(p.calls, ['watch:null'])
    const n = fixture(true, null)
    n.wiring.syncKeyHelper()
    assert.deepEqual(n.calls, ['watch:null'])
  })
})
