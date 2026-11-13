/**
 * Without Accessibility Cliparla cannot paste: the dictated text goes to the
 * clipboard and the user presses the paste key. The macOS prompt is shown once
 * per run; when the permission arrives later, one notice says pasting is automatic now.
 */

import { Notification } from 'electron'
import { t } from '../core/localize'
import { needsMacPermissions, pasteKey } from '../../shared/paste-key'
import { createLogger } from '../core/logger'
import {
  hideListeningIndicator,
  isCursorOverIndicator,
  isIndicatorReady,
  onIndicatorNotReady,
  onIndicatorReady,
  sendListeningCopied,
  sendStopListening,
  showListeningIndicator
} from '../core/window-manager'
import { checkAccessibilityPermission } from './keyboard-simulator'
import { getUiLanguage } from './store'
import { openAccessibilitySettings } from './permissions'
import type { CopiedHint } from '../../shared/types'

const log = createLogger('AccessibilityHint')

export interface AccessibilityWatchDeps {
  isTrusted: () => boolean
  onGranted: () => void
  intervalMs?: number
  timeoutMs?: number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

/** Long enough for a user who reads System Settings slowly; a late grant also restarts hold-to-talk. */
export const ACCESSIBILITY_WATCH_TIMEOUT_MS = 600_000

let active: unknown = null

const grantListeners = new Set<() => void>()

/** Called whenever a watched Accessibility grant arrives (for example to restart hold-to-talk). */
export function onAccessibilityGranted(listener: () => void): void {
  grantListeners.add(listener)
}

/** Poll until Accessibility is granted (then call onGranted once) or the time runs out. */
export function watchAccessibilityGrant(deps: AccessibilityWatchDeps): void {
  if (active !== null) return // one watcher is enough, however often text is copied
  const intervalMs = deps.intervalMs ?? 1000
  const timeoutMs = deps.timeoutMs ?? ACCESSIBILITY_WATCH_TIMEOUT_MS
  const setTimer = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const clearTimer = deps.clearInterval ?? ((h) => clearInterval(h as never))
  let waited = 0
  const handle = setTimer(() => {
    waited += intervalMs
    const granted = deps.isTrusted()
    if (!granted && waited < timeoutMs) return
    clearTimer(handle)
    active = null
    if (granted) {
      deps.onGranted()
      grantListeners.forEach((listener) => listener())
    }
  }, intervalMs)
  ;(handle as { unref?: () => void } | null)?.unref?.()
  active = handle
}

// A notification with a click handler must stay referenced until it is clicked or closed:
// once garbage-collected, its handler is gone and the click does nothing.
const NOTIFICATION_KEEP_MS = 5 * 60_000
const liveNotifications = new Set<Notification>()

/** How many clickable notifications are still being kept alive. */
export const liveNotificationCount = (): number => liveNotifications.size

function notify(key: string, params?: Record<string, string>, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'Cliparla',
    body: t(key, getUiLanguage(), params)
  })
  if (onClick) {
    liveNotifications.add(notification)
    const release = (): void => void liveNotifications.delete(notification)
    notification.on('click', () => {
      release()
      onClick()
    })
    notification.on('close', release)
    setTimeout(release, NOTIFICATION_KEEP_MS).unref?.()
  }
  notification.show()
}

/** Long enough to read the message; it also stays while the mouse is over it. */
export const COPIED_INDICATOR_MS = 6000
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let copiedExpired = false
// A copied pill asked for while the indicator page is not ready: the latest one waits for it
let queuedHint: { hint: CopiedHint; at: number } | null = null
/** A pill that waited longer than this is stale: the user has moved on */
const QUEUED_PILL_MAX_AGE_MS = 20_000
let lastHint: CopiedHint = null

function closeCopiedIndicator(): void {
  copiedTimer = null
  copiedExpired = false
  sendStopListening()
  hideListeningIndicator()
}

/** A new dictation takes the indicator over: the "copied" state must not hide it. */
export function cancelCopiedIndicator(): void {
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = null
  copiedExpired = false
  queuedHint = null
}

/** The mouse left the indicator: a copied message that waited for it now closes. */
export function setCopiedIndicatorHover(isOver: boolean): void {
  if (!isOver && copiedExpired) closeCopiedIndicator()
}

/** Feedback that needs no notification permission: the indicator says "Copied" for a moment. */
function showCopiedIndicator(hint: CopiedHint): void {
  cancelCopiedIndicator()
  lastHint = hint
  if (!isIndicatorReady()) {
    queuedHint = { hint, at: Date.now() }
    return
  }
  sendListeningCopied(hint)
  showListeningIndicator()
  copiedTimer = setTimeout(() => {
    copiedTimer = null
    // The pointer decides now: over the pill it waits for the pointer to leave
    if (isCursorOverIndicator()) copiedExpired = true
    else closeCopiedIndicator()
  }, COPIED_INDICATOR_MS)
  copiedTimer.unref?.()
}

// The page died while the pill was up: it comes back, fresh, when the page does
onIndicatorNotReady(() => {
  if (copiedTimer === null && !copiedExpired) return
  cancelCopiedIndicator()
  queuedHint = { hint: lastHint, at: Date.now() }
})

onIndicatorReady(() => {
  const queued = queuedHint
  queuedHint = null
  if (queued && Date.now() - queued.at <= QUEUED_PILL_MAX_AGE_MS) showCopiedIndicator(queued.hint)
})

export interface CopiedNoticeOptions {
  /** False when a newer dictation owns the indicator window */
  indicator?: boolean
  /** Why the text was not pasted */
  reason?: 'no-permission' | 'paste-failed' | 'not-trusted' | 'secure-input'
}

const HINT_FOR: Record<NonNullable<CopiedNoticeOptions['reason']>, CopiedHint> = {
  'no-permission': 'open-settings',
  'paste-failed': null,
  'not-trusted': 'readd-accessibility',
  'secure-input': null
}

const MESSAGE_FOR: Record<NonNullable<CopiedNoticeOptions['reason']>, string> = {
  'no-permission': 'accessibility.copied',
  'paste-failed': 'accessibility.copiedPasteFailed',
  'not-trusted': 'accessibility.copiedNotTrusted',
  'secure-input': 'accessibility.copiedSecureInput'
}

/**
 * The dictated text is on the clipboard but was not pasted.
 * `indicator: false` when a newer dictation owns the indicator window.
 */
export function showCopiedNotice({
  indicator = true,
  reason = 'no-permission'
}: CopiedNoticeOptions = {}): void {
  const mac = needsMacPermissions(process.platform)
  if (indicator) {
    // The link is for the permission fix; a failed paste with Accessibility on has no link
    showCopiedIndicator(mac ? HINT_FOR[reason] : null)
  }
  const platform = process.platform
  // Accessibility is granted when the paste itself failed: asking for it again would be wrong
  const macKey = MESSAGE_FOR[reason]
  // The pill link is out of reach of the keyboard: clicking the notice opens the pane too
  const opensPane = mac && HINT_FOR[reason] !== null
  notify(
    mac ? macKey : 'accessibility.copiedPlain',
    { paste: pasteKey(platform) },
    opensPane ? openAccessibilitySettings : undefined
  )
  log.info('Text left on the clipboard, told the user to paste', { reason })
}

function showAutomaticPasteNotice(): void {
  notify('accessibility.granted')
  log.info('Accessibility granted, pasting is automatic now')
}

/** Called right after the Accessibility prompt was shown. */
export function armAccessibilityHint(
  timers: Pick<AccessibilityWatchDeps, 'setInterval' | 'clearInterval'> = {}
): void {
  watchAccessibilityGrant({
    ...timers,
    isTrusted: () => checkAccessibilityPermission(false),
    onGranted: showAutomaticPasteNotice
  })
}
