/**
 * Window Manager - Centralized window management
 *
 * Provides unified API for creating, showing, hiding windows.
 * Implements Window Recycling pattern (pre-create with show: false).
 * All window operations go through this manager.
 */

import { BrowserWindow, app, screen, BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { createLogger } from './logger'
import { hardenWebContents } from './web-hardening'
import { getTrustConfig } from './trust-config'
import { fitHeight } from './window-fit'
import { bottomCenterPosition } from './indicator-position'
import {
  watchIndicator,
  type GateEvents,
  type IndicatorGate
} from '../services/dictation/indicator-gate'
import type { CopiedHint, DictationErrorPayload } from '../../shared/types'

const log = createLogger('WindowManager')

// ============================================================================
// Types
// ============================================================================

export type WindowType =
  'setup' | 'settings' | 'capture' | 'result' | 'listening' | 'permissions' | 'toast'

export interface WindowConfig {
  type: WindowType
  options: BrowserWindowConstructorOptions
  htmlPath: string
  devHtmlPath?: string
  /** Custom show behavior (e.g., showInactive for listening) */
  showBehavior?:
    | 'normal'
    | 'inactive'
    | 'cursor-position'
    | 'cursor-position-inactive'
    | 'bottom-center'
    | 'active-monitor'
  /** Whether to show dock when showing this window (macOS) */
  showDock?: boolean
  /** Whether to prevent close (hide instead) */
  preventClose?: boolean
  /** Post-creation setup (e.g., setFocusable, setVisibleOnAllWorkspaces) */
  postCreate?: (win: BrowserWindow) => void
}

interface WindowState {
  window: BrowserWindow | null
  config: WindowConfig
  isQuitting: boolean
}

// ============================================================================
// Window Registry
// ============================================================================

let indicatorEvents: Pick<GateEvents, 'onGone' | 'onDead'> | null = null
let indicatorGate: IndicatorGate | null = null
const readyListeners: Array<() => void> = []
const notReadyListeners: Array<() => void> = []

/** Dictation says what to do when the indicator's renderer dies or stays dead. */
export function setIndicatorEvents(events: Pick<GateEvents, 'onGone' | 'onDead'>): void {
  indicatorEvents = events
}

/** Called each time the indicator page has finished loading. */
export function onIndicatorReady(listener: () => void): void {
  readyListeners.push(listener)
}

/** Called each time the indicator page stops being ready (it crashed). */
export function onIndicatorNotReady(listener: () => void): void {
  notReadyListeners.push(listener)
}

/** True once the indicator page has loaded and has not died since. */
// Without an indicator window the indicator is not usable
export const isIndicatorReady = (): boolean => indicatorGate?.isReady() ?? false

/** The indicator page subscribed to main's messages. */
export const markIndicatorPageReady = (): void => indicatorGate?.pageReady()

/** The indicator page cannot render (an error in the page): treated like a crash of its renderer. */
export const markIndicatorPageBroken = (): void => indicatorGate?.pageBroken()

/** True for a message sent by the indicator's main frame, not by a stale or nested frame. */
export const isFromIndicatorMainFrame = (event: {
  sender?: { id: number }
  senderFrame?: unknown
}): boolean => {
  const win = get('listening')
  return isFromListeningWindow(event) && event.senderFrame === win?.webContents.mainFrame
}

/** For a hotkey press: whether the indicator can be used now (a dead page is reloaded if allowed). */
export const requestIndicator = (): 'ready' | 'loading' | 'dead' =>
  indicatorGate?.request() ?? 'loading'

const windowRegistry = new Map<WindowType, WindowState>()

// ============================================================================
// Helper Functions
// ============================================================================

function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function getRendererUrl(htmlPath: string, devHtmlPath?: string): string {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/${devHtmlPath || htmlPath}`
  }
  return ''
}

function getRendererFilePath(htmlPath: string): string {
  return join(__dirname, '../renderer', htmlPath)
}

function loadWindow(win: BrowserWindow, htmlPath: string, devHtmlPath?: string): void {
  const url = getRendererUrl(htmlPath, devHtmlPath)
  if (url) {
    win.loadURL(url)
  } else {
    win.loadFile(getRendererFilePath(htmlPath))
  }
}

// ============================================================================
// Window Manager Implementation
// ============================================================================

/**
 * Register a window configuration.
 * Must be called before createAll().
 */
export function register(config: WindowConfig): void {
  if (windowRegistry.has(config.type)) {
    log.warn('Window already registered, overwriting', { type: config.type })
  }
  windowRegistry.set(config.type, {
    window: null,
    config,
    isQuitting: false
  })
  log.debug('Window registered', { type: config.type })
}

/**
 * Create all registered windows.
 * Windows are created hidden (show: false) for Window Recycling pattern.
 */
export function createAll(): void {
  log.info('Creating all windows')
  for (const [type, state] of windowRegistry) {
    if (state.window) {
      log.debug('Window already exists, skipping', { type })
      continue
    }
    createWindow(type)
  }
}

/**
 * Create a single window by type.
 */
function createWindow(type: WindowType): BrowserWindow | null {
  const state = windowRegistry.get(type)
  if (!state) {
    log.error('Window not registered', undefined, { type })
    return null
  }

  const { config } = state
  const options: BrowserWindowConstructorOptions = {
    ...config.options,
    show: false, // Always create hidden for Window Recycling
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...config.options.webPreferences
    }
  }

  const win = new BrowserWindow(options)
  // Registered before anything loads: load events can already look the window up
  state.window = win

  hardenWebContents(win.webContents, getTrustConfig())
  if (config.type === 'listening') {
    const gateEvents: GateEvents = {
      // A page that is not ready has no window on screen: a dead page would sit there and eat clicks
      onNotReady: () => {
        send('listening', 'listening-mode-stop')
        hide('listening')
        notReadyListeners.forEach((listener) => listener())
      },
      onGone: () => indicatorEvents?.onGone(),
      onDead: () => indicatorEvents?.onDead(),
      onReady: () => readyListeners.forEach((listener) => listener())
    }
    indicatorGate = watchIndicator(win.webContents, () => gateEvents, {
      isQuitting: () => [...windowRegistry.values()].some((w) => w.isQuitting)
    })
  }

  if (BLOCKING.includes(config.type)) {
    // Minimized or hidden by the system counts as gone; restored counts as back
    win.on('minimize', () => notifyBlockingHidden(config.type))
    win.on('hide', () => notifyBlockingHidden(config.type))
    win.on('restore', () => blockingShownListeners.forEach((listener) => listener()))
    // Shown by the system (the app was unhidden): the card steps aside again
    win.on('show', () => blockingShownListeners.forEach((listener) => listener()))
  }

  // The Dock icon (and Cmd+Tab) follows the windows that need it
  if (config.showDock) {
    win.on('hide', () => syncDock())
    // Cmd+H hides every window without closing them; showing the app again brings the icon back
    win.on('show', () => {
      if (dockCheckSkipped) syncDock()
    })
  }

  // Handle close event - hide instead of destroy if preventClose is true
  if (config.preventClose) {
    win.on('close', (event) => {
      if (!state.isQuitting) {
        event.preventDefault()
        if (config.type === 'setup') setupReason = undefined
        win.hide()
        notifyBlockingHidden(config.type)
      }
    })
  }

  // Load HTML
  loadWindow(win, config.htmlPath, config.devHtmlPath)

  // Post-creation setup
  if (config.postCreate) {
    config.postCreate(win)
  }

  log.debug('Window created', { type })
  return win
}

/** A window hid while the whole app was hidden: the Dock check waits for the app to come back. */
let dockCheckSkipped = false
// LSUIElement starts hidden; bootstrap also hides the Dock before any window is shown.
let dockNeeded = false
let dockShowPending = false

function setDockNeeded(needed: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) return
  // Cmd+H and bootstrap can change the actual state outside our window transitions.
  // show() is asynchronous: its requested state wins until that transition finishes.
  const visible = dockShowPending ? dockNeeded : app.dock.isVisible()
  if (dockNeeded !== visible) dockNeeded = visible
  if (dockNeeded === needed) return
  dockNeeded = needed
  if (needed) {
    dockShowPending = true
    void app.dock
      .show()
      .catch((error) => log.warn('Could not show Dock icon', { message: String(error) }))
      .finally(() => {
        dockShowPending = false
      })
  } else app.dock.hide()
}

/**
 * Dock icon hidden unless a window that asked for it is open (a minimized one still counts).
 * While the whole app is hidden (Cmd+H) the windows are only out of sight: the icon stays.
 */
function syncDock(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (isAppHidden()) {
    dockCheckSkipped = true
    return
  }
  dockCheckSkipped = false
  const needed = [...windowRegistry.values()].some(
    ({ window, config }) =>
      config.showDock && !!window && (window.isVisible() || window.isMinimized())
  )
  setDockNeeded(needed)
}

/**
 * Get a window instance by type.
 */
export function get(type: WindowType): BrowserWindow | null {
  const state = windowRegistry.get(type)
  return state?.window ?? null
}

/**
 * Show a window by type.
 */
export function show(type: WindowType): void {
  const state = windowRegistry.get(type)
  if (!state?.window) {
    log.warn('Window not found', { type })
    return
  }

  const { window: win, config } = state

  // Show dock if configured (macOS)
  if (config.showDock) setDockNeeded(true)

  // Apply show behavior
  switch (config.showBehavior) {
    case 'inactive':
      win.showInactive()
      break
    case 'cursor-position':
      positionNearCursor(win)
      win.show()
      win.focus()
      break
    case 'cursor-position-inactive':
      positionNearCursor(win)
      win.showInactive()
      win.setAlwaysOnTop(true, 'floating')
      break
    case 'bottom-center':
      positionBottomCenter(win)
      win.showInactive()
      break
    case 'active-monitor':
      positionOnActiveMonitor(win)
      win.show()
      win.focus()
      win.setAlwaysOnTop(true, 'screen-saver')
      break
    default:
      win.show()
      win.focus()
  }

  log.debug('Window shown', { type, behavior: config.showBehavior || 'normal' })
  if (BLOCKING.includes(type)) blockingShownListeners.forEach((listener) => listener())
}

/**
 * Hide a window by type.
 */
export function hide(type: WindowType): void {
  const state = windowRegistry.get(type)
  if (state?.window) {
    state.window.hide()
    log.debug('Window hidden', { type })
    notifyBlockingHidden(type)
  }
}

const BLOCKING: readonly WindowType[] = ['setup', 'permissions', 'capture']
const blockingHiddenListeners: Array<() => void> = []
const blockingShownListeners: Array<() => void> = []

/** Called when a setup, permissions or capture window comes on screen. */
export function onBlockingWindowShown(listener: () => void): void {
  blockingShownListeners.push(listener)
}

/** Called when a setup, permissions or capture window goes away. */
export function onBlockingWindowHidden(listener: () => void): void {
  blockingHiddenListeners.push(listener)
}

function notifyBlockingHidden(type: WindowType): void {
  if (BLOCKING.includes(type)) blockingHiddenListeners.forEach((listener) => listener())
}

/** True while a setup, permissions or capture window is on screen: a card must not cover it. */
export const isBlockingWindowVisible = (): boolean => BLOCKING.some((type) => isShownOnScreen(type))

/** Visible and not minimized. */
function isShownOnScreen(type: WindowType): boolean {
  const win = get(type)
  return !!win && win.isVisible() && !win.isMinimized()
}

/** macOS: the app is hidden (Cmd+H). Nothing of ours should come on screen then. */
export const isAppHidden = (): boolean =>
  process.platform === 'darwin' && typeof app.isHidden === 'function' && app.isHidden()

/** True while the capture overlay is on screen: Esc belongs to it. */
export const isCaptureOverlayVisible = (): boolean => isShownOnScreen('capture')

/**
 * Send IPC message to a window.
 */
export function send(type: WindowType, channel: string, ...args: unknown[]): void {
  const state = windowRegistry.get(type)
  if (state?.window) {
    state.window.webContents.send(channel, ...args)
    log.debug('IPC sent to window', { type, channel })
  }
}

/**
 * Set quitting flag for a window.
 * When true, close event will not be prevented.
 */
export function setQuitting(type: WindowType, quitting: boolean): void {
  const state = windowRegistry.get(type)
  if (state) {
    state.isQuitting = quitting
    log.debug('Window quitting flag set', { type, quitting })
  }
}

/**
 * Set quitting flag for all windows.
 */
export function setAllQuitting(quitting: boolean): void {
  for (const [, state] of windowRegistry) {
    state.isQuitting = quitting
  }
  log.debug('All windows quitting flag set', { quitting })
}

/**
 * Get window bounds (for capture window coordinate calculations).
 */
export function getBounds(type: WindowType): Electron.Rectangle | null {
  const state = windowRegistry.get(type)
  return state?.window?.getBounds() ?? null
}

/**
 * Check if a window is visible.
 */
export function isVisible(type: WindowType): boolean {
  const state = windowRegistry.get(type)
  return state?.window?.isVisible() ?? false
}

/**
 * Check if a window is minimized.
 */
export function isMinimized(type: WindowType): boolean {
  const state = windowRegistry.get(type)
  return state?.window?.isMinimized() ?? false
}

/**
 * Restore a minimized window.
 */
export function restore(type: WindowType): void {
  const state = windowRegistry.get(type)
  if (state?.window?.isMinimized()) {
    state.window.restore()
  }
}

/**
 * Focus a window.
 */
export function focus(type: WindowType): void {
  const state = windowRegistry.get(type)
  state?.window?.focus()
}

/**
 * Destroy a window (for cleanup).
 */
export function destroy(type: WindowType): void {
  const state = windowRegistry.get(type)
  if (state?.window) {
    state.window.destroy()
    state.window = null
    log.debug('Window destroyed', { type })
  }
}

/**
 * Hide all windows.
 */
export function hideAll(): void {
  for (const [type] of windowRegistry) {
    hide(type)
  }
}

// ============================================================================
// Position Helpers
// ============================================================================

/**
 * Position window near cursor (for result window).
 */
function positionNearCursor(win: BrowserWindow): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { bounds } = activeDisplay
  const windowSize = win.getSize()

  const offset = 20
  let x = cursorPoint.x + offset
  let y = cursorPoint.y + offset

  // Adjust if window would go off the right edge
  if (x + windowSize[0] > bounds.x + bounds.width) {
    x = cursorPoint.x - windowSize[0] - offset
  }

  // Adjust if window would go off the bottom edge
  if (y + windowSize[1] > bounds.y + bounds.height) {
    y = cursorPoint.y - windowSize[1] - offset
  }

  // Ensure window doesn't go off the left or top edge
  x = Math.max(bounds.x, x)
  y = Math.max(bounds.y, y)

  win.setPosition(x, y)
}

let listeningSize: [number, number] = [240, 70]

/**
 * Position window at bottom-center of active screen (for listening indicator).
 */
function positionBottomCenter(win: BrowserWindow): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursorPoint)
  const [width, height] = listeningSize
  const { x, y } = bottomCenterPosition([width, height], workArea)
  // One call: a separate resize and move would show the window once at the old position
  win.setBounds({ x, y, width, height })
}

/**
 * Position window on active monitor (for capture overlay).
 */
function positionOnActiveMonitor(win: BrowserWindow): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  win.setBounds(activeDisplay.bounds)
}

const baseContentHeight = new WeakMap<BrowserWindow, number>()

/**
 * Fit a window to the height its page needs (no scrollbar), growing or shrinking
 * back to its configured size. Works on content bounds: a native title bar
 * (Windows/Linux) is not part of the page.
 */
export function fitWindowHeight(win: BrowserWindow, neededHeight: number): void {
  const bounds = win.getContentBounds()
  if (!baseContentHeight.has(win)) baseContentHeight.set(win, bounds.height)
  const { workArea } = screen.getDisplayMatching(win.getBounds())
  const next = fitHeight({
    bounds,
    preferredHeight: neededHeight,
    minHeight: baseContentHeight.get(win) ?? bounds.height,
    frameHeight: win.getBounds().height - bounds.height,
    workArea
  })
  if (next) win.setContentBounds(next, win.isVisible())
}

/** Back to the configured height after a page asked for more (a new text starts small). */
export function resetWindowHeight(win: BrowserWindow): void {
  const base = baseContentHeight.get(win)
  if (base === undefined) return
  const bounds = win.getContentBounds()
  if (bounds.height === base) return
  win.setContentBounds({ ...bounds, height: base }, win.isVisible())
}

// ============================================================================
// Window Configurations
// ============================================================================

/**
 * Register all default window configurations.
 * Call this during app initialization.
 */
export function registerDefaultWindows(): void {
  // Setup Window (first run: paste the API key)
  register({
    type: 'setup',
    htmlPath: 'setup.html',
    devHtmlPath: 'setup.html',
    showDock: true,
    preventClose: true,
    options: {
      width: 500,
      height: 600,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 10 } }
        : {}),
      backgroundColor: '#1a1a2e'
    }
  })

  // Settings Window
  register({
    type: 'settings',
    htmlPath: 'settings.html',
    devHtmlPath: 'settings.html',
    showDock: true,
    preventClose: true,
    options: {
      width: 800,
      height: 780,
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 10 } }
        : {}),
      backgroundColor: '#1a1a2e'
    }
  })

  // Capture Window
  register({
    type: 'capture',
    htmlPath: 'index.html',
    showBehavior: 'active-monitor',
    options: {
      ...screen.getPrimaryDisplay().bounds,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      backgroundColor: '#00000000'
    },
    postCreate: (win) => {
      win.setAlwaysOnTop(true, 'screen-saver')
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }
    }
  })

  // Result Window
  register({
    type: 'result',
    htmlPath: 'result.html',
    devHtmlPath: 'result.html',
    showBehavior: 'cursor-position-inactive',
    options: {
      width: 450,
      height: 350,
      minWidth: 300,
      minHeight: 200,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: true,
      skipTaskbar: true,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {})
    }
  })

  // Listening Indicator Window
  register({
    type: 'listening',
    htmlPath: 'listening.html',
    devHtmlPath: 'listening.html',
    showBehavior: 'bottom-center',
    options: {
      width: 240,
      height: 70,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {})
    },
    postCreate: (win) => {
      win.setFocusable(false)
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }
    }
  })

  // Toast: a short message near the cursor that never takes the keyboard
  register({
    type: 'toast',
    htmlPath: 'toast.html',
    devHtmlPath: 'toast.html',
    showBehavior: 'cursor-position-inactive',
    options: {
      width: 220,
      height: 48,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {})
    },
    postCreate: (win) => {
      win.setFocusable(false)
      win.setIgnoreMouseEvents(true) // a message must never eat a click
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }
    }
  })

  // Permissions Window
  register({
    type: 'permissions',
    htmlPath: 'permissions.html',
    devHtmlPath: 'permissions.html',
    showDock: true,
    preventClose: true,
    options: {
      width: 450,
      // Starts compact; the page asks to grow when a language needs more room
      height: 560,
      resizable: false,
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 10 } }
        : {}),
      backgroundColor: '#1a1a2e'
    }
  })

  log.info('Default windows registered')
}

// ============================================================================
// Convenience Functions (for backward compatibility)
// ============================================================================

// Setup window helpers
// A message sent before the page has loaded is lost, so the page also reads the
// last requested screen on load (e.g. "Try it now" right after a relaunch).
let setupReason: string | undefined
export const getSetupReason = (): string | undefined => setupReason
export const showSetupWindow = (reason?: string): void => {
  setupReason = reason
  show('setup')
  send('setup', 'setup-reset', reason) // Reset UI state when showing
}
export const hideSetupWindow = (): void => {
  setupReason = undefined
  hide('setup')
}

// Settings window helpers
export const getSettingsWindow = () => get('settings')
export const showSettingsWindow = () => show('settings')
export const hideSettingsWindow = () => hide('settings')

// Capture window helpers
export const showCaptureWindow = () => show('capture')
export const hideCaptureWindow = () => hide('capture')
/** True for a message sent by the open selection overlay, not by any other window. */
export const isFromOpenOverlay = (event: { sender?: { id: number } }): boolean => {
  const overlay = get('capture')
  return (
    !!overlay &&
    !!event.sender &&
    overlay.webContents.id === event.sender.id &&
    isVisible('capture')
  )
}
export const getCaptureWindowBounds = () => getBounds('capture')

// Result window helpers
export const showResultWindow = () => show('result')
export const hideResultWindow = () => hide('result')
export const sendTranslationStart = () => send('result', 'translation-start')
export const sendTranslationResult = (result: {
  success: boolean
  text?: string
  source?: string
  error?: string
  errorCode?: string
  partial?: string
}) => send('result', 'translation-complete', result)
export const sendTranslationPartial = (text: string) => send('result', 'translation-partial', text)

// Toast helpers
export const showToastWindow = (text: string) => {
  send('toast', 'toast-show', text)
  show('toast')
}
export const hideToastWindow = () => hide('toast')

// Listening indicator helpers
const PILL_SIZE: [number, number] = [240, 70]
const ERROR_SIZE: [number, number] = [360, 124]

/** The pill, or the larger card that has room for an error message. */
export const showListeningIndicator = (layout: 'pill' | 'error' = 'pill') => {
  listeningSize = layout === 'error' ? ERROR_SIZE : PILL_SIZE
  show('listening')
}
export const hideListeningIndicator = () => hide('listening')

/** True when the mouse pointer is inside the indicator window right now. */
export function isCursorOverIndicator(): boolean {
  const win = get('listening')
  if (!win || !win.isVisible()) return false
  // The page is the window minus its 4 px padding: the padding is not "over" the pill
  const bounds = win.getBounds()
  const [x, y, width, height] = [bounds.x + 4, bounds.y + 4, bounds.width - 8, bounds.height - 8]
  const point = screen.getCursorScreenPoint()
  return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
}
export const sendStartListening = (session: number) =>
  send('listening', 'listening-mode-start', session)
export const sendStartProcessing = (retrying = false) =>
  send('listening', 'listening-mode-processing', retrying)
export const sendProcessingText = (text: string) => send('listening', 'listening-mode-text', text)
export const sendListeningCopied = (hint: CopiedHint = null) =>
  send('listening', 'listening-mode-copied', hint)
export const sendStopListening = () => send('listening', 'listening-mode-stop')
export const sendListeningError = (payload: DictationErrorPayload) =>
  send('listening', 'listening-mode-error', payload)
/** True for a message sent by the indicator window, not by any other window. */
export const isFromListeningWindow = (event: { sender?: { id: number } }): boolean => {
  const indicator = get('listening')
  return !!indicator && !!event.sender && indicator.webContents.id === event.sender.id
}

// Permissions window helpers
export const showPermissionsWindow = (): void => {
  show('permissions')
  send('permissions', 'permissions-window-shown')
}
export const hidePermissionsWindow = (): void => {
  send('permissions', 'permissions-window-hidden')
  hide('permissions')
}
