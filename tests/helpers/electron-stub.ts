/**
 * Test double for the `electron` and `electron-store` packages.
 *
 * Import this file BEFORE any module from src/main. It hooks Node's module
 * loader so main-process code runs under plain Node, with the parts the tests
 * care about (ipcMain, dialog, safeStorage, app) recorded or faked and every
 * other Electron API replaced by a harmless no-op.
 */

import Module from 'node:module'
import type {} from 'electron' // brings in the global Electron types used by satisfies below
import childProcess from 'node:child_process'

/**
 * Guard: no test may run the real macOS `open` (it brings System Settings or other apps to the front
 * of the developer's screen). Any such call throws, with the stack that reached it.
 * A test that needs the behaviour injects its own runner instead.
 */
const COMMANDS_TESTS_MAY_NOT_RUN = /^\s*(?:\S*\/)?open(?:\s|$)/
for (const name of [
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'spawn',
  'spawnSync'
] as const) {
  const real = (childProcess as unknown as Record<string, (...args: unknown[]) => unknown>)[name]
  ;(childProcess as unknown as Record<string, unknown>)[name] = function (...args: unknown[]) {
    const first = String(args[0] ?? '')
    const line =
      Array.isArray(args[1]) && !/exec$|execSync$/.test(name)
        ? `${first} ${args[1].join(' ')}`
        : first
    if (COMMANDS_TESTS_MAY_NOT_RUN.test(line)) {
      throw new Error(
        `A test ran the real command: ${line}. Inject the opener instead of running it.`
      )
    }
    return real.apply(this, args)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (event: unknown, ...args: any[]) => any

export const ipc = {
  /** ipcMain.handle registrations */
  handlers: new Map<string, Handler>(),
  /** ipcMain.on registrations */
  listeners: new Map<string, Handler>()
}

/** Electron treats these spellings as one shortcut: `CmdOrCtrl+Shift+S` = `shift+commandorcontrol+s`. */
const canonical = (accelerator: string): string =>
  accelerator
    .split('+')
    .map((part) => part.toLowerCase().replace(/^cmdorctrl$/, 'commandorcontrol'))
    .sort()
    .join('+')
const holdsKey = (accelerator: string): string | undefined =>
  [...shortcuts.registered.keys()].find((key) => canonical(key) === canonical(accelerator))

/** globalShortcut fake: registered accelerators, with Electron's behaviour for bad ones. */
export const shortcuts = {
  registered: new Map<string, () => void>(),
  /** Accelerators another app already holds: register() returns false. */
  taken: new Set<string>(),
  /** Electron throws "conversion failure" for anything but ASCII keys. */
  parses: (accelerator: string): boolean => /^[\x20-\x7e]+$/.test(accelerator)
}

/** screen fake: the usable area every window is fitted into. */
export const screenState = {
  workArea: { x: 0, y: 25, width: 1440, height: 875 },
  cursor: { x: 0, y: 0 }
}

/** systemPreferences fake: what macOS reports for the screen. */
export const mediaAccess = { screen: 'granted', accessibility: true }

/**
 * The indicator's page. Like the real one it loads (did-start-loading, did-finish-load) and only
 * later does its renderer subscribe to messages and say "page ready"; a message sent to the page
 * before that is dropped. A test can turn the automatic steps off and drive them itself.
 */
export const pageState = {
  reloads: 0,
  /** reload() ends in a load a moment later */
  autoLoadOnReload: true,
  /** A finished load is followed by the renderer subscribing and saying "page ready" */
  autoRender: true,
  /** The renderer of the current page has subscribed to main's messages */
  subscribed: false,
  /** Whether the window manager already knew the window when the page began to load */
  windowRegisteredAtLoad: null as boolean | null,
  /** Messages main sent to the page before it subscribed */
  dropped: [] as Array<{ channel: string; args: unknown[] }>,
  handlers: new Map<string, Array<(...args: unknown[]) => void>>(),
  /** Fire a webContents event (render-process-gone, did-finish-load, ...) */
  emit(event: string, ...args: unknown[]): void {
    for (const h of [...(pageState.handlers.get(event) ?? [])]) h({}, ...args)
  },
  /** The renderer subscribed and tells main its page is ready */
  renderer(): void {
    pageState.subscribed = true
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../src/main/core/window-manager').markIndicatorPageReady()
  },
  /** A whole page load: it starts, finishes, and (unless turned off) the renderer comes up */
  load(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pageState.windowRegisteredAtLoad = !!require('../../src/main/core/window-manager').get(
      'listening'
    )
    pageState.subscribed = false
    pageState.emit('did-start-loading')
    pageState.emit('did-finish-load')
    if (pageState.autoRender) pageState.renderer()
  },
  /** The renderer process dies: its page hears nothing any more */
  crash(): void {
    pageState.subscribed = false
    pageState.emit('render-process-gone', { reason: 'crashed' })
  }
}

/** Messages sent to windows and sizes set, in one list so their order can be checked */
export const callLog: string[] = []

/** Positions and sizes given to windows, in order */
export const windowCalls: Array<{ call: 'setPosition' | 'setSize' | 'setBounds'; args: number[] }> =
  []

/** Which pages (settings.html, permissions.html, ...) were shown, in order. */
export const shownPages: string[] = []
/** Messages sent to any window: { channel, args }. */
export const sentMessages: Array<{ channel: string; args: unknown[] }> = []
/** The last tray menu template passed to Menu.buildFromTemplate. */
export const trayMenu: { items: Array<{ label?: string; click?: () => void }> } = { items: [] }

/** URLs passed to shell.openExternal */
export const openedExternal: string[] = []

/** Text written with clipboard.writeText */
export const clipboardWrites: string[] = []

/** Notifications shown with new Notification({...}).show() */
export const notifications: Array<{ title?: string; body?: string }> = []
/** The notification objects, in the same order (to click or close them in a test) */
export const shownNotifications: Array<{ emit: (event: string) => void }> = []
/** Click handlers of the notifications above, same order (undefined: none registered) */
export const notificationClicks: Array<(() => void) | undefined> = []

export const dialogs: Array<{ title: string; message: string }> = []

/** app.dock fake: whether the icon is shown, and every call in order */
export const dockState = { visible: true, deferShow: false, calls: [] as string[] }

export const appState = {
  /** macOS: the app is hidden (Cmd+H) */
  hidden: false,
  /** Handlers registered with app.on(...), to fire in a test */
  handlers: new Map<string, Array<() => void>>(),
  name: '',
  paths: new Map<string, string>([['appData', '/tmp/fake-app-data']]),
  encryptionAvailable: true,
  /** Switches present on the fake command line, e.g. 'user-data-dir' */
  switches: new Set<string>(),
  /** What macOS reports as the user's languages (app.getLocale() is not reliable) */
  preferred: ['en-US'] as string[]
}

function noop(): any {
  const fn: any = new Proxy(function () {}, {
    get: (_t, key) => (key === 'then' || key === Symbol.toPrimitive ? undefined : noop()),
    apply: () => undefined,
    construct: () => noop()
  })
  return fn
}

let windowIds = 0

const electron: Record<string, any> = {
  ipcMain: {
    handle: (channel: string, handler: Handler) => ipc.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => ipc.listeners.set(channel, handler),
    removeHandler: () => undefined
  },
  dialog: {
    showErrorBox: (title: string, message: string) => dialogs.push({ title, message }),
    showMessageBox: async () => ({ response: 0, checkboxChecked: false })
  } satisfies Partial<Electron.Dialog>,
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0-test',
    setName: (name: string) => {
      appState.name = name
    },
    getName: () => appState.name,
    setPath: (key: string, value: string) => appState.paths.set(key, value),
    getPath: (key: string) => appState.paths.get(key) ?? `/tmp/fake-${key}`,
    getPreferredSystemLanguages: () => appState.preferred,
    commandLine: { hasSwitch: (name: string) => appState.switches.has(name) },
    on: (event: string, handler: () => void) => {
      appState.handlers.set(event, [...(appState.handlers.get(event) ?? []), handler])
    },
    isHidden: () => appState.hidden,
    dock: {
      isVisible: () => dockState.visible,
      show: async () => {
        if (!dockState.deferShow) dockState.visible = true
        dockState.calls.push('show')
      },
      hide: () => {
        dockState.visible = false
        dockState.calls.push('hide')
      }
    },
    whenReady: () => new Promise(() => undefined)
  },
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => {
      if (!shortcuts.parses(accelerator)) throw new Error('conversion failure')
      // Electron refuses an accelerator this app already holds, too
      if (shortcuts.taken.has(accelerator) || holdsKey(accelerator) !== undefined) return false
      shortcuts.registered.set(accelerator, callback)
      return true
    },
    unregister: (accelerator: string) => {
      const key = holdsKey(accelerator)
      if (key !== undefined) shortcuts.registered.delete(key)
    },
    unregisterAll: () => shortcuts.registered.clear(),
    isRegistered: (accelerator: string) => holdsKey(accelerator) !== undefined
  } satisfies Partial<Electron.GlobalShortcut>,
  screen: {
    getDisplayMatching: () => ({ workArea: screenState.workArea }),
    getAllDisplays: () => [],
    getDisplayNearestPoint: () => ({
      bounds: screenState.workArea,
      workArea: screenState.workArea
    }),
    getPrimaryDisplay: () => ({
      id: 1,
      scaleFactor: 2,
      bounds: screenState.workArea,
      size: screenState.workArea,
      workArea: screenState.workArea,
      workAreaSize: screenState.workArea
    }),
    getCursorScreenPoint: () => screenState.cursor
  },
  systemPreferences: {
    getMediaAccessStatus: (kind: string) => (kind === 'screen' ? mediaAccess.screen : 'granted'),
    isTrustedAccessibilityClient: () => mediaAccess.accessibility
  },
  BrowserWindow: class FakeWindow {
    static getAllWindows = (): unknown[] => []
    static getFocusedWindow = (): unknown => null
    private page = ''
    private visible = false
    private minimized = false
    private eventHandlers = new Map<string, Array<() => void>>()
    private isIndicatorPageHere = (): boolean => this.page === 'listening.html'
    webContents = new Proxy(
      {
        id: ++windowIds,
        mainFrame: { url: `file://${TRUSTED_RENDERER_DIR}/listening.html`, parent: null },
        send: (channel: string, ...args: unknown[]) => {
          if (this.isIndicatorPageHere() && !pageState.subscribed) {
            pageState.dropped.push({ channel, args })
            return
          }
          sentMessages.push({ channel, args })
          callLog.push(`send:${channel}`)
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'render-process-gone') {
            // A re-created indicator window replaces the old watcher (tests re-register windows)
            pageState.handlers.clear()
            pageState.handlers.set(event, [handler])
            return
          }
          pageState.handlers.set(event, [...(pageState.handlers.get(event) ?? []), handler])
        },
        once: (event: string, handler: (...args: unknown[]) => void) => {
          pageState.handlers.set(event, [...(pageState.handlers.get(event) ?? []), handler])
        },
        removeListener: (event: string, handler: (...args: unknown[]) => void) => {
          pageState.handlers.set(
            event,
            (pageState.handlers.get(event) ?? []).filter((h) => h !== handler)
          )
        },
        reload: () => {
          pageState.reloads++
          pageState.subscribed = false
          if (pageState.autoLoadOnReload) setImmediate(() => pageState.load())
        },
        isDestroyed: () => false
      },
      { get: (target, key: string) => (key in target ? (target as any)[key] : noop()) }
    )
    constructor() {
      const self = this
      return new Proxy(self, {
        get: (target, key: string | symbol) => (key in target ? (target as any)[key] : noop())
      })
    }
    loadFile(path: string): void {
      this.page = path.split('/').pop() ?? ''
      // The indicator page loads at once in tests; the window is registered by now
      if (this.page === 'listening.html') pageState.load()
    }
    show(): void {
      this.visible = true
      shownPages.push(this.page)
      this.emitWindowEvent('show')
    }
    showInactive(): void {
      this.visible = true
      shownPages.push(this.page)
    }
    getSize(): number[] {
      return this.size
    }
    private size = [400, 300]
    private bounds = { x: 0, y: 0, width: 400, height: 300 }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.bounds
    }
    setSize(width: number, height: number): void {
      this.size = [width, height]
      windowCalls.push({ call: 'setSize', args: [width, height] })
      callLog.push(`setSize:${width}x${height}`)
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.size = [bounds.width, bounds.height]
      this.bounds = bounds
      windowCalls.push({
        call: 'setBounds',
        args: [bounds.x, bounds.y, bounds.width, bounds.height]
      })
      callLog.push(`setBounds:${bounds.width}x${bounds.height}`)
    }
    setPosition(x: number, y: number): void {
      windowCalls.push({ call: 'setPosition', args: [x, y] })
    }
    hide(): void {
      this.visible = false
      this.emitWindowEvent('hide')
    }
    on(event: string, handler: () => void): this {
      this.eventHandlers.set(event, [...(this.eventHandlers.get(event) ?? []), handler])
      return this
    }
    /** Test helper: the window manager's own window events (minimize, restore, hide) */
    emitWindowEvent(event: string): void {
      if (event === 'minimize') this.minimized = true
      if (event === 'restore') this.minimized = false
      for (const h of this.eventHandlers.get(event) ?? []) h()
    }
    isMinimized(): boolean {
      return this.minimized
    }
    isVisible(): boolean {
      return this.visible
    }
  },
  shell: {
    openExternal: async (url: string) => void openedExternal.push(url)
  } satisfies Partial<Electron.Shell>,
  Menu: {
    buildFromTemplate: (items: Array<{ label?: string; click?: () => void }>) => {
      trayMenu.items = items
      return {}
    },
    setApplicationMenu: () => undefined
  },
  safeStorage: {
    isEncryptionAvailable: () => appState.encryptionAvailable,
    isAsyncEncryptionAvailable: async () => appState.encryptionAvailable,
    encryptStringAsync: async (plain: string) => Buffer.from(`enc:${plain}`),
    decryptStringAsync: async (buf: Buffer) => ({ result: buf.toString().replace(/^enc:/, '') }),
    encryptString: (plain: string) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
    decryptString: (buf: Buffer) => [...buf.toString().replace(/^enc:/, '')].reverse().join('')
  },
  Notification: class FakeNotification {
    static isSupported = (): boolean => true
    private handlers = new Map<string, () => void>()
    constructor(private readonly options: { title?: string; body?: string }) {}
    on(event: string, handler: () => void): this {
      this.handlers.set(event, handler)
      return this
    }
    /** Test helper: the user clicked or dismissed the notification */
    emit(event: string): void {
      this.handlers.get(event)?.()
    }
    show(): void {
      notifications.push(this.options)
      notificationClicks.push(this.handlers.get('click'))
      shownNotifications.push(this)
    }
  },
  // `satisfies Partial<Electron.X>`: a method Electron does not have fails `npm run check`
  clipboard: {
    writeText: async (text: string) => void clipboardWrites.push(text)
  } satisfies Partial<Electron.Clipboard>,
  nativeImage: { createFromBuffer: () => ({}), createFromPath: () => ({ setTemplateImage() {} }) }
}

/** The fake window class, so a test can spy on a method */
export const FakeBrowserWindow = electron.BrowserWindow

const electronProxy = new Proxy(electron, {
  get: (target, key: string) => (key in target ? target[key] : noop())
})

class FakeStore {
  private data = new Map<string, unknown>()
  constructor(options?: { defaults?: Record<string, unknown> }) {
    for (const [k, v] of Object.entries(options?.defaults ?? {})) this.data.set(k, v)
  }
  get(key: string): unknown {
    return this.data.get(key)
  }
  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }
  delete(key: string): void {
    this.data.delete(key)
  }
}

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown
const moduleInternals = Module as unknown as { _load: Loader }
const originalLoad = moduleInternals._load

moduleInternals._load = function (request, parent, isMain) {
  if (request === 'electron') return electronProxy
  if (request === 'electron-store') return { __esModule: true, default: FakeStore }
  return originalLoad.call(this, request, parent, isMain)
}

export function resetRecorded(): void {
  ipc.handlers.clear()
  ipc.listeners.clear()
  dialogs.length = 0
  clipboardWrites.length = 0
  openedExternal.length = 0
  notifications.length = 0
  notificationClicks.length = 0
  shownNotifications.length = 0
  shownPages.length = 0
  windowCalls.length = 0
  callLog.length = 0
  pageState.reloads = 0
  pageState.autoLoadOnReload = true
  pageState.autoRender = true
  pageState.dropped.length = 0
  sentMessages.length = 0
  shortcuts.registered.clear()
  shortcuts.taken.clear()
  mediaAccess.screen = 'granted'
  dockState.visible = true
  dockState.deferShow = false
  dockState.calls.length = 0
  mediaAccess.accessibility = true
}

/** Directory the guard treats as "our own pages" in tests. */
export const TRUSTED_RENDERER_DIR = '/fake/app/out/renderer'

/** An IPC event as sent by one of our own windows. */
export const trustedEvent = {
  senderFrame: { url: `file://${TRUSTED_RENDERER_DIR}/settings.html`, parent: null }
}

// Tell the IPC guard which pages are ours (loaded lazily: it needs the hook above)
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/main/core/trust-config').setTrustConfig({ rendererDir: TRUSTED_RENDERER_DIR })

// A test never starts the real key helper (it would watch the real keyboard)
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/main/services/key-helper').blockRealKeyHelperForTests()
