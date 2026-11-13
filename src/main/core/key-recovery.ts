/**
 * When a request fails because the key is missing or rejected, send the user
 * to the setup screen instead of leaving them with an error they cannot act on.
 */

import { hideResultWindow, showSetupWindow } from './window-manager'
import type { TranslationErrorCode, TranslationResult } from '../../shared/types'

export const KEY_PROBLEM_CODES: readonly TranslationErrorCode[] = ['MISSING_KEY', 'INVALID_KEY']

export function isKeyProblem(result: TranslationResult): boolean {
  return !result.success && !!result.errorCode && KEY_PROBLEM_CODES.includes(result.errorCode)
}

export type ShowSetup = (reason: TranslationErrorCode) => void

const defaultShowSetup: ShowSetup = (reason) => {
  hideResultWindow()
  showSetupWindow(reason)
}

/** Returns true when the setup screen was opened for this result. */
export function recoverFromKeyProblem(
  result: TranslationResult,
  showSetup: ShowSetup = defaultShowSetup
): boolean {
  if (!isKeyProblem(result)) return false
  showSetup(result.errorCode as TranslationErrorCode)
  return true
}
