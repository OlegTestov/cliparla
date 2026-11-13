/**
 * Without an indicator window the indicator is not usable: nothing starts.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { startDictation, getDictationState } = require('../src/main/services/dictation')

describe('no indicator window', () => {
  it('is not ready and the gate says "loading"', () => {
    assert.equal(windowManager.isIndicatorReady(), false)
    assert.equal(windowManager.requestIndicator(), 'loading')
  })

  it('the hotkey starts nothing', () => {
    startDictation()
    assert.equal(getDictationState(), 'idle')
  })
})
