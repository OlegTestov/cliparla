/**
 * Which setup screen to show, kept apart from the React page so it can be tested.
 */

import { stepAfterKeySaved } from '../../../shared/setup-step'

export type SetupStep = 'key' | 'saved' | 'try'

export interface SetupScreen {
  step: SetupStep
  /** "Key saved" banner on the Try it screen */
  justSaved: boolean
  /** Screen Recording is already granted */
  screenReady: boolean
  /** First run: Continue leads to Microphone and Accessibility, not straight on */
  offerOptional: boolean
}

/** The subtitle of the "Key saved" screen. */
export function savedSubtitleKey(
  screen: Pick<SetupScreen, 'screenReady' | 'offerOptional'>
): string {
  if (screen.offerOptional) return 'setup.saved.subtitleOptional'
  return screen.screenReady ? 'setup.saved.subtitleReady' : 'setup.saved.subtitle'
}

export interface SetupApi {
  getPermissionsStatus: () => Promise<{
    screenRecording: string
    microphone: string
    accessibility: boolean
  }>
  getTryItPending: () => Promise<boolean>
}

/** The screen after a key was saved. A failed lookup leaves the decision to main. */
export async function screenAfterKeySaved(api: SetupApi): Promise<SetupScreen> {
  let screenReady = false
  let optionalMissing = false
  try {
    const status = await api.getPermissionsStatus()
    screenReady = status.screenRecording === 'granted'
    optionalMissing = status.microphone !== 'granted' || !status.accessibility
  } catch {
    // Treated as missing: the next screen explains the permission
  }
  let tryItPending = false
  try {
    tryItPending = await api.getTryItPending()
  } catch {
    // Main decides after "Continue"
  }
  const step = stepAfterKeySaved(screenReady, tryItPending, optionalMissing)
  return {
    step,
    justSaved: step === 'try',
    screenReady,
    offerOptional: screenReady && tryItPending && optionalMissing
  }
}

/** The screen when main asks for one (also on reload): never carries an old banner. */
export function screenOnRequest(
  reason: string | undefined
): Pick<SetupScreen, 'step' | 'justSaved'> {
  return { step: reason === 'TRY_IT' ? 'try' : 'key', justSaved: false }
}
