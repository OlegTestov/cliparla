import { systemPreferences, desktopCapturer } from 'electron'
import { exec } from 'child_process'
import { createLogger } from '../core/logger'
import { markAccessibilityPrompted, wasAccessibilityPrompted } from './accessibility-prompt'
import type { PermissionsStatus, MediaPermissionStatus } from '../../shared/types'

const log = createLogger('Permissions')

export type { PermissionsStatus }

/**
 * Convert macOS media access status to our simplified status type
 */
function normalizeMediaStatus(status: string): MediaPermissionStatus {
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  return 'not-determined'
}

/**
 * Get current status of all required permissions.
 * Only relevant on macOS - returns all granted on other platforms.
 */
export function getPermissionsStatus(): PermissionsStatus {
  if (process.platform !== 'darwin') {
    return {
      screenRecording: 'granted',
      microphone: 'granted',
      accessibility: true,
      accessibilityPrompted: false
    }
  }

  return {
    screenRecording: normalizeMediaStatus(systemPreferences.getMediaAccessStatus('screen')),
    microphone: normalizeMediaStatus(systemPreferences.getMediaAccessStatus('microphone')),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    accessibilityPrompted: wasAccessibilityPrompted()
  }
}

/** Screen Recording is the only permission the first translation needs. */
export function screenRecordingMissing(
  status: PermissionsStatus,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'darwin' && status.screenRecording !== 'granted'
}

/** Microphone or Accessibility is not granted yet (macOS only). */
export function optionalPermissionsMissing(
  status: PermissionsStatus,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'darwin' && (status.microphone !== 'granted' || !status.accessibility)
}

/**
 * Make a fake screen capture attempt to trigger the system permission dialog.
 * Called on app startup if screen recording permission is not granted.
 * This helps the system show the permission dialog early.
 */
export async function triggerScreenRecordingDialog(): Promise<void> {
  if (process.platform !== 'darwin') return

  log.info('Triggering screen recording dialog with fake capture...')
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 }
    })
  } catch (error) {
    log.debug('Fake capture completed', { error: String(error) })
  }
}

/**
 * Request Screen Recording permission.
 * Opens System Settings to Screen Recording section where user can manually enable it.
 */
export async function requestScreenRecording(): Promise<void> {
  if (process.platform !== 'darwin') return

  log.info('Opening Screen Recording settings...')
  openScreenRecordingSettings()
}

/**
 * Request Microphone permission.
 * Shows the system dialog if status is 'not-determined'.
 * If already 'denied', this won't show a dialog - user must go to System Settings.
 *
 * @returns The new permission status after the request
 */
export async function requestMicrophone(): Promise<'granted' | 'denied' | 'not-determined'> {
  if (process.platform !== 'darwin') {
    return 'granted'
  }

  const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
  if (currentStatus === 'granted') {
    return 'granted'
  }

  // Request access - this shows system dialog if not-determined
  log.info('Requesting microphone permission...')
  const granted = await systemPreferences.askForMediaAccess('microphone')
  log.info('Microphone permission result', { granted })

  if (granted) return 'granted'

  // Check actual status
  const newStatus = systemPreferences.getMediaAccessStatus('microphone')
  if (newStatus === 'denied') return 'denied'
  return 'not-determined'
}

/**
 * Request Accessibility permission.
 * Shows a system dialog with "Open System Settings" button.
 * User must manually enable the app in System Settings.
 *
 * @returns The current accessibility status (may not change immediately)
 */
export function requestAccessibility(): boolean {
  if (process.platform !== 'darwin') {
    return true
  }

  log.info('Requesting accessibility permission...')
  // This shows a dialog with "Open System Settings" button
  const trusted = systemPreferences.isTrustedAccessibilityClient(true)
  markAccessibilityPrompted()
  log.info('Accessibility result', { trusted })
  return trusted
}

/**
 * Open System Settings to Screen Recording section
 */
export function openScreenRecordingSettings(): void {
  if (process.platform === 'darwin') {
    exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"')
  }
}

/**
 * Open System Settings to Microphone section
 */
export function openMicrophoneSettings(): void {
  if (process.platform === 'darwin') {
    exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"')
  }
}

/**
 * Open System Settings to Accessibility section
 */
export function openAccessibilitySettings(): void {
  if (process.platform === 'darwin') {
    exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"')
  }
}
