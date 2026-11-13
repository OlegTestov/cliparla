/** Menu-bar app: the Dock icon shows only while Settings, setup or permissions is open. */

import './helpers/electron-stub'
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { appState, dockState, resetRecorded } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { hideDock } = require('../src/main/core/app-lifecycle')

describe('Dock icon', () => {
  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
  })
  beforeEach(() => {
    resetRecorded()
    hideDock()
  })

  for (const [name, show, hide] of [
    ['Settings', windowManager.showSettingsWindow, windowManager.hideSettingsWindow],
    ['setup', () => windowManager.showSetupWindow(), windowManager.hideSetupWindow],
    ['permissions', windowManager.showPermissionsWindow, windowManager.hidePermissionsWindow]
  ] as const) {
    it(`${name}: shown with its window, hidden again when it closes`, () => {
      show()
      assert.equal(dockState.visible, true)
      hide()
      assert.equal(dockState.visible, false)
    })
  }

  it('stays while another Dock window is still open', () => {
    windowManager.showSettingsWindow()
    windowManager.showPermissionsWindow()
    windowManager.hideSettingsWindow()
    assert.equal(dockState.visible, true)
    windowManager.hidePermissionsWindow()
    assert.equal(dockState.visible, false)
  })

  it('F2 changes Dock state only once per transition, including repeated hide events', () => {
    dockState.calls.length = 0
    windowManager.showSettingsWindow()
    windowManager.showSettingsWindow()
    windowManager.showPermissionsWindow()
    windowManager.hideSettingsWindow()
    windowManager.hideSettingsWindow()
    windowManager.hidePermissionsWindow()
    windowManager.hidePermissionsWindow()
    assert.deepEqual(dockState.calls, ['show', 'hide'])
  })

  it('F2 hiding the streaming pill before delivery makes no Dock calls', () => {
    dockState.calls.length = 0
    windowManager.showListeningIndicator()
    windowManager.sendProcessingText('dictated text')
    windowManager.hideListeningIndicator()
    assert.deepEqual(dockState.calls, [])
  })

  it('F2 does not repeat show while the native Dock transition is still pending', () => {
    dockState.calls.length = 0
    dockState.deferShow = true
    try {
      windowManager.showSettingsWindow()
      windowManager.showSettingsWindow()
      windowManager.showPermissionsWindow()
      assert.deepEqual(dockState.calls, ['show'])
    } finally {
      dockState.deferShow = false
      dockState.visible = true
      windowManager.hideSettingsWindow()
      windowManager.hidePermissionsWindow()
    }
  })

  it('Cmd+H keeps the icon while Settings is open, and unhiding brings it back', async () => {
    windowManager.showSettingsWindow()
    await new Promise<void>((resolve) => setImmediate(resolve)) // native Dock show has settled
    const win = windowManager.getSettingsWindow()
    appState.hidden = true
    try {
      win.hide() // the system hides every window of the app
      assert.equal(dockState.visible, true)
      appState.hidden = false
      dockState.visible = false // as if the system dropped the icon meanwhile
      win.show()
      assert.equal(dockState.visible, true)
    } finally {
      appState.hidden = false
    }
    windowManager.hideSettingsWindow()
    assert.equal(dockState.visible, false)
  })

  it('result, indicator, toast and overlay windows never show it', () => {
    windowManager.showResultWindow()
    windowManager.showListeningIndicator()
    windowManager.showToastWindow('Copied')
    windowManager.showCaptureWindow()
    assert.deepEqual(
      dockState.calls.filter((c) => c === 'show'),
      []
    )
    windowManager.hideResultWindow()
    windowManager.hideListeningIndicator()
    windowManager.hideToastWindow()
    windowManager.hideCaptureWindow()
    assert.equal(dockState.visible, false)
  })

  it('the packaged app is an agent app: no Dock icon until a window asks for one', () => {
    const pkg = JSON.parse(
      require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../package.json'),
        'utf8'
      )
    )
    assert.equal(pkg.build.mac.extendInfo.LSUIElement, true)
  })
})
