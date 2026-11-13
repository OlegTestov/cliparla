/**
 * Which display a screenshot is taken from: the one that holds the box the user
 * drew in the overlay, never the one under the cursor.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cropRectFor, displayForSelection } from '../src/main/services/capture-geometry'

/* eslint-disable @typescript-eslint/no-require-imports */
const { captureScreen, BLANK_CAPTURE } = require('../src/main/services/screen-capture')

// Built-in Retina display on the left, an external 1x display to its right
const retina = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  size: { width: 1440, height: 900 },
  scaleFactor: 2
}
const external = {
  id: 2,
  bounds: { x: 1440, y: -180, width: 2560, height: 1440 },
  size: { width: 2560, height: 1440 },
  scaleFactor: 1
}
const displays = [retina, external]

describe('displayForSelection', () => {
  it('picks the display that holds the box, whatever the cursor does', () => {
    const box = { x: 100, y: 50, width: 200, height: 80 }
    assert.equal(displayForSelection(box, { ...retina.bounds }, displays), retina)
    assert.equal(displayForSelection(box, { ...external.bounds }, displays), external)
  })

  it('an overlay a little off its display origin (menu bar) still maps to it', () => {
    const box = { x: 100, y: 50, width: 200, height: 80 }
    assert.equal(
      displayForSelection(box, { x: 0, y: 25, width: 1440, height: 875 }, displays),
      retina
    )
  })

  it('a box spanning two displays is refused, not cropped from one of them', () => {
    const overlay = { x: 1000, y: 0, width: 1500, height: 900 }
    assert.equal(
      displayForSelection({ x: 300, y: 50, width: 300, height: 80 }, overlay, displays),
      null
    )
    // The part on the Retina display alone is fine
    assert.equal(
      displayForSelection({ x: 100, y: 50, width: 200, height: 80 }, overlay, displays),
      retina
    )
  })

  it('returns null with no overlay or no matching display', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 }
    assert.equal(displayForSelection(box, null, displays), null)
    assert.equal(
      displayForSelection(box, { x: 9000, y: 9000, width: 10, height: 10 }, displays),
      null
    )
  })
})

describe('cropRectFor', () => {
  const selection = { x: 100, y: 50, width: 200, height: 80 }

  it('uses the scale factor of the display', () => {
    assert.deepEqual(cropRectFor(selection, retina.bounds, retina, { width: 2880, height: 1800 }), {
      x: 200,
      y: 100,
      width: 400,
      height: 160
    })
    assert.deepEqual(
      cropRectFor(selection, external.bounds, external, { width: 2560, height: 1440 }),
      { x: 100, y: 50, width: 200, height: 80 }
    )
  })

  it('adds the offset of the overlay from its display origin', () => {
    const overlay = { x: 0, y: 25, width: 1440, height: 875 }
    const crop = cropRectFor(selection, overlay, retina, { width: 2880, height: 1800 })
    assert.equal(crop.y, (50 + 25) * 2)
  })
})

/** A screen source whose thumbnail records how it was cropped. */
function source(displayId: string, pixels: Buffer = Buffer.from([0, 0, 0, 255, 9, 9, 9, 255])) {
  const crops: unknown[] = []
  return {
    crops,
    display_id: displayId,
    id: `screen:${displayId}`,
    thumbnail: {
      isEmpty: () => false,
      getSize: () => ({ width: 5000, height: 3000 }),
      toPNG: () => Buffer.from(`full-${displayId}`),
      crop: (rect: unknown) => {
        crops.push(rect)
        return {
          isEmpty: () => false,
          toBitmap: () => pixels,
          toPNG: () => Buffer.from(`crop-${displayId}`)
        }
      }
    }
  }
}

describe('captureScreen wiring', () => {
  const box = { x: 100, y: 50, width: 200, height: 80 }

  it('takes the picture of the overlay display, not the first or the cursor one', async () => {
    const sources = [source('1'), source('2')]
    const result = await captureScreen(box, {
      overlayBounds: () => ({ ...external.bounds }),
      displays: () => displays,
      sources: async () => sources
    })
    assert.equal(Buffer.from(result, 'base64').toString(), 'crop-2')
    assert.equal(sources[0].crops.length, 0)
    assert.deepEqual(sources[1].crops[0], { x: 100, y: 50, width: 200, height: 80 })
  })

  it('refuses a flat single-colour image instead of returning it', async () => {
    const flat = Buffer.alloc(4 * 64, 200)
    const result = await captureScreen(box, {
      overlayBounds: () => ({ ...retina.bounds }),
      displays: () => displays,
      sources: async () => [source('1', flat), source('2')]
    })
    assert.equal(result, BLANK_CAPTURE)
  })

  it('returns nothing for a box spanning two displays', async () => {
    const result = await captureScreen(
      { x: 300, y: 50, width: 300, height: 80 },
      {
        overlayBounds: () => ({ x: 1000, y: 0, width: 1500, height: 900 }),
        displays: () => displays,
        sources: async () => [source('1'), source('2')]
      }
    )
    assert.equal(result, null)
  })

  it('returns nothing when the display is unplugged during capture', async () => {
    let calls = 0
    const result = await captureScreen(box, {
      overlayBounds: () => ({ ...external.bounds }),
      displays: () => (calls++ === 0 ? displays : [retina]),
      sources: async () => [source('1')]
    })
    assert.equal(result, null)
  })
})
