/**
 * macOS shows the Accessibility prompt only once: the next click must open the pane.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { opensSettings } from '../src/renderer/src/permissions/button-action'

describe('permission button action', () => {
  it('Accessibility asks first, then opens System Settings', () => {
    assert.equal(opensSettings('accessibility', { denied: false, asked: false }), false)
    assert.equal(opensSettings('accessibility', { denied: false, asked: true }), true)
  })

  it('Screen Recording always opens System Settings', () => {
    assert.equal(opensSettings('screen', { denied: false, asked: false }), true)
  })

  it('Microphone asks until it is denied, then opens System Settings', () => {
    assert.equal(opensSettings('microphone', { denied: false, asked: true }), false)
    assert.equal(opensSettings('microphone', { denied: true, asked: true }), true)
  })

  it('the screen remembers the Accessibility request', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/permissions/App.tsx`, 'utf8')
    assert.match(page, /setAccessibilityAsked\(true\)/)
    assert.match(page, /asked=\{accessibilityAsked \|\| permissions\.accessibilityPrompted\}/)
  })
})
