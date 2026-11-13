/** createLifecycleConfig() run against the electron stub: Dock and window behaviour of the real callbacks. */

import './helpers/electron-stub'
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  dockState,
  ipc,
  mediaAccess,
  resetRecorded,
  shownPages,
  trayMenu,
  trustedEvent
} from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const bootstrap = require('../src/main/core/app-bootstrap')
const { apiKeyStore } = require('../src/main/services/api-key')
const { markTryItSeen, store } = require('../src/main/services/store')

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('lifecycle callbacks', () => {
  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })
  beforeEach(() => {
    resetRecorded()
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    dockState.visible = false
    dockState.calls.length = 0
  })

  it('onReady hides the Dock icon before any window is shown', async () => {
    dockState.visible = true
    const config = bootstrap.createLifecycleConfig()
    await config.onReady()
    assert.equal(dockState.calls[0], 'hide')
  })

  it('the tray shows the repaired shortcut, not the plain one stored on disk', async () => {
    const {
      setCaptureShortcut,
      getCaptureShortcut,
      defaultShortcut
    } = require('../src/main/services/store')
    const { hotkeyManager } = require('../src/main/core/hotkey-manager')
    const noop = { normalCallback: () => {}, protectedCallback: () => {} }
    hotkeyManager.unregisterAll()
    hotkeyManager.initialize({ capture: noop, dictation: noop })
    setCaptureShortcut('Command+S')
    const config = bootstrap.createLifecycleConfig()
    await config.onReady()
    const shown = (trayMenu.items as Array<{ accelerator?: string }>).map((i) => i.accelerator)
    assert.equal(getCaptureShortcut(), defaultShortcut('capture'))
    assert.ok(shown.includes(defaultShortcut('capture')), String(shown))
    assert.equal(shown.includes('Command+S'), false)
    hotkeyManager.unregisterAll()
  })

  it('reopening from the Dock brings Settings back with its Dock icon', () => {
    const config = bootstrap.createLifecycleConfig()
    windowManager.showSettingsWindow()
    windowManager.hideSettingsWindow()
    assert.equal(dockState.visible, false)
    config.onActivate()
    assert.equal(dockState.visible, true)
  })

  it('a second launch brings Settings back with its Dock icon, restoring it if minimized', async () => {
    const config = bootstrap.createLifecycleConfig()
    windowManager.showSettingsWindow()
    await new Promise<void>((resolve) => setImmediate(resolve)) // native Dock show has settled
    const win = windowManager.getSettingsWindow()
    win.emitWindowEvent('minimize')
    let restored = 0
    win.restore = () => {
      restored++
      win.emitWindowEvent('restore')
    }
    windowManager.hideSettingsWindow()
    dockState.visible = false
    config.onSecondInstance()
    assert.equal(restored, 1)
    assert.equal(dockState.visible, true)
  })

  describe('setup done', () => {
    beforeEach(() => {
      mediaAccess.screen = 'granted'
      mediaAccess.accessibility = true
      apiKeyStore.hasKey = () => true
      apiKeyStore.load = async () => undefined
    })

    it('the next window is up before setup closes: the Dock icon never hides in between', async () => {
      markTryItSeen()
      const config = bootstrap.createLifecycleConfig()
      await config.onReady()
      windowManager.hideSettingsWindow()
      windowManager.showSetupWindow()
      dockState.calls.length = 0
      ipc.listeners.get('setup-done')!(trustedEvent)
      await flush()
      assert.deepEqual(dockState.calls, []) // setup already needed the icon: no activation-policy change
      assert.equal(windowManager.isVisible('setup'), false)
      assert.equal(windowManager.isVisible('settings'), true)
      assert.equal(dockState.visible, true)
    })

    it('a first run goes to Try it now in the setup window, which stays open', async () => {
      store.set('tryItSeen', false)
      const config = bootstrap.createLifecycleConfig()
      await config.onReady()
      windowManager.showSetupWindow()
      ipc.listeners.get('setup-done')!(trustedEvent)
      await flush()
      assert.equal(windowManager.isVisible('setup'), true)
      assert.equal(dockState.visible, true)
    })
  })

  describe('start-up window', () => {
    beforeEach(() => {
      mediaAccess.screen = 'granted'
      mediaAccess.accessibility = true
      apiKeyStore.hasKey = () => true
      apiKeyStore.load = async () => undefined
      markTryItSeen()
    })

    it('a set-up app starts without a window, and a reopen then opens Settings', async () => {
      const config = bootstrap.createLifecycleConfig()
      await config.onReady()
      await flush()
      assert.deepEqual(shownPages, [])
      assert.equal(windowManager.isVisible('settings'), false)
      assert.equal(dockState.visible, false)
      config.onActivate()
      assert.equal(windowManager.isVisible('settings'), true)
    })

    it('a second instance of a silently started app opens Settings', async () => {
      const config = bootstrap.createLifecycleConfig()
      await config.onReady()
      config.onSecondInstance()
      assert.equal(windowManager.isVisible('settings'), true)
    })

    it('without Screen Recording the permissions window opens', async () => {
      mediaAccess.screen = 'denied'
      await bootstrap.createLifecycleConfig().onReady()
      await flush()
      assert.ok(shownPages.includes('permissions.html'), shownPages.join(','))
    })

    it('Try it now not yet seen: the setup window opens', async () => {
      store.set('tryItSeen', false)
      await bootstrap.createLifecycleConfig().onReady()
      await flush()
      assert.equal(windowManager.isVisible('setup'), true)
    })

    it('without a key the setup window opens', async () => {
      apiKeyStore.hasKey = () => false
      await bootstrap.createLifecycleConfig().onReady()
      assert.equal(windowManager.isVisible('setup'), true)
    })
  })
})
