import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asNeededHeight, fitHeight } from '../src/main/core/window-fit'

const workArea = { y: 25, height: 875 }
const bounds = { x: 100, y: 150, width: 500, height: 600 }
const minHeight = 600

describe('fitHeight', () => {
  it('leaves a window that fits alone', () => {
    assert.equal(fitHeight({ bounds, preferredHeight: 600, minHeight, workArea }), null)
    assert.equal(fitHeight({ bounds, preferredHeight: 480, minHeight, workArea }), null)
  })

  it('grows downwards, keeping the top edge', () => {
    assert.deepEqual(fitHeight({ bounds, preferredHeight: 714, minHeight, workArea }), {
      ...bounds,
      height: 714
    })
  })

  it('moves up instead of running off the screen', () => {
    const low = { ...bounds, y: 400 }
    assert.deepEqual(fitHeight({ bounds: low, preferredHeight: 714, minHeight, workArea }), {
      ...low,
      y: 25 + 875 - 714,
      height: 714
    })
  })

  it('never gets taller than the screen; the page scrolls beyond that', () => {
    assert.deepEqual(fitHeight({ bounds, preferredHeight: 2000, minHeight, workArea }), {
      ...bounds,
      y: 25,
      height: 875
    })
  })
})

describe('fitHeight shrinking', () => {
  it('shrinks back to the configured height, never below it', () => {
    const tall = { ...bounds, height: 714 }
    assert.deepEqual(fitHeight({ bounds: tall, preferredHeight: 450, minHeight, workArea }), bounds)
    assert.equal(fitHeight({ bounds, preferredHeight: 450, minHeight, workArea }), null)
  })

  it('a window with a title bar is measured by its content, not its frame', () => {
    // 600 px outer window with a 28 px title bar: 572 px of content
    const content = { x: 100, y: 178, width: 500, height: 572 }
    assert.equal(
      fitHeight({ bounds: content, preferredHeight: 572, minHeight: 572, workArea }),
      null
    )
    assert.equal(
      fitHeight({ bounds: content, preferredHeight: 600, minHeight: 572, workArea })!.height,
      600
    )
  })
})

describe('fitHeight with a native frame', () => {
  it('caps content height and top edge so the title bar stays on screen', () => {
    const high = { ...bounds, y: 30 }
    const next = fitHeight({
      bounds: high,
      preferredHeight: 2000,
      minHeight,
      frameHeight: 28,
      workArea
    })!
    assert.equal(next.height, 875 - 28)
    assert.equal(next.y, 25 + 28)
  })
})

describe('asNeededHeight', () => {
  it('accepts a plain pixel height only', () => {
    assert.equal(asNeededHeight(714), 714)
    for (const bad of [0, -5, Number.NaN, Infinity, 1e9, '714', null, undefined]) {
      assert.equal(asNeededHeight(bad), null)
    }
  })
})
