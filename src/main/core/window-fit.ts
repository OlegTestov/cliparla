/**
 * Fixed-size onboarding windows grow (and shrink back) to fit their content (long translations,
 * an error and a notice at once) instead of showing a scrollbar.
 */

export interface FitInput {
  /** Current content bounds. */
  bounds: { x: number; y: number; width: number; height: number }
  /** Height the page needs without scrolling. */
  preferredHeight: number
  /** The configured content height: the window shrinks back to it, not below. */
  minHeight: number
  /** Native title bar and borders around the content (0 when frameless). */
  frameHeight?: number
  /** Usable screen area of the window's display. */
  workArea: { y: number; height: number }
}

/** A height a page may ask for: a positive number of pixels, not absurd. */
export function asNeededHeight(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 10000
    ? value
    : null
}

/**
 * New bounds when the window must grow or shrink, or null when it already fits.
 * `bounds` are the content bounds (without a native title bar); the window never
 * gets shorter than `minHeight`, its configured size.
 */
export function fitHeight({
  bounds,
  preferredHeight,
  minHeight,
  frameHeight = 0,
  workArea
}: FitInput): FitInput['bounds'] | null {
  // The whole window, frame included, must fit the work area
  const height = Math.min(
    Math.max(Math.ceil(preferredHeight), minHeight),
    workArea.height - frameHeight
  )
  if (height === bounds.height) return null
  // Keep the top edge, unless the window would run off the bottom of the screen
  const bottom = workArea.y + workArea.height
  const y = Math.max(workArea.y + frameHeight, Math.min(bounds.y, bottom - height))
  return { ...bounds, y, height }
}
