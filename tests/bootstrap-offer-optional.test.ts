/**
 * The first-run key save offers Microphone and Accessibility; a normal start does not.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, mediaAccess, resetRecorded, shownPages, trustedEvent } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createLifecycleConfig } = require('../src/main/core/app-bootstrap')
const { apiKeyStore } = require('../src/main/services/api-key')
const { markTryItSeen, store } = require('../src/main/services/store')

const realPlatform = process.platform
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('bootstrap: offering the optional permissions', () => {
  beforeEach(() => {
    resetRecorded()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mediaAccess.screen = 'granted'
    mediaAccess.accessibility = false // Accessibility skipped, Screen Recording on
    apiKeyStore.hasKey = () => true
    apiKeyStore.load = async () => undefined
    store.set('tryItSeen', false)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
  })

  it('setup done on a first run shows the permissions window', async () => {
    const config = createLifecycleConfig()
    await config.onReady()
    shownPages.length = 0
    ipc.listeners.get('setup-done')!(trustedEvent)
    await flush()
    assert.ok(shownPages.includes('permissions.html'), `shown: ${shownPages.join(',')}`)
  })

  it('start-up warms up the paste helper once', async () => {
    let warmed = 0
    await createLifecycleConfig({ warmUpPasteHelper: async () => void warmed++ }).onReady()
    assert.equal(warmed, 1)
  })

  it('a normal start with Accessibility skipped shows no permissions window', async () => {
    markTryItSeen()
    const config = createLifecycleConfig()
    shownPages.length = 0
    await config.onReady()
    await flush()
    assert.ok(!shownPages.includes('permissions.html'), `shown: ${shownPages.join(',')}`)
  })
})
