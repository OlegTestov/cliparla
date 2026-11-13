/**
 * Starting a dictation takes the indicator out of the "copied" display at once,
 * without waiting for the microphone.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* eslint-disable @typescript-eslint/no-require-imports */
const { nextMode } = require('../src/renderer/src/listening/mode')

const source = readFileSync(`${__dirname}/../src/renderer/src/listening/App.tsx`, 'utf8')

describe('indicator mode on a new dictation', () => {
  it('leaves "copied" for the starting view as soon as start arrives', () => {
    assert.equal(nextMode('copied', 'start'), 'starting')
  })

  it('becomes listening only once the microphone is open', () => {
    assert.equal(nextMode('starting', 'recording'), 'listening')
    assert.equal(nextMode('copied', 'recording'), 'copied')
  })

  it('the starting view is the listening view with its stop and cancel buttons', () => {
    assert.match(source, /mode === 'listening' \|\| mode === 'starting'/)
    assert.match(source, /mode !== 'copied' && \(\s*<button\s+onClick=\{handleCancel\}/)
  })
})
