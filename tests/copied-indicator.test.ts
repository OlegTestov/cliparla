/**
 * When the dictated text is copied instead of pasted, the listening indicator
 * says so, so the user is told even with notifications off.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resetRecorded, screenState, sentMessages, shownPages } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const {
  showCopiedNotice,
  setCopiedIndicatorHover
} = require('../src/main/services/accessibility-hint')
const { startDictation, cancelDictation } = require('../src/main/services/dictation')

const channels = (): string[] => sentMessages.map((m) => m.channel)

describe('copied state in the dictation indicator', () => {
  beforeEach(() => {
    resetRecorded()
    cancelDictation()
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    resetRecorded()
    mock.timers.enable({ apis: ['setTimeout'] })
  })

  afterEach(() => {
    mock.timers.reset()
    screenState.cursor = { x: 0, y: 0 }
  })

  it('shows the indicator in the copied state, then hides it after 6 s', () => {
    showCopiedNotice()
    assert.deepEqual(channels(), ['listening-mode-copied'])
    assert.ok(shownPages.includes('listening.html'))
    mock.timers.tick(5900)
    assert.deepEqual(channels(), ['listening-mode-copied'])
    mock.timers.tick(200)
    assert.deepEqual(channels(), ['listening-mode-copied', 'listening-mode-stop'])
  })

  it('offers the Open Settings link when the permission is missing, not after a failed paste', () => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    showCopiedNotice({ reason: 'no-permission' })
    showCopiedNotice({ reason: 'paste-failed' })
    showCopiedNotice({ reason: 'not-trusted' })
    const hints = sentMessages
      .filter((m) => m.channel === 'listening-mode-copied')
      .map((m) => m.args[0])
    Object.defineProperty(process, 'platform', { value: real })
    assert.deepEqual(hints, ['open-settings', null, 'readd-accessibility'])
    mock.timers.tick(6001) // let the pill close so no timer outlives the test
  })

  it('stays open while the mouse is over it, and closes when the mouse leaves', () => {
    showCopiedNotice()
    mock.timers.tick(3000)
    screenState.cursor = { x: 700, y: 810 } // over the pill when its 6 s are up
    mock.timers.tick(10_000)
    assert.deepEqual(channels(), ['listening-mode-copied'])
    screenState.cursor = { x: 10, y: 10 }
    setCopiedIndicatorHover(false)
    assert.deepEqual(channels(), ['listening-mode-copied', 'listening-mode-stop'])
  })

  it('leaving early does not close it before the 6 s are up', () => {
    screenState.cursor = { x: 700, y: 810 }
    showCopiedNotice()
    mock.timers.tick(2000)
    screenState.cursor = { x: 10, y: 10 }
    setCopiedIndicatorHover(false)
    assert.deepEqual(channels(), ['listening-mode-copied'])
    mock.timers.tick(4100)
    assert.deepEqual(channels(), ['listening-mode-copied', 'listening-mode-stop'])
  })

  it('a hover with no copied message showing does nothing', () => {
    setCopiedIndicatorHover(true)
    setCopiedIndicatorHover(false)
    assert.deepEqual(channels(), [])
  })

  it('a new dictation within that time is not hidden by the old timer', () => {
    showCopiedNotice()
    startDictation()
    sentMessages.length = 0
    mock.timers.tick(5000)
    assert.deepEqual(channels(), [])
    cancelDictation()
  })
})
