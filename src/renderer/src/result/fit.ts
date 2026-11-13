/**
 * The result window grows while a long text arrives; it never shrinks while the text is coming
 * (a shrinking window would jump back under the reader's eyes).
 */

/** The window height to ask for, or null when the window is already tall enough. */
export function heightToAsk(
  scrollHeight: number,
  clientHeight: number,
  windowHeight: number
): number | null {
  // Everything around the scrolling area (title bar, banner) stays the same size
  const needed = scrollHeight + (windowHeight - clientHeight)
  return needed > windowHeight ? Math.ceil(needed) : null
}
