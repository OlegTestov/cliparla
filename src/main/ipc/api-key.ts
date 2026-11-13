/**
 * IPC API Key Handler
 *
 * Domain: get-key-status, test-key, save-key, remove-key, setup-done
 *
 * The renderer never receives the full key: every reply carries only the
 * masked status. The key is read in the main process by the translation service.
 */

import { handle, on } from '../core/ipc-guard'
import { apiKeyStore } from '../services/api-key'
import { SecureStorageUnavailableError, type ApiKeyStore } from '../services/api-key-store'
import { getTranslationService, type TranslationService } from '../services/translation'
import { createLogger } from '../core/logger'
import { localizeResult, t } from '../core/localize'
import { getUiLanguage } from '../services/store'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import type { ApiKeyStatus, KeyTestResult } from '../../shared/types'

const log = createLogger('IPC:ApiKey')

const MAX_KEY_LENGTH = 512

export interface SaveKeyResult {
  success: boolean
  status: ApiKeyStatus
  error?: string
}

export interface ApiKeyHandlerDeps {
  store?: ApiKeyStore
  getService?: () => TranslationService
  /** Called after the key was saved or removed. */
  onKeyChanged?: (status: ApiKeyStatus) => void
  /** Called when the user finishes the setup screen. */
  onSetupDone?: () => void
}

function asKeyInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_KEY_LENGTH ? trimmed : null
}

export function registerApiKeyHandlers(deps: ApiKeyHandlerDeps = {}): void {
  const store = deps.store ?? apiKeyStore
  const getService = deps.getService ?? getTranslationService

  handle(IPC_CHANNELS.GET_KEY_STATUS, async (_event, options?: unknown): Promise<ApiKeyStatus> => {
    // Ask the keychain again only on the user's "Try again": every read can be a password prompt
    const retry = (options as { retry?: unknown } | null | undefined)?.retry === true
    if (retry && store.isUnreadable()) {
      await store.load()
      if (store.hasKey()) deps.onKeyChanged?.(store.status())
    }
    return store.status()
  })

  // Test a pasted key, or the stored one when nothing is pasted. Nothing is saved here.
  handle(IPC_CHANNELS.TEST_KEY, async (_event, candidate?: unknown): Promise<KeyTestResult> => {
    const key = candidate === undefined ? store.getKey() : asKeyInput(candidate)
    const result = await getService().testKey(key ?? '')
    return localizeResult(result, getUiLanguage())
  })

  handle(IPC_CHANNELS.SAVE_KEY, async (_event, candidate: unknown): Promise<SaveKeyResult> => {
    const key = asKeyInput(candidate)
    if (!key) {
      return { success: false, status: store.status(), error: t('key.saveEmpty', getUiLanguage()) }
    }
    try {
      await store.setKey(key)
    } catch (error) {
      const message = t(
        error instanceof SecureStorageUnavailableError ? 'key.secureStorage' : 'key.saveFailed',
        getUiLanguage()
      )
      log.error('Saving key failed', error instanceof Error ? error : new Error(String(error)))
      return { success: false, status: store.status(), error: message }
    }
    log.info('API key saved')
    const status = store.status()
    deps.onKeyChanged?.(status)
    return { success: true, status }
  })

  handle(IPC_CHANNELS.REMOVE_KEY, (): ApiKeyStatus => {
    store.clear()
    log.info('API key removed')
    const status = store.status()
    deps.onKeyChanged?.(status)
    return status
  })

  on(IPC_CHANNELS.SETUP_DONE, (): void => {
    deps.onSetupDone?.()
  })
}
