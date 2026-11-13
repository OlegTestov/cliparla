/**
 * IPC Onboarding Handler
 *
 * Domain: get-setup-reason, try-capture, finish-onboarding (the last step of the first run)
 */

import { handle, on } from '../core/ipc-guard'
import { getSetupReason, hideSetupWindow, showSettingsWindow } from '../core/window-manager'
import { startCapture } from '../core/capture-gate'
import { hasSeenTryIt, markTryItSeen } from '../services/store'
import { IPC_CHANNELS } from '../../shared/ipc-types'

export interface OnboardingHandlerDeps {
  hideSetup?: () => void
  showCapture?: () => void
  showSettings?: () => void
  getSetupReason?: () => string | undefined
  hasSeenTryIt?: () => boolean
}

export function registerOnboardingHandlers(deps: OnboardingHandlerDeps = {}): void {
  const hideSetup = deps.hideSetup ?? hideSetupWindow
  const showCapture = deps.showCapture ?? startCapture
  const showSettings = deps.showSettings ?? showSettingsWindow
  const setupReason = deps.getSetupReason ?? getSetupReason
  const seenTryIt = deps.hasSeenTryIt ?? hasSeenTryIt

  handle(IPC_CHANNELS.GET_SETUP_REASON, (): string | null => setupReason() ?? null)

  // Only a first run goes on to "Try it now"; a returning user goes through setupDone
  handle(IPC_CHANNELS.GET_TRY_IT_PENDING, (): boolean => !seenTryIt())

  // "Try it now": drop straight into the screenshot selection
  on(IPC_CHANNELS.TRY_CAPTURE, (): void => {
    markTryItSeen()
    hideSetup()
    showCapture()
  })

  on(IPC_CHANNELS.FINISH_ONBOARDING, (): void => {
    markTryItSeen()
    hideSetup()
    showSettings()
  })
}
