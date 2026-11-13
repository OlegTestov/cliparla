/**
 * Which display a screenshot comes from, and where the selection sits in it.
 * The display is the one that holds the box drawn in the overlay window: never
 * the display under the cursor at mouse-up.
 */

import type { SelectionCoords } from '../../shared/types'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayLike {
  id: number
  bounds: Rect
  scaleFactor: number
  size?: { width: number; height: number }
}

const TOLERANCE = 1

/** The box the user drew, in global screen coordinates (the overlay's origin plus the box). */
export function selectionRect(coords: SelectionCoords, overlayBounds: Rect): Rect {
  return {
    x: overlayBounds.x + coords.x,
    y: overlayBounds.y + coords.y,
    width: coords.width,
    height: coords.height
  }
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - TOLERANCE &&
    inner.y >= outer.y - TOLERANCE &&
    inner.x + inner.width <= outer.x + outer.width + TOLERANCE &&
    inner.y + inner.height <= outer.y + outer.height + TOLERANCE
  )
}

/**
 * The display that holds the whole selection, or null: a box that spans two
 * displays, or that lies on none, is never cropped from a guessed one.
 */
export function displayForSelection<D extends DisplayLike>(
  coords: SelectionCoords,
  overlayBounds: Rect | null,
  displays: D[]
): D | null {
  if (!overlayBounds) return null
  const box = selectionRect(coords, overlayBounds)
  return displays.find((display) => inside(box, display.bounds)) ?? null
}

/** Crop rectangle in the pixels of the display's screenshot. */
export function cropRectFor(
  coords: SelectionCoords,
  overlayBounds: Rect,
  display: DisplayLike,
  image: { width: number; height: number }
): Rect {
  const box = selectionRect(coords, overlayBounds)
  const scale = display.scaleFactor
  const x = Math.max(0, Math.round((box.x - display.bounds.x) * scale))
  const y = Math.max(0, Math.round((box.y - display.bounds.y) * scale))
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(box.width * scale), image.width - x)),
    height: Math.max(1, Math.min(Math.round(box.height * scale), image.height - y))
  }
}
