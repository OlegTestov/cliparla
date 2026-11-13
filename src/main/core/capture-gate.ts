/**
 * Screenshot capture is allowed only with Screen Recording granted. Without it
 * macOS returns a wallpaper-only image, which must never reach the translation
 * service. Every way to start a capture goes through here.
 */

import { showPermissionsWindow, showCaptureWindow } from './window-manager'
import { getPermissionsStatus, screenRecordingMissing } from '../services/permissions'
import type { PermissionsStatus } from '../../shared/types'

export interface CaptureGateDeps {
  status: () => PermissionsStatus
  showPermissions: () => void
  showOverlay: () => void
}

const defaultDeps: CaptureGateDeps = {
  status: getPermissionsStatus,
  showPermissions: showPermissionsWindow,
  showOverlay: showCaptureWindow
}

/** True when capturing may go on; otherwise the permissions window is shown. */
export function screenCaptureAllowed(deps: Partial<CaptureGateDeps> = {}): boolean {
  const { status, showPermissions } = { ...defaultDeps, ...deps }
  if (!screenRecordingMissing(status())) return true
  showPermissions()
  return false
}

/** What the next selection is for: translate it, or copy its text as it is. */
export type CaptureMode = 'translate' | 'copyText'

let pendingMode: CaptureMode = 'translate'

/** The mode the open overlay was started for; the next overlay starts as 'translate' again. */
export function takeCaptureMode(): CaptureMode {
  const mode = pendingMode
  pendingMode = 'translate'
  return mode
}

/** Open the selection overlay, or the permissions window when it cannot work. */
export function startCapture(
  deps: Partial<CaptureGateDeps> = {},
  mode: CaptureMode = 'translate'
): void {
  const { showOverlay } = { ...defaultDeps, ...deps }
  if (!screenCaptureAllowed(deps)) return
  pendingMode = mode
  showOverlay()
}
