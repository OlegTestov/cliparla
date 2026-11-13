/**
 * A card or pill that appears under a still pointer is held open: main compares the pointer with
 * the window bounds, the page only reports later moves.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resetRecorded, screenState, sentMessages } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const {
  ERROR_PILL_AUTO_HIDE_MS,
  setErrorPillHover,
  showErrorPill,
  resetErrorPill
} = require('../src/main/services/dictation/error-pill')
const {
  COPIED_INDICATOR_MS,
  setCopiedIndicatorHover,
  showCopiedNotice
} = require('../src/main/services/accessibility-hint')

const channels = (): string[] => sentMessages.map((m) => m.channel)
// The card is 360x124 at the bottom centre of the default work area (0,25,1440,875)
const INSIDE = { x: 700, y: 780 }
const OUTSIDE = { x: 10, y: 10 }

describe('hover decided in main', () => {
  beforeEach(() => {
    resetRecorded()
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    resetRecorded()
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  afterEach(() => {
    mock.timers.reset()
    resetErrorPill()
    setCopiedIndicatorHover(false)
    screenState.cursor = { x: 0, y: 0 }
  })

  it('the pointer is inside the window bounds only where the window is', () => {
    screenState.cursor = INSIDE
    showErrorPill('x')
    assert.equal(windowManager.isCursorOverIndicator(), true)
    screenState.cursor = OUTSIDE
    assert.equal(windowManager.isCursorOverIndicator(), false)
  })

  it('an error card that opens under the pointer stays past 6 s, and closes when the pointer leaves', () => {
    screenState.cursor = INSIDE
    showErrorPill('no retry here')
    mock.timers.tick(ERROR_PILL_AUTO_HIDE_MS + 1000)
    assert.ok(!channels().includes('listening-mode-stop'))
    setErrorPillHover(false)
    assert.ok(channels().includes('listening-mode-stop'))
  })

  it('an error card that opens elsewhere hides after 6 s', () => {
    screenState.cursor = OUTSIDE
    showErrorPill('no retry here')
    mock.timers.tick(ERROR_PILL_AUTO_HIDE_MS + 1)
    assert.ok(channels().includes('listening-mode-stop'))
  })

  it('a copied pill that appears under the pointer stays past 6 s', () => {
    screenState.cursor = { x: 720, y: 800 } // inside the 240x70 pill at the bottom centre
    showCopiedNotice({ reason: 'paste-failed' })
    mock.timers.tick(COPIED_INDICATOR_MS + 1000)
    assert.ok(!channels().includes('listening-mode-stop'))
    setCopiedIndicatorHover(false)
    assert.ok(channels().includes('listening-mode-stop'))
  })

  it('a copied pill elsewhere hides after 6 s', () => {
    screenState.cursor = OUTSIDE
    showCopiedNotice({ reason: 'paste-failed' })
    mock.timers.tick(COPIED_INDICATOR_MS + 1)
    assert.ok(channels().includes('listening-mode-stop'))
  })

  it('the page no longer measures the pointer itself', () => {
    const page = readFileSync('src/renderer/src/listening/App.tsx', 'utf8')
    assert.doesNotMatch(page, /:hover|reportHover/)
    assert.match(page, /setIndicatorHover\(true\)/)
  })
})
