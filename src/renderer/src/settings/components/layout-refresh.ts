/**
 * The keyboard layout map can change while Settings stays open (the window is
 * reused), so it is read again on window focus and when recording starts.
 */

export type LayoutMap = Map<string, string>

export interface LayoutSource {
  getLayoutMap?: () => Promise<LayoutMap>
}

export interface FocusTarget {
  addEventListener(type: 'focus', listener: () => void): void
  removeEventListener(type: 'focus', listener: () => void): void
}

export function readLayout(
  source: LayoutSource | undefined,
  onLayout: (map: LayoutMap) => void
): void {
  source?.getLayoutMap?.().then(onLayout, () => undefined)
}

/** Read now and on every focus of `target`; returns the cleanup. */
export function watchLayout(
  source: LayoutSource | undefined,
  target: FocusTarget,
  onLayout: (map: LayoutMap) => void
): () => void {
  const refresh = (): void => readLayout(source, onLayout)
  refresh()
  target.addEventListener('focus', refresh)
  return () => target.removeEventListener('focus', refresh)
}
