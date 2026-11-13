/**
 * Every way to start a capture (global hotkey, tray menu, "Try it now") opens
 * the permissions window, never the selection overlay, without Screen Recording.
 */

import './helpers/electron-stub'
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ipc,
  mediaAccess,
  sentMessages,
  resetRecorded,
  shortcuts,
  shownPages,
  trayMenu,
  trustedEvent
} from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const { FakeTranslationService } = require('./helpers/fake-service')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { BLANK_CAPTURE } = require('../src/main/services/screen-capture')
const windowManager = require('../src/main/core/window-manager')
const { initializeHotkeys } = require('../src/main/core/app-bootstrap')
const { hotkeyManager } = require('../src/main/core/hotkey-manager')
const { registerOnboardingHandlers } = require('../src/main/ipc/onboarding')
const { createTray, updateTrayMenu } = require('../src/main/services/tray')
const { apiKeyStore } = require('../src/main/services/api-key')
const store = require('../src/main/services/store')

describe('capture entry points without Screen Recording', () => {
  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
  })

  beforeEach(() => {
    resetRecorded()
    mediaAccess.screen = 'denied'
  })

  it('the global hotkey opens permissions, not the overlay', () => {
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    store.setDictationShortcut('CommandOrControl+Shift+D')
    hotkeyManager.unregisterAll()
    initializeHotkeys()
    hotkeyManager.setMode('normal')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    assert.deepEqual(shownPages, ['permissions.html'])
  })

  it('the tray item opens permissions, not the overlay', async () => {
    await apiKeyStore.setKey('AIza-test-key')
    createTray()
    updateTrayMenu()
    const item = trayMenu.items.find((i) => i.label === 'Take screenshot')
    assert.ok(item, 'tray has a screenshot item')
    item.click!()
    assert.deepEqual(shownPages, ['permissions.html'])
  })

  it('"Try it now" opens permissions, not the overlay', async () => {
    registerOnboardingHandlers({ hideSetup: () => undefined })
    await ipc.listeners.get('try-capture')!(trustedEvent)
    assert.deepEqual(shownPages, ['permissions.html'])
  })

  it('with the permission the same entry points open the overlay', async () => {
    mediaAccess.screen = 'granted'
    registerOnboardingHandlers({ hideSetup: () => undefined })
    await ipc.listeners.get('try-capture')!(trustedEvent)
    assert.deepEqual(shownPages, ['index.html'])
  })

  it('only the open overlay counts as the sender of a selection', () => {
    mediaAccess.screen = 'granted'
    const overlay = windowManager.get('capture')
    const settings = windowManager.get('settings')
    windowManager.hideCaptureWindow()
    assert.equal(windowManager.isFromOpenOverlay({ sender: { id: overlay.webContents.id } }), false)
    windowManager.showCaptureWindow()
    assert.equal(windowManager.isFromOpenOverlay({ sender: { id: overlay.webContents.id } }), true)
    assert.equal(
      windowManager.isFromOpenOverlay({ sender: { id: settings.webContents.id } }),
      false
    )
    assert.equal(windowManager.isFromOpenOverlay({}), false)
  })

  it('a flat selected area says there is nothing to translate and sends nothing', async () => {
    mediaAccess.screen = 'granted'
    const service = new FakeTranslationService()
    setTranslationService(service)
    registerCaptureHandlers({ fromOverlay: () => true, captureScreen: async () => BLANK_CAPTURE })
    await ipc.listeners.get('selection-made')!(trustedEvent, {
      x: 0,
      y: 0,
      width: 200,
      height: 100
    })
    assert.deepEqual(service.calls, [])
    const result = sentMessages.find((m) => m.channel === 'translation-complete')
    assert.match((result!.args[0] as { error: string }).error, /Nothing to translate/)
  })
})
