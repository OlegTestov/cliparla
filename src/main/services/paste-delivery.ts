/**
 * Hand the dictated text to the user: paste it when Accessibility allows,
 * otherwise leave it on the clipboard. The text is never lost.
 */

import { clipboard } from 'electron'
import { createLogger } from '../core/logger'
import { checkAccessibilityPermission, pasteText } from './keyboard-simulator'
import { markAccessibilityPrompted, wasAccessibilityPrompted } from './accessibility-prompt'
import { PasteNotTrustedError, PasteSecureInputError } from './mac-paste-helper'
import {
  armAccessibilityHint,
  showCopiedNotice,
  type CopiedNoticeOptions
} from './accessibility-hint'

const log = createLogger('PasteDelivery')

export interface DeliveryDeps {
  paste?: (text: string) => Promise<void>
  isTrusted?: () => boolean
  /** Shows the macOS Accessibility prompt */
  prompt?: () => void
  copy?: (text: string) => void
  notify?: (options: CopiedNoticeOptions) => void
  /** False when a newer dictation owns the indicator: only the system notice is shown */
  indicatorAllowed?: () => boolean
  watchGrant?: () => void
  /** Leave the text on the clipboard without pasting (a Cliparla window has the keyboard) */
  copyOnly?: boolean
}

/** Test hook: a new app run asks again. */
export { resetAccessibilityPromptedForTests as resetPromptForTests } from './accessibility-prompt'

export async function deliverText(text: string, deps: DeliveryDeps = {}): Promise<void> {
  const isTrusted = deps.isTrusted ?? (() => checkAccessibilityPermission(false))
  const copyInstead = (reason: CopiedNoticeOptions['reason']): void => {
    // Unlike a paste, this does not restore the old clipboard: the text must stay
    ;(deps.copy ?? ((value) => clipboard.writeText(value)))(text)
    ;(deps.notify ?? showCopiedNotice)({ indicator: deps.indicatorAllowed?.() ?? true, reason })
  }

  if (deps.copyOnly) {
    copyInstead('paste-failed')
    return
  }

  if (isTrusted()) {
    try {
      await (deps.paste ?? pasteText)(text)
      return
    } catch (error) {
      if (error instanceof PasteSecureInputError) {
        log.warn('Secure Input blocked paste, text left on clipboard')
        copyInstead('secure-input')
        return
      }
      if (error instanceof PasteNotTrustedError) {
        // macOS says trusted, the helper says not: a stale entry. No prompt (it would do nothing)
        // and no grant watcher (it would announce "enabled" while pasting still fails)
        log.warn('Helper reports Accessibility missing although the app is trusted')
        copyInstead('not-trusted')
        return
      }
      log.error('Paste failed, text copied instead', error as Error)
      copyInstead('paste-failed')
      return
    }
  }

  copyInstead('no-permission')
  log.info('No accessibility permission, text copied instead of pasted')

  // The prompt shows once per run, whoever asked first (the permissions window or an earlier miss).
  // The grant watcher always starts: it is what says "pasting is automatic now" (one at a time).
  if (!wasAccessibilityPrompted()) {
    markAccessibilityPrompted()
    ;(deps.prompt ?? (() => void checkAccessibilityPermission(true)))()
  }
  ;(deps.watchGrant ?? armAccessibilityHint)()
}
