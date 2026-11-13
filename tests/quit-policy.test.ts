import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { handleBeforeQuit, installSignalQuit } = require('../src/main/core/quit-policy')

describe('quitting', () => {
  it('Cmd-Q really quits: the quit is never cancelled and windows stop hiding', () => {
    const calls: string[] = []
    const event = { preventDefault: () => calls.push('prevented') }
    handleBeforeQuit(event, { setAllQuitting: (v: boolean) => calls.push(`quitting=${v}`) })
    assert.deepEqual(calls, ['quitting=true'])
  })

  it('SIGTERM and SIGINT quit the app', () => {
    const handlers = new Map<string, () => void>()
    let quits = 0
    installSignalQuit(
      { once: (sig: string, fn: () => void) => handlers.set(sig, fn) },
      () => void quits++
    )
    assert.deepEqual([...handlers.keys()].sort(), ['SIGINT', 'SIGTERM'])
    handlers.get('SIGTERM')!()
    assert.equal(quits, 1)
  })

  it('app bootstrap no longer hides the app on quit', () => {
    const { readFileSync } = require('node:fs')
    const src = readFileSync(`${__dirname}/../src/main/core/app-bootstrap.ts`, 'utf8')
    assert.ok(!src.includes('Hiding to tray'))
    assert.ok(!src.includes('preventDefault'))
  })
})
