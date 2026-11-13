/** The test suite must never run the real macOS `open` (it pulls System Settings to the front). */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { exec, execFile, execFileSync, spawn } from 'node:child_process'

describe('the stub forbids the real `open`', () => {
  it('exec, execFile, execFileSync and spawn of open throw before anything runs', () => {
    const pane =
      'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
    assert.throws(() => exec(pane), /real command/)
    assert.throws(() => execFile('/usr/bin/open', ['-a', 'Calculator']), /real command/)
    assert.throws(() => execFileSync('open', ['-a', 'Calculator']), /real command/)
    assert.throws(() => spawn('open', ['-a', 'Calculator']), /real command/)
  })

  it('other commands still run', () => {
    assert.equal(execFileSync('/bin/echo', ['ok'], { encoding: 'utf8' }).trim(), 'ok')
  })
})
