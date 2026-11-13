/** Batch 3 item 3: the tray's "Recent" submenu (R1 to R5). */

import './helpers/electron-stub'
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clipboardWrites, resetRecorded, sentMessages, trayMenu } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  setLastResult,
  getRecentResults,
  getLastResult,
  resetLastResultForTests,
  RECENT_LIMIT
} = require('../src/main/services/last-result')
const { recentLabel } = require('../src/shared/recent-label')
const { createTray, updateTrayMenu } = require('../src/main/services/tray')
const windowManager = require('../src/main/core/window-manager')
const { NO_TEXT_MARKER } = require('../src/shared/gemini-constants')

type Item = { label?: string; submenu?: Item[]; enabled?: boolean; click?: () => void }
const recentItem = (): Item =>
  (trayMenu.items as Item[]).find((i) => i.label === 'Recent' && i.submenu)!

describe('recent results', () => {
  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
  })

  beforeEach(() => {
    resetRecorded()
    resetLastResultForTests()
  })

  it('R1: newest first, at most 20', () => {
    for (let i = 1; i <= 25; i++) setLastResult(`result ${i}`)
    const kept = getRecentResults()
    assert.equal(RECENT_LIMIT, 20)
    assert.equal(kept.length, 20)
    assert.equal(kept[0], 'result 25')
    assert.equal(kept[19], 'result 6')
    assert.equal(getLastResult(), 'result 25')
  })

  it('R1: the same text twice in a row is kept once', () => {
    setLastResult('same')
    setLastResult('same')
    assert.deepEqual(getRecentResults(), ['same'])
  })

  it('R2: the no-text marker and blank text are not kept', () => {
    setLastResult('real')
    setLastResult(NO_TEXT_MARKER)
    setLastResult(`prefix ${NO_TEXT_MARKER}`)
    setLastResult('   ')
    assert.deepEqual(getRecentResults(), ['real'])
  })

  it('R3: a click copies the full text (not the shortened label) and says Copied', () => {
    const long = 'A long sentence that is certainly longer than forty characters, to the end.'
    setLastResult('older')
    setLastResult(long)
    createTray()
    const items = recentItem().submenu!
    assert.equal(items[0].label, recentLabel(long))
    assert.notEqual(items[0].label, long)
    items[0].click!()
    assert.deepEqual(clipboardWrites, [long])
    const toast = sentMessages.find((m) => m.channel === 'toast-show')
    assert.equal(toast?.args[0], 'Copied')
  })

  it('R3: the label is one line of about 40 characters with an ellipsis', () => {
    assert.equal(recentLabel('short'), 'short')
    assert.equal(recentLabel('line one\n\nline   two'), 'line one line two')
    const label = recentLabel('x'.repeat(100))
    assert.equal(Array.from(label).length, 41)
    assert.ok(label.endsWith('…'))
    // an emoji at the cut is not split in half
    assert.equal(recentLabel('😀'.repeat(60)), '😀'.repeat(40) + '…')
  })

  it('R4: nothing is kept after a restart and nothing is written to disk', () => {
    setLastResult('secret')
    resetLastResultForTests() // a new run starts with an empty module
    assert.deepEqual(getRecentResults(), [])
    const source = readFileSync(join(__dirname, '../src/main/services/last-result.ts'), 'utf8')
    assert.doesNotMatch(source, /from '(node:)?fs|from '\.\/store|electron-store/)
    createTray()
    assert.deepEqual(
      recentItem().submenu!.map((i) => [i.label, i.enabled]),
      [['Nothing yet', false]]
    )
  })

  it('R5: the menu is rebuilt for each new result', () => {
    createTray()
    assert.equal(recentItem().submenu![0].label, 'Nothing yet')
    setLastResult('first')
    assert.deepEqual(
      recentItem().submenu!.map((i) => i.label),
      ['first']
    )
    setLastResult('second')
    assert.deepEqual(
      recentItem().submenu!.map((i) => i.label),
      ['second', 'first']
    )
    updateTrayMenu()
    assert.equal(recentItem().submenu!.length, 2)
  })
})
