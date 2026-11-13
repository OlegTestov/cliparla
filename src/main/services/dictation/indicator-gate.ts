/**
 * One readiness gate for the indicator page. It is ready only when the page says it listens (the
 * renderer sends "page ready" after it subscribed to main's messages; a finished load is not enough,
 * messages sent before that are lost); a crash,
 * a reload or a failed load makes it not ready, and everything that needs the indicator waits for
 * it. A page that keeps dying is reloaded at most twice a minute, then once more when the minute
 * is over; the user is told to restart once per such episode.
 */

export const MAX_RELOADS = 2
export const RELOAD_WINDOW_MS = 60_000
/** A reload that does not report "page ready" within this time counts as failed. */
export const RELOAD_SETTLE_TIMEOUT_MS = 15_000
/** The first load of a cold start gets longer, and a failure of it is not announced. */
export const FIRST_LOAD_TIMEOUT_MS = 30_000

export interface WebContentsLike {
  on(event: 'render-process-gone', l: (e: unknown, details?: { reason?: string }) => void): unknown
  on(event: 'did-start-loading', l: () => void): unknown
  on(
    event: 'did-fail-load',
    l: (
      e: unknown,
      errorCode?: number,
      description?: string,
      url?: string,
      isMainFrame?: boolean
    ) => void
  ): unknown
  reload(): void
  isDestroyed?(): boolean
}

export interface GateEvents {
  /** The page stopped being ready (it crashed): hide the indicator, park what it showed. */
  onNotReady(): void
  /** The renderer died: end what was running (the page is already marked not ready). */
  onGone(): void
  /** The page finished loading. */
  onReady(): void
  /** The page is dead and not coming back by itself: tell the user (once per episode). */
  onDead(): void
}

export interface IndicatorGate {
  isReady(): boolean
  /** The page cannot render (an error in it): handled like a crash of its renderer. */
  pageBroken(): void
  /** The renderer's page subscribed to main's messages. Ignored unless it belongs to the current load. */
  pageReady(): void
  /** For a hotkey press: 'ready', or why not. A dead page is reloaded here if the cap allows. */
  request(): 'ready' | 'loading' | 'dead'
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export interface GateOptions {
  now?: () => number
  timers?: Timers
  /** True while the app is quitting: no recovery, no notices */
  isQuitting?: () => boolean
}

export function watchIndicator(
  contents: WebContentsLike,
  events: () => GateEvents | null,
  options: GateOptions = {}
): IndicatorGate {
  const now = options.now ?? Date.now
  const timers = options.timers ?? realTimers
  const quitting = (): boolean => options.isQuitting?.() ?? false

  let state: 'loading' | 'ready' | 'dead' = 'loading' // the first load is under way
  let firstLoad = true
  // A "page ready" counts only after the current load started: an older page's message is stale
  let started = false
  // Tells the user to restart once per episode: it resets only after the page stayed up a whole minute
  let noticed = false
  let stable: unknown = null
  const reloads: number[] = []
  let deferred: unknown = null
  let settle: unknown = null

  const clearSettle = (): void => {
    if (settle !== null) timers.clearTimeout(settle)
    settle = null
  }

  const dead = (silent = false): void => {
    state = 'dead'
    clearSettle()
    if (silent || noticed || quitting()) return
    noticed = true
    events()?.onDead()
  }

  // A load, the first or a reload, that gives no answer in time counts as failed
  const armSettle = (ms: number, silent: boolean): void => {
    clearSettle()
    settle = timers.setTimeout(() => {
      settle = null
      if (state === 'loading' && !quitting()) dead(silent)
    }, ms)
  }

  const beginLoad = (): void => {
    state = 'loading'
    firstLoad = false // a failure from here on is a failure of a reload
    started = false
    armSettle(RELOAD_SETTLE_TIMEOUT_MS, false)
    contents.reload()
  }

  /** True when a reload started. */
  const tryReload = (): boolean => {
    const t = now()
    while (reloads.length && t - reloads[0] >= RELOAD_WINDOW_MS) reloads.shift()
    if (reloads.length >= MAX_RELOADS) {
      dead() // also drops the timer of a reload that is still pending
      if (deferred === null) {
        deferred = timers.setTimeout(
          () => {
            deferred = null
            if (state === 'ready' || contents.isDestroyed?.() || quitting()) return
            reloads.push(now())
            beginLoad()
          },
          reloads[0] + RELOAD_WINDOW_MS - t
        )
      }
      return false
    }
    reloads.push(t)
    beginLoad()
    return true
  }

  const crashed = (): void => {
    const wasReady = state === 'ready'
    state = 'dead'
    started = false
    clearSettle()
    if (stable !== null) timers.clearTimeout(stable)
    stable = null
    if (wasReady) events()?.onNotReady()
    events()?.onGone()
    tryReload()
  }

  contents.on('render-process-gone', (_event, details) => {
    // A normal exit (window closing, app quitting) is not a crash
    if (details?.reason === 'clean-exit' || contents.isDestroyed?.() || quitting()) return
    crashed()
  })
  contents.on('did-start-loading', () => {
    // A navigation of a page that was ready (not one we asked for) makes it not ready again
    if (state === 'ready') {
      state = 'loading'
      if (stable !== null) timers.clearTimeout(stable)
      stable = null
      armSettle(RELOAD_SETTLE_TIMEOUT_MS, false)
      events()?.onNotReady()
      events()?.onGone()
    }
    started = true
  })
  contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    // -3 is a load that was cancelled (a new navigation), and a sub-frame failing is not the page
    if (errorCode === -3 || isMainFrame === false) return
    if (state === 'loading') dead(firstLoad)
  })
  armSettle(FIRST_LOAD_TIMEOUT_MS, true)

  const pageReady = (): void => {
    // A load that already timed out may still answer late; a message from before the load may not
    if (state === 'ready' || !started || contents.isDestroyed?.()) return
    clearSettle()
    if (deferred !== null) timers.clearTimeout(deferred)
    deferred = null
    state = 'ready'
    firstLoad = false
    if (stable !== null) timers.clearTimeout(stable)
    stable = timers.setTimeout(() => {
      stable = null
      noticed = false
    }, RELOAD_WINDOW_MS)
    events()?.onReady()
  }

  const pageBroken = (): void => {
    if (contents.isDestroyed?.() || quitting()) return
    crashed()
  }

  return {
    pageReady,
    pageBroken,
    isReady: () => state === 'ready',
    request: () => {
      if (state === 'ready') return 'ready'
      if (state === 'loading') return 'loading'
      return tryReload() ? 'loading' : 'dead'
    }
  }
}
