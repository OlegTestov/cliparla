/**
 * IPC Handlers Index
 *
 * Composes all domain-specific IPC handlers into a single registration function.
 * This is the main entry point for IPC handler registration.
 */

import { registerSettingsHandlers } from './settings'
import { registerCaptureHandlers } from './capture'
import { registerResultHandlers } from './result'
import { registerDictationHandlers } from './dictation'
import { registerPermissionsHandlers, type PermissionsHandlerDeps } from './permissions'
import { registerOnboardingHandlers } from './onboarding'
import { registerApiKeyHandlers, type ApiKeyHandlerDeps } from './api-key'
import { registerAppHandlers } from './app'
import { createLogger } from '../core/logger'

const log = createLogger('IPC')

/**
 * Register all IPC handlers for communication between main and renderer processes.
 * Composes handlers from all domain modules.
 */
export function registerAllIpcHandlers(
  apiKeyDeps: ApiKeyHandlerDeps = {},
  permissionsDeps: PermissionsHandlerDeps = {}
): void {
  log.info('Registering all IPC handlers')

  registerSettingsHandlers()
  registerCaptureHandlers()
  registerResultHandlers()
  registerDictationHandlers()
  registerPermissionsHandlers(permissionsDeps)
  registerOnboardingHandlers()
  registerApiKeyHandlers(apiKeyDeps)
  registerAppHandlers()

  log.info('All IPC handlers registered')
}
