/**
 * Electron wiring for the API key store: electron-store + safeStorage.
 */

import { safeStorage } from 'electron'
import { store } from './store'
import { ApiKeyStore, type KeyValueStore, type SecretCodec } from './api-key-store'

const kv: KeyValueStore = {
  get: (key) => (store as unknown as { get(k: string): string | undefined }).get(key),
  set: (key, value) => (store as unknown as { set(k: string, v: string): void }).set(key, value),
  delete: (key) => (store as unknown as { delete(k: string): void }).delete(key)
}

const codec: SecretCodec = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: async (plain) => (await safeStorage.encryptStringAsync(plain)).toString('base64'),
  decrypt: async (base64) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
      Buffer.from(base64, 'base64')
    )
    return { result, shouldReEncrypt }
  }
}

export const apiKeyStore = new ApiKeyStore(kv, codec)
