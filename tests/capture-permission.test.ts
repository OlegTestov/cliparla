/**
 * Without Screen Recording nothing is captured or sent: the permissions window
 * opens instead, and the translation service is never called.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, mediaAccess, resetRecorded, trustedEvent } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { startCapture, screenCaptureAllowed } = require('../src/main/core/capture-gate')
const { isUniformBitmap } = require('../src/main/services/blank-image')

const SELECTION = { x: 0, y: 0, width: 200, height: 100 }
const granted = { screenRecording: 'granted', microphone: 'granted', accessibility: true }

describe('capture needs Screen Recording', () => {
  beforeEach(() => {
    resetRecorded()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  it('hotkey with the permission opens the overlay only', () => {
    const calls: string[] = []
    startCapture({
      status: () => granted,
      showPermissions: () => void calls.push('permissions'),
      showOverlay: () => void calls.push('overlay')
    })
    assert.deepEqual(calls, ['overlay'])
  })

  for (const screenRecording of ['denied', 'not-determined']) {
    it(`hotkey with Screen Recording ${screenRecording} opens permissions, no overlay`, () => {
      const calls: string[] = []
      startCapture({
        status: () => ({ ...granted, screenRecording }),
        showPermissions: () => void calls.push('permissions'),
        showOverlay: () => void calls.push('overlay')
      })
      assert.deepEqual(calls, ['permissions'])
    })
  }

  it('other platforms never need the permission', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    assert.equal(
      screenCaptureAllowed({
        status: () => ({ ...granted, screenRecording: 'denied' }),
        showPermissions: () => assert.fail('no window expected')
      }),
      true
    )
  })

  it('a selection made after the permission was revoked sends nothing to the service', async () => {
    const service = new FakeTranslationService()
    setTranslationService(service)
    let captured = 0
    registerCaptureHandlers({
      fromOverlay: () => true,
      captureScreen: async () => {
        captured++
        return 'IMAGE'
      }
    })
    mediaAccess.screen = 'denied'
    await ipc.listeners.get('selection-made')!(trustedEvent, SELECTION)
    assert.equal(captured, 0)
    assert.deepEqual(service.calls, [])

    mediaAccess.screen = 'granted'
    await ipc.listeners.get('selection-made')!(trustedEvent, SELECTION)
    assert.equal(service.calls.length, 1)
  })
})

describe('isUniformBitmap', () => {
  it('flags a flat image and an empty one, not one with any differing pixel', () => {
    assert.equal(isUniformBitmap(Buffer.alloc(4 * 100, 7)), true)
    assert.equal(isUniformBitmap(Buffer.alloc(0)), true)
    const text = Buffer.alloc(4 * 100, 255)
    text[4 * 99] = 0
    assert.equal(isUniformBitmap(text), false)
  })
})

describe('selection-made sender', () => {
  it('a selection from a window other than the open overlay is ignored', async () => {
    resetRecorded()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const service = new FakeTranslationService()
    setTranslationService(service)
    let captured = 0
    registerCaptureHandlers({
      captureScreen: async () => {
        captured++
        return 'IMAGE'
      }
    })
    // The default check: no overlay window exists, so the settings page is refused
    await ipc.listeners.get('selection-made')!(trustedEvent, SELECTION)
    assert.equal(captured, 0)
    assert.deepEqual(service.calls, [])
  })
})
