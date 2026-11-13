/**
 * API key storage with OS-protected encryption.
 *
 * Pure logic with injected storage and codec so it can be tested without Electron.
 * The full key is only ever returned by getKey(), which only the translation
 * service uses. Everything the renderer can see goes through status().
 */

import type { ApiKeyStatus } from '../../shared/types'

export interface SecretCodec {
  isAvailable(): Promise<boolean>
  /** Returns base64 of the encrypted bytes. */
  encrypt(plain: string): Promise<string>
  /** `shouldReEncrypt` is set when the OS wants the value encrypted again. */
  decrypt(base64: string): Promise<{ result: string; shouldReEncrypt?: boolean }>
}

export interface KeyValueStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
}

const STORE_KEY = 'apiKey.encrypted'

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super('Secure key storage is not available on this system, so the key was not saved.')
    this.name = 'SecureStorageUnavailableError'
  }
}

/** Show only that a key exists and how it ends: "••••••••a1b2". */
export function maskKey(key: string): string {
  if (!key) return ''
  const tail = key.length > 8 ? key.slice(-4) : ''
  return '•'.repeat(8) + tail
}

export class ApiKeyStore {
  private cache = ''
  private unreadable = false

  constructor(
    private readonly kv: KeyValueStore,
    private readonly codec: SecretCodec
  ) {}

  /**
   * Decrypt the stored key into memory. Call once at startup, before windows
   * open; until then getKey() returns ''. Safe to call again to retry.
   *
   * A stored key that cannot be decrypted is never deleted: the keychain may
   * only be locked or the user may have pressed "Deny". It is reported as
   * `unreadable` and retried on the next load().
   */
  async load(): Promise<void> {
    const stored = this.kv.get(STORE_KEY)
    this.unreadable = false
    if (!stored) {
      this.cache = ''
      return
    }
    let decrypted: { result: string; shouldReEncrypt?: boolean }
    try {
      decrypted = await this.codec.decrypt(stored)
    } catch {
      this.cache = ''
      this.unreadable = true
      return
    }
    this.cache = decrypted.result
    if (decrypted.shouldReEncrypt) {
      try {
        this.kv.set(STORE_KEY, await this.codec.encrypt(decrypted.result))
      } catch {
        // Keep the old stored value; the key itself is fine
      }
    }
  }

  /** Full key. Main process only; never hand this to the renderer. */
  getKey(): string {
    return this.cache
  }

  async setKey(rawKey: string): Promise<void> {
    const key = rawKey.trim()
    if (!key) {
      this.clear()
      return
    }
    if (!(await this.codec.isAvailable())) throw new SecureStorageUnavailableError()
    this.kv.set(STORE_KEY, await this.codec.encrypt(key))
    this.cache = key
    this.unreadable = false
  }

  clear(): void {
    this.kv.delete(STORE_KEY)
    this.cache = ''
    this.unreadable = false
  }

  /** True while a stored key exists but could not be decrypted. */
  isUnreadable(): boolean {
    return this.unreadable
  }

  hasKey(): boolean {
    return this.cache !== ''
  }

  status(): ApiKeyStatus {
    const status: ApiKeyStatus = { configured: this.cache !== '', masked: maskKey(this.cache) }
    if (this.unreadable) status.unreadable = true
    return status
  }
}
