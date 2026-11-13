/**
 * The pill and the error card sit inside the display's work area, never under the Dock.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resetRecorded, screenState, windowCalls } from './helpers/electron-stub'
import { bottomCenterPosition } from '../src/main/core/indicator-position'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')

const inside = (
  pos: { x: number; y: number },
  size: [number, number],
  area: { x: number; y: number; width: number; height: number }
): boolean =>
  pos.x >= area.x &&
  pos.y >= area.y &&
  pos.x + size[0] <= area.x + area.width &&
  pos.y + size[1] <= area.y + area.height

const CARD: [number, number] = [360, 124]
const PILL: [number, number] = [240, 70]
const screen = { x: 0, y: 0, width: 1440, height: 900 }
const docks = {
  none: screen,
  bottom: { x: 0, y: 0, width: 1440, height: 820 },
  left: { x: 80, y: 25, width: 1360, height: 875 },
  right: { x: 0, y: 25, width: 1360, height: 875 }
}

describe('bottom-centre position', () => {
  for (const [name, area] of Object.entries(docks)) {
    for (const [label, size] of [
      ['card', CARD],
      ['pill', PILL]
    ] as const) {
      it(`the ${label} stays inside the work area with a ${name} Dock`, () => {
        assert.ok(inside(bottomCenterPosition(size, area), size, area))
      })
    }
  }

  it('centres on the work area, not on the screen, with a left Dock', () => {
    const { x } = bottomCenterPosition(CARD, docks.left)
    assert.equal(x, Math.round(80 + 1360 / 2 - 180))
  })

  it('sits 50 px above the bottom of the work area', () => {
    assert.equal(bottomCenterPosition(CARD, docks.bottom).y, 820 - 124 - 50)
  })

  it('a work area narrower than the card keeps its left edge visible', () => {
    const narrow = { x: 10, y: 0, width: 300, height: 400 }
    assert.equal(bottomCenterPosition(CARD, narrow).x, 10)
  })
})

describe('showing the indicator', () => {
  beforeEach(() => {
    resetRecorded()
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    windowCalls.length = 0
  })

  afterEach(() => {
    screenState.workArea = { x: 0, y: 25, width: 1440, height: 875 }
  })

  for (const [name, area] of Object.entries(docks)) {
    it(`the real show path puts the card inside the work area (${name} Dock)`, () => {
      screenState.workArea = area
      windowManager.showListeningIndicator('error')
      const calls = windowCalls.filter((c) => c.call !== undefined)
      assert.deepEqual(
        calls.map((c) => c.call),
        ['setBounds'],
        'one call moves and resizes'
      )
      const [x, y, width, height] = calls[0].args
      assert.deepEqual([width, height], CARD)
      assert.ok(inside({ x, y }, CARD, area))
    })
  }

  it('window-manager positions against workArea, not bounds', () => {
    const src = readFileSync('src/main/core/window-manager.ts', 'utf8')
    const fn = src.slice(
      src.indexOf('function positionBottomCenter'),
      src.indexOf('Position window on active monitor')
    )
    assert.match(fn, /workArea/)
    assert.doesNotMatch(fn, /bounds/)
  })
})
