/**
 * Provider errors reach the user in the interface language, on every path.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  appState,
  dialogs,
  ipc,
  resetRecorded,
  sentMessages,
  trustedEvent
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { store } = require('../src/main/services/store')
const { setTranslationService } = require('../src/main/services/translation')
const { registerResultHandlers } = require('../src/main/ipc/result')
const { registerApiKeyHandlers } = require('../src/main/ipc/api-key')
const { ApiKeyStore } = require('../src/main/services/api-key-store')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete
} = require('../src/main/services/dictation')
const { messageFor } = require('../src/main/services/translation/errors')
const { getAllSettings } = require('../src/main/services/store')
const es = require('../src/renderer/src/i18n/locales/es.json')

const quota = { success: false, errorCode: 'QUOTA_EXHAUSTED', error: messageFor('QUOTA_EXHAUSTED') }

describe('localized errors', () => {
  beforeEach(() => {
    resetRecorded()
    store.set('uiLanguage', 'es')
  })

  it('text actions return the Spanish message', async () => {
    setTranslationService(new FakeTranslationService(quota))
    registerResultHandlers({ showSetup: () => undefined })
    const reply = await ipc.handlers.get('comment-text')!(trustedEvent, 'hola')
    assert.equal(reply.error, es['error.QUOTA_EXHAUSTED'])
    assert.equal(reply.errorCode, 'QUOTA_EXHAUSTED')
  })

  it('Test key returns the Spanish message', async () => {
    const bad = { ok: false, errorCode: 'INVALID_KEY', error: messageFor('INVALID_KEY') }
    registerApiKeyHandlers({
      store: new ApiKeyStore(
        { get: () => undefined, set: () => undefined, delete: () => undefined },
        {
          isAvailable: async () => true,
          encrypt: async (s: string) => s,
          decrypt: async (s: string) => ({ result: s })
        }
      ),
      getService: () => new FakeTranslationService(quota, bad)
    })
    const reply = await ipc.handlers.get('test-key')!(trustedEvent, 'candidate')
    assert.equal(reply.error, es['error.INVALID_KEY'])
  })

  it('the dictation error card is in Spanish', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    sentMessages.length = 0
    setTranslationService(new FakeTranslationService(quota))
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(
      { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' },
      { paste: async () => undefined }
    )
    assert.deepEqual(dialogs, [])
    const card = sentMessages.find((m) => m.channel === 'listening-mode-error')
    assert.equal((card?.args[0] as { message: string }).message, es['error.QUOTA_EXHAUSTED'])
  })

  it('an unset interface language follows the system language', () => {
    store.delete('uiLanguage')
    appState.preferred = ['de-DE']
    assert.equal(getAllSettings().uiLanguage, 'de')
    appState.preferred = ['sv-SE', 'es-ES'] // first language we support wins
    assert.equal(getAllSettings().uiLanguage, 'es')
    appState.preferred = ['sv-SE']
    assert.equal(getAllSettings().uiLanguage, 'en')
    appState.preferred = []
    assert.equal(getAllSettings().uiLanguage, 'en')
    store.set('uiLanguage', 'fr')
    assert.equal(getAllSettings().uiLanguage, 'fr') // an explicit choice always wins
  })
})
