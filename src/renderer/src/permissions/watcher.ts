/**
 * Keeps the permissions screen fresh.
 *
 * The status is fetched as soon as the page mounts, so a "window shown" event
 * that arrived before React subscribed cannot leave the screen on "Loading".
 * While the window is visible the status is polled; if the first fetch fails
 * it is retried even when hidden.
 */

import type { PermissionsStatus } from '../../../shared/types'

export interface PermissionsWatcherOptions {
  fetchStatus: () => Promise<PermissionsStatus>
  onStatus: (status: PermissionsStatus) => void
  onError?: (error: unknown) => void
  intervalMs?: number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

export function createPermissionsWatcher(options: PermissionsWatcherOptions) {
  const intervalMs = options.intervalMs ?? 1500
  const setTimer = options.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const clearTimer = options.clearInterval ?? ((handle) => clearInterval(handle as never))

  let handle: unknown = null
  let visible = false
  let loaded = false
  let disposed = false

  const refresh = async (): Promise<void> => {
    try {
      const status = await options.fetchStatus()
      if (disposed) return
      loaded = true
      options.onStatus(status)
    } catch (error) {
      if (disposed) return
      options.onError?.(error)
    }
    syncTimer()
  }

  const shouldRun = (): boolean => !disposed && (visible || !loaded)

  function syncTimer(): void {
    if (shouldRun() && handle === null) {
      handle = setTimer(() => void refresh(), intervalMs)
    } else if (!shouldRun() && handle !== null) {
      clearTimer(handle)
      handle = null
    }
  }

  return {
    /** Call once on mount. */
    init(isVisible: boolean): void {
      visible = isVisible
      void refresh()
    },
    /** The window was shown. */
    start(): void {
      visible = true
      syncTimer()
      void refresh()
    },
    /** The window was hidden. */
    stop(): void {
      visible = false
      syncTimer()
    },
    dispose(): void {
      disposed = true
      syncTimer()
    }
  }
}
