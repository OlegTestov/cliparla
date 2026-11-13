/**
 * First-run order: key saved -> Screen Recording only -> "Try it now".
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  nextAfterSetup,
  nextAfterPermissions,
  startsSilently
} = require('../src/main/core/onboarding-flow')
const { screenRecordingMissing } = require('../src/main/services/permissions')
const { stepAfterKeySaved } = require('../src/shared/setup-step')
const { registerOnboardingHandlers } = require('../src/main/ipc/onboarding')
const { registerPermissionsHandlers } = require('../src/main/ipc/permissions')

describe('optional permissions', () => {
  const { optionalPermissionsMissing } = require('../src/main/services/permissions')
  const all = { screenRecording: 'granted', microphone: 'granted', accessibility: true }

  it('missing when Microphone or Accessibility is not granted, on macOS only', () => {
    assert.equal(optionalPermissionsMissing(all, 'darwin'), false)
    assert.equal(optionalPermissionsMissing({ ...all, microphone: 'denied' }, 'darwin'), true)
    assert.equal(optionalPermissionsMissing({ ...all, accessibility: false }, 'darwin'), true)
    assert.equal(optionalPermissionsMissing({ ...all, accessibility: false }, 'win32'), false)
  })

  it('only the setup-done path offers them, not every start', () => {
    const src = require('node:fs').readFileSync('src/main/core/app-bootstrap.ts', 'utf8')
    assert.equal(src.match(/offerOptional: /g)?.length, 1)
    assert.match(src, /onSetupDone[\s\S]*offerOptional: !hasSeenTryIt\(\)/)
  })
})

describe('which window comes next', () => {
  it('after the key: permissions only if Screen Recording is missing', () => {
    assert.equal(nextAfterSetup(true), 'permissions')
    assert.equal(nextAfterSetup(false), 'tryit')
  })

  it('a fresh key save with Screen Recording granted and Microphone missing shows the permissions window', () => {
    assert.equal(nextAfterSetup(false, { offer: true, missing: true }), 'permissions')
  })

  it('a normal relaunch with Microphone skipped shows no window', () => {
    assert.equal(nextAfterSetup(false, { offer: false, missing: true }), 'tryit')
  })

  it('a fresh key save with everything granted goes on to Try it now', () => {
    assert.equal(nextAfterSetup(false, { offer: true, missing: false }), 'tryit')
  })

  it('a launch is silent only with Screen Recording granted and Try it now already seen', () => {
    assert.equal(startsSilently(false, true), true)
    assert.equal(startsSilently(true, true), false)
    assert.equal(startsSilently(false, false), false)
    assert.equal(startsSilently(true, false), false)
  })

  it('after permissions: try it during first run, otherwise settings', () => {
    assert.equal(nextAfterPermissions(true, true), 'tryit')
    assert.equal(nextAfterPermissions(true, false), 'settings')
    assert.equal(nextAfterPermissions(false, true), 'settings')
  })
})

describe('only Screen Recording is required', () => {
  const status = (screenRecording: string, microphone: string, accessibility: boolean) => ({
    screenRecording,
    microphone,
    accessibility
  })

  it('microphone and accessibility never block the first translation', () => {
    assert.equal(screenRecordingMissing(status('granted', 'denied', false), 'darwin'), false)
    assert.equal(
      screenRecordingMissing(status('granted', 'not-determined', false), 'darwin'),
      false
    )
  })

  it('a missing or denied Screen Recording does', () => {
    assert.equal(screenRecordingMissing(status('denied', 'granted', true), 'darwin'), true)
    assert.equal(screenRecordingMissing(status('not-determined', 'granted', true), 'darwin'), true)
  })

  it('nothing is required outside macOS', () => {
    assert.equal(screenRecordingMissing(status('denied', 'denied', false), 'win32'), false)
  })
})

describe('onboarding IPC', () => {
  beforeEach(() => resetRecorded())

  it('"Try it now" hides the setup window and opens the capture overlay', () => {
    const calls: string[] = []
    registerOnboardingHandlers({
      hideSetup: () => calls.push('hideSetup'),
      showCapture: () => calls.push('showCapture'),
      showSettings: () => calls.push('showSettings')
    })
    ipc.listeners.get('try-capture')!(trustedEvent)
    assert.deepEqual(calls, ['hideSetup', 'showCapture'])
  })

  it('finishing opens settings', () => {
    const calls: string[] = []
    registerOnboardingHandlers({
      hideSetup: () => calls.push('hideSetup'),
      showCapture: () => calls.push('showCapture'),
      showSettings: () => calls.push('showSettings')
    })
    ipc.listeners.get('finish-onboarding')!(trustedEvent)
    assert.deepEqual(calls, ['hideSetup', 'showSettings'])
  })

  it('the permissions Continue button asks the flow what to open next', () => {
    let continued = 0
    registerPermissionsHandlers({ onContinue: () => void continued++ })
    ipc.listeners.get('permissions-continue')!(trustedEvent)
    assert.equal(continued, 1)
  })
})

describe('setup screen requested before the page loaded', () => {
  beforeEach(() => resetRecorded())

  it('the page can read the screen it was asked to show', async () => {
    let reason: string | undefined = 'TRY_IT'
    registerOnboardingHandlers({ getSetupReason: () => reason })
    assert.equal(await ipc.handlers.get('get-setup-reason')!(trustedEvent), 'TRY_IT')
    reason = undefined
    assert.equal(await ipc.handlers.get('get-setup-reason')!(trustedEvent), null)
  })

  it('showSetupWindow remembers the reason for the page', () => {
    const wm = require('../src/main/core/window-manager')
    wm.showSetupWindow('TRY_IT')
    assert.equal(wm.getSetupReason(), 'TRY_IT')
    wm.showSetupWindow('MISSING_KEY')
    assert.equal(wm.getSetupReason(), 'MISSING_KEY')
  })
})

describe('screen after the key was saved', () => {
  beforeEach(() => resetRecorded())

  it('a first run with Screen Recording on goes straight to Try it now', () => {
    assert.equal(stepAfterKeySaved(true, true), 'try')
    assert.equal(stepAfterKeySaved(true, true, true), 'saved')
  })

  it('a returning user goes through Continue so main picks the window', () => {
    assert.equal(stepAfterKeySaved(true, false), 'saved')
  })

  it('a missing permission goes through Continue', () => {
    assert.equal(stepAfterKeySaved(false, true), 'saved')
  })

  it('main reports whether Try it now is still pending', async () => {
    let seen = false
    registerOnboardingHandlers({ hasSeenTryIt: () => seen })
    assert.equal(await ipc.handlers.get('get-try-it-pending')!(trustedEvent), true)
    seen = true
    assert.equal(await ipc.handlers.get('get-try-it-pending')!(trustedEvent), false)
  })

  it('hiding the setup window forgets the requested screen', () => {
    const wm = require('../src/main/core/window-manager')
    wm.showSetupWindow('INVALID_KEY')
    wm.hideSetupWindow()
    assert.equal(wm.getSetupReason(), undefined)
  })
})
