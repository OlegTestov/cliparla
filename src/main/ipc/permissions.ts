/**
 * IPC Permissions Handler
 *
 * Handles permissions-related IPC communication between main and renderer processes.
 * Domain: get-permissions-status, request-*, open-*-settings, permissions-continue
 */

import { handle, on } from '../core/ipc-guard'
import {
  getPermissionsStatus,
  requestScreenRecording,
  requestMicrophone,
  requestAccessibility,
  openScreenRecordingSettings,
  openMicrophoneSettings,
  openAccessibilitySettings,
  PermissionsStatus
} from '../services/permissions'
import { hidePermissionsWindow, showSettingsWindow } from '../core/window-manager'
import { createLogger } from '../core/logger'
import { IPC_CHANNELS } from '../../shared/ipc-types'

const log = createLogger('IPC:Permissions')

/**
 * Register permissions-related IPC handlers.
 */
export interface PermissionsHandlerDeps {
  /** The Continue button was pressed. Defaults to opening Settings. */
  onContinue?: () => void
}

export function registerPermissionsHandlers(deps: PermissionsHandlerDeps = {}): void {
  /**
   * Get current status of all permissions.
   */
  handle(IPC_CHANNELS.GET_PERMISSIONS_STATUS, (): PermissionsStatus => {
    log.debug('Getting permissions status')
    return getPermissionsStatus()
  })

  /**
   * Request Screen Recording permission.
   * Opens System Settings to Screen Recording section.
   */
  handle(IPC_CHANNELS.REQUEST_SCREEN_RECORDING, async (): Promise<void> => {
    log.info('Requesting screen recording permission')
    await requestScreenRecording()
  })

  /**
   * Request Microphone permission.
   * Shows system dialog if not yet determined.
   */
  handle(IPC_CHANNELS.REQUEST_MICROPHONE, async (): Promise<string> => {
    log.info('Requesting microphone permission')
    return await requestMicrophone()
  })

  /**
   * Request Accessibility permission.
   * Shows system dialog with "Open System Settings" button.
   */
  handle(IPC_CHANNELS.REQUEST_ACCESSIBILITY, (): boolean => {
    log.info('Requesting accessibility permission')
    return requestAccessibility()
  })

  /**
   * Open System Settings to Screen Recording section.
   */
  on(IPC_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS, (): void => {
    log.debug('Opening screen recording settings')
    openScreenRecordingSettings()
  })

  /**
   * Open System Settings to Microphone section.
   */
  on(IPC_CHANNELS.OPEN_MICROPHONE_SETTINGS, (): void => {
    log.debug('Opening microphone settings')
    openMicrophoneSettings()
  })

  /**
   * Open System Settings to Accessibility section.
   */
  on(IPC_CHANNELS.OPEN_ACCESSIBILITY_SETTINGS, (): void => {
    log.debug('Opening accessibility settings')
    openAccessibilitySettings()
  })

  /**
   * Continue from permissions window - hide it and show settings.
   */
  on(IPC_CHANNELS.PERMISSIONS_CONTINUE, (): void => {
    log.info('Permissions continue')
    hidePermissionsWindow()
    if (deps.onContinue) deps.onContinue()
    else showSettingsWindow()
  })
}
