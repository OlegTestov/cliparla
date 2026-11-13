/**
 * Order of the first run: key saved -> Screen Recording (the only permission
 * needed for the first translation) -> "Try it now". Microphone and
 * Accessibility are offered on the Screen Recording screen and stay optional:
 * if skipped, they are asked at the first dictation.
 */

export type NextWindow = 'permissions' | 'tryit' | 'settings'

export interface OptionalPermissions {
  /** Right after a first-run key save, not on every launch */
  offer: boolean
  /** Microphone or Accessibility is not granted */
  missing: boolean
}

export function nextAfterSetup(
  screenRecordingMissing: boolean,
  optional: OptionalPermissions = { offer: false, missing: false }
): 'permissions' | 'tryit' {
  return screenRecordingMissing || (optional.offer && optional.missing) ? 'permissions' : 'tryit'
}

export function nextAfterPermissions(
  tryItPending: boolean,
  screenRecordingGranted: boolean
): 'tryit' | 'settings' {
  return tryItPending && screenRecordingGranted ? 'tryit' : 'settings'
}

/** A normal launch of a set-up menu-bar app opens no window, so focus stays where it was. */
export function startsSilently(screenRecordingMissing: boolean, tryItSeen: boolean): boolean {
  return !screenRecordingMissing && tryItSeen
}
