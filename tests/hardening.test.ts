/**
 * Only our own app documents may use the IPC bridge, and no window may
 * navigate away or open new windows.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ipc, resetRecorded, trustedEvent, TRUSTED_RENDERER_DIR } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { isTrustedUrl, isTrustedSender } = require('../src/main/core/trust')
const { hardenWebContents } = require('../src/main/core/web-hardening')
const { ApiKeyStore } = require('../src/main/services/api-key-store')
const { registerApiKeyHandlers } = require('../src/main/ipc/api-key')
const { registerResultHandlers } = require('../src/main/ipc/result')
const { registerSettingsHandlers } = require('../src/main/ipc/settings')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { registerDictationHandlers } = require('../src/main/ipc/dictation')
const { registerPermissionsHandlers } = require('../src/main/ipc/permissions')
const { registerAppHandlers } = require('../src/main/ipc/app')

const cfg = { rendererDir: TRUSTED_RENDERER_DIR, devServerUrl: 'http://localhost:5173' }
const frame = (url: string, parent: unknown = null) => ({ senderFrame: { url, parent } })

describe('trusted documents', () => {
  it('accepts our packaged pages and the dev server only', () => {
    assert.equal(isTrustedUrl(`file://${TRUSTED_RENDERER_DIR}/settings.html`, cfg), true)
    assert.equal(isTrustedUrl('http://localhost:5173/settings.html', cfg), true)
    for (const bad of [
      'https://example.org/',
      'file:///etc/passwd',
      `file://${TRUSTED_RENDERER_DIR}/../secret.html`,
      `file://${TRUSTED_RENDERER_DIR}-evil/settings.html`,
      'http://localhost:5174/',
      'http://localhost:5173.evil.org/',
      'javascript:alert(1)',
      'not a url',
      ''
    ]) {
      assert.equal(isTrustedUrl(bad, cfg), false, bad)
    }
  })

  it('rejects subframes and senders without a frame', () => {
    const page = `file://${TRUSTED_RENDERER_DIR}/settings.html`
    assert.equal(isTrustedSender(frame(page), cfg), true)
    assert.equal(isTrustedSender(frame(page, {}), cfg), false)
    assert.equal(isTrustedSender({}, cfg), false)
    assert.equal(isTrustedSender({ senderFrame: null }, cfg), false)
  })
})

describe('IPC sender validation', () => {
  const evil = frame('https://example.org/')

  beforeEach(() => resetRecorded())

  it('every registered handler rejects an untrusted sender and accepts our pages', async () => {
    registerApiKeyHandlers({
      store: new ApiKeyStore(
        { get: () => undefined, set: () => undefined, delete: () => undefined },
        {
          isAvailable: async () => true,
          encrypt: async (s: string) => s,
          decrypt: async (s: string) => ({ result: s })
        }
      ),
      getService: () => new FakeTranslationService()
    })
    registerResultHandlers()
    registerSettingsHandlers()
    registerCaptureHandlers({ fromOverlay: () => true, captureScreen: async () => 'IMG' })
    registerDictationHandlers()
    registerPermissionsHandlers()
    registerAppHandlers()

    assert.ok(ipc.handlers.size >= 15 && ipc.listeners.size >= 8)
    for (const [channel, handler] of ipc.handlers) {
      await assert.rejects(async () => handler(evil, 'x'), /untrusted/i, channel)
      await assert.rejects(async () => handler({}, 'x'), /untrusted/i, channel)
    }
    for (const [channel, listener] of ipc.listeners) {
      const result = await listener(evil, 'x')
      assert.equal(result, undefined, channel)
    }
  })

  it('an untrusted sender cannot save a key or trigger a translation', async () => {
    const saved: string[] = []
    const service = new FakeTranslationService()
    registerApiKeyHandlers({
      store: new ApiKeyStore(
        {
          get: () => undefined,
          set: (_k: string, v: string) => void saved.push(v),
          delete: () => undefined
        },
        {
          isAvailable: async () => true,
          encrypt: async (s: string) => s,
          decrypt: async (s: string) => ({ result: s })
        }
      ),
      getService: () => service
    })
    registerResultHandlers({ getService: () => service })
    await assert.rejects(async () => ipc.handlers.get('save-key')!(evil, 'candidate'))
    await assert.rejects(async () => ipc.handlers.get('improve-text')!(evil, 'text'))
    assert.deepEqual(saved, [])
    assert.deepEqual(service.calls, [])

    const ok = await ipc.handlers.get('save-key')!(trustedEvent, 'candidate')
    assert.equal(ok.success, true)
    assert.equal(saved.length, 1)
  })
})

describe('web contents hardening', () => {
  function fakeContents() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    let openHandler: (details: { url: string }) => { action: string } = () => ({ action: 'allow' })
    return {
      handlers,
      contents: {
        setWindowOpenHandler: (fn: typeof openHandler) => void (openHandler = fn),
        on: (event: string, fn: (...args: unknown[]) => void) => void handlers.set(event, fn)
      },
      open: (url: string) => openHandler({ url })
    }
  }

  it('denies every window.open', () => {
    const fake = fakeContents()
    hardenWebContents(fake.contents, cfg)
    assert.deepEqual(fake.open('https://example.org'), { action: 'deny' })
    assert.deepEqual(fake.open(`file://${TRUSTED_RENDERER_DIR}/settings.html`), { action: 'deny' })
  })

  it('blocks navigation and redirects to anything that is not our page', () => {
    const fake = fakeContents()
    hardenWebContents(fake.contents, cfg)
    for (const event of ['will-navigate', 'will-redirect']) {
      let prevented = 0
      const preventDefault = () => void prevented++
      fake.handlers.get(event)!({ preventDefault }, 'https://example.org/')
      assert.equal(prevented, 1, event)
      fake.handlers.get(event)!({ preventDefault }, `file://${TRUSTED_RENDERER_DIR}/result.html`)
      assert.equal(prevented, 1, `${event} allows our own pages`)
    }
  })

  it('blocks webview attachment', () => {
    const fake = fakeContents()
    hardenWebContents(fake.contents, cfg)
    let prevented = false
    fake.handlers.get('will-attach-webview')!({ preventDefault: () => (prevented = true) })
    assert.equal(prevented, true)
  })
})
