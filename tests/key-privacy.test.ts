/**
 * The full API key stays in the main process: stored encrypted, and every
 * reply the renderer can receive carries only a masked status.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appState, ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { ApiKeyStore, maskKey } = require('../src/main/services/api-key-store')
const { registerApiKeyHandlers } = require('../src/main/ipc/api-key')
const { registerSettingsHandlers } = require('../src/main/ipc/settings')

// Key-shaped value built at runtime so this file never contains a real-looking key
const SECRET = ['AI', 'za', 'Sy', 'TESTONLY', 'x'.repeat(24)].join('')

function memoryKv() {
  const map = new Map<string, string>()
  return {
    map,
    get: (k: string) => map.get(k),
    set: (k: string, v: string) => void map.set(k, v),
    delete: (k: string) => void map.delete(k)
  }
}

const codec = {
  isAvailable: async () => appState.encryptionAvailable,
  encrypt: async (plain: string) =>
    Buffer.from(`enc:${[...plain].reverse().join('')}`).toString('base64'),
  decrypt: async (b64: string) => ({
    result: [...Buffer.from(b64, 'base64').toString().replace(/^enc:/, '')].reverse().join(''),
    shouldReEncrypt: false
  })
}

describe('masked status', () => {
  it('shows only a mask and the last four characters', () => {
    assert.equal(maskKey(SECRET), '•'.repeat(8) + SECRET.slice(-4))
    assert.equal(maskKey(''), '')
    assert.ok(!maskKey(SECRET).includes(SECRET.slice(0, 10)))
  })
})

describe('storage', () => {
  beforeEach(() => {
    appState.encryptionAvailable = true
  })

  it('stores the key encrypted, never as plain text', async () => {
    const kv = memoryKv()
    const store = new ApiKeyStore(kv, codec)
    await store.setKey(`  ${SECRET}  `)
    const stored = [...kv.map.values()].join('|')
    assert.ok(stored.length > 0)
    assert.ok(!stored.includes(SECRET))
    assert.equal(store.getKey(), SECRET)

    const reopened = new ApiKeyStore(kv, codec)
    assert.equal(reopened.getKey(), '', 'nothing is readable before load()')
    await reopened.load()
    assert.equal(reopened.getKey(), SECRET)
  })

  it('refuses to save when OS secure storage is unavailable', async () => {
    appState.encryptionAvailable = false
    const kv = memoryKv()
    const store = new ApiKeyStore(kv, codec)
    await assert.rejects(store.setKey(SECRET), /not available/)
    assert.equal(kv.map.size, 0)
    assert.equal(store.hasKey(), false)
  })

  it('removing the key clears it everywhere', async () => {
    const kv = memoryKv()
    const store = new ApiKeyStore(kv, codec)
    await store.setKey(SECRET)
    store.clear()
    assert.equal(kv.map.size, 0)
    assert.deepEqual(store.status(), { configured: false, masked: '' })
  })

  it('a key that cannot be read right now is kept and can be read later', async () => {
    const kv = memoryKv()
    await new ApiKeyStore(kv, codec).setKey(SECRET)
    const stored = kv.map.get('apiKey.encrypted')

    let denied = true
    const flaky = {
      ...codec,
      decrypt: async (b64: string) => {
        if (denied) throw new Error('keychain access denied')
        return codec.decrypt(b64)
      }
    }
    const store = new ApiKeyStore(kv, flaky)
    await store.load()
    assert.equal(store.getKey(), '')
    assert.deepEqual(store.status(), { configured: false, masked: '', unreadable: true })
    assert.equal(kv.map.get('apiKey.encrypted'), stored, 'the stored key must not be deleted')

    denied = false
    await store.load() // user allowed access, retry
    assert.equal(store.getKey(), SECRET)
    assert.equal(store.status().unreadable, undefined)
  })

  it('saving a new key or removing the key replaces an unreadable one', async () => {
    const kv = memoryKv()
    kv.set('apiKey.encrypted', 'garbage')
    const broken = {
      ...codec,
      decrypt: async () => {
        throw new Error('bad')
      }
    }
    const store = new ApiKeyStore(kv, broken)
    await store.load()
    await store.setKey(SECRET)
    assert.equal(store.status().unreadable, undefined)
    assert.equal(store.getKey(), SECRET)

    kv.set('apiKey.encrypted', 'garbage')
    await store.load()
    store.clear()
    assert.equal(kv.map.size, 0)
    assert.equal(store.status().unreadable, undefined)
  })

  it('a failed re-encrypt keeps the key and the old stored value', async () => {
    const kv = memoryKv()
    await new ApiKeyStore(kv, codec).setKey(SECRET)
    const before = kv.map.get('apiKey.encrypted')
    const failing = {
      ...codec,
      encrypt: async () => {
        throw new Error('keychain locked')
      },
      decrypt: async (b64: string) => ({ ...(await codec.decrypt(b64)), shouldReEncrypt: true })
    }
    const store = new ApiKeyStore(kv, failing)
    await store.load()
    assert.equal(store.getKey(), SECRET)
    assert.equal(kv.map.get('apiKey.encrypted'), before)
  })

  it('get-key-status asks the keychain again only when the user presses Try again', async () => {
    resetRecorded()
    const kv = memoryKv()
    await new ApiKeyStore(kv, codec).setKey(SECRET)
    let denied = true
    let reads = 0
    const flaky = {
      ...codec,
      decrypt: async (b64: string) => {
        reads++
        if (denied) throw new Error('denied')
        return codec.decrypt(b64)
      }
    }
    const store = new ApiKeyStore(kv, flaky)
    await store.load()
    registerApiKeyHandlers({ store, getService: () => new FakeTranslationService() })
    const first = await ipc.handlers.get('get-key-status')!(trustedEvent)
    assert.equal(first.unreadable, true)
    // Windows asking for the status (each one a keychain prompt in the real app) do not retry
    await ipc.handlers.get('get-key-status')!(trustedEvent)
    // `retry: false` or any other value is not a retry either
    await ipc.handlers.get('get-key-status')!(trustedEvent, { retry: false })
    await ipc.handlers.get('get-key-status')!(trustedEvent, { retry: 'yes' })
    assert.equal(reads, 1)
    denied = false
    const second = await ipc.handlers.get('get-key-status')!(trustedEvent, { retry: true })
    assert.equal(reads, 2)
    assert.equal(second.configured, true)
    assert.ok(!JSON.stringify(second).includes(SECRET))
  })

  it('re-encrypts the key when the OS asks for it', async () => {
    const kv = memoryKv()
    await new ApiKeyStore(kv, codec).setKey(SECRET)
    const before = kv.map.get('apiKey.encrypted')
    let encrypted = 0
    const rotating = {
      ...codec,
      encrypt: async (plain: string) => {
        encrypted++
        return `rotated:${await codec.encrypt(plain)}`
      },
      decrypt: async (b64: string) => ({ ...(await codec.decrypt(b64)), shouldReEncrypt: true })
    }
    const store = new ApiKeyStore(kv, rotating)
    await store.load()
    assert.equal(store.getKey(), SECRET)
    assert.equal(encrypted, 1)
    assert.notEqual(kv.map.get('apiKey.encrypted'), before)
    assert.ok(!String(kv.map.get('apiKey.encrypted')).includes(SECRET))
  })
})

describe('what the renderer can receive', () => {
  beforeEach(() => {
    resetRecorded()
    appState.encryptionAvailable = true
  })

  it('no key IPC reply contains the key', async () => {
    const store = new ApiKeyStore(memoryKv(), codec)
    const service = new FakeTranslationService()
    registerApiKeyHandlers({ store, getService: () => service })

    const replies = [
      await ipc.handlers.get('test-key')!(trustedEvent, SECRET),
      await ipc.handlers.get('save-key')!(trustedEvent, SECRET),
      await ipc.handlers.get('get-key-status')!(trustedEvent),
      await ipc.handlers.get('test-key')!(trustedEvent),
      await ipc.handlers.get('remove-key')!(trustedEvent)
    ]
    for (const reply of replies) {
      assert.ok(!JSON.stringify(reply).includes(SECRET), JSON.stringify(reply))
    }
    // The stored key was the one tested when no candidate was passed
    assert.equal(service.calls.filter((c) => c.method === 'testKey')[1].args[0], SECRET)
  })

  it('save-key rejects empty and non-string input without storing anything', async () => {
    const kv = memoryKv()
    registerApiKeyHandlers({
      store: new ApiKeyStore(kv, codec),
      getService: () => new FakeTranslationService()
    })
    for (const bad of ['', '   ', 42, null, { key: SECRET }, 'x'.repeat(513)]) {
      const reply = await ipc.handlers.get('save-key')!(trustedEvent, bad)
      assert.equal(reply.success, false)
    }
    assert.equal(kv.map.size, 0)
  })

  it('get-settings has no key field, and save-settings ignores one', async () => {
    registerSettingsHandlers()
    const before = await ipc.handlers.get('get-settings')!(trustedEvent)
    assert.ok(!('apiKey' in before))
    await ipc.handlers.get('save-settings')!(trustedEvent, { apiKey: SECRET, uiLanguage: 'de' })
    const after = await ipc.handlers.get('get-settings')!(trustedEvent)
    assert.equal(after.uiLanguage, 'de')
    assert.ok(!JSON.stringify(after).includes(SECRET))
  })

  it('the preload bridge has no way to read the key', () => {
    const preload = readFileSync(join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf8')
    assert.ok(!/getApiKey|apiKey/.test(preload))
  })

  it('only the translation service and storage code read the full key', () => {
    const { readdirSync, statSync } = require('node:fs')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n: string) => {
        const p = join(dir, n)
        return statSync(p).isDirectory() ? walk(p) : [p]
      })
    const readers = walk(join(__dirname, '..', 'src'))
      .filter((f) => /apiKeyStore\.getKey|store\.getKey|\.getKey\(\)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split('/src/')[1])
      .sort()
    assert.deepEqual(readers, ['main/ipc/api-key.ts', 'main/services/translation/index.ts'])
  })
})
