/**
 * IPC Result Handler
 *
 * Handles result-related IPC communication between main and renderer processes.
 * Domain: copy-to-clipboard, close-result, comment-text, improve-text, summarize-text
 */

import { clipboard, ClipboardItem } from 'electron'
import { pngItem } from '../services/clipboard-store'
import { handle, on } from '../core/ipc-guard'
import { hideResultWindow } from '../core/window-manager'
import { cancelResultRequests, trackResultRequest } from '../services/result-requests'
import { createLogger } from '../core/logger'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import {
  getTranslationService,
  type StreamOptions,
  type TranslationService
} from '../services/translation'
import { recoverFromKeyProblem, type ShowSetup } from '../core/key-recovery'
import { getLastScreenshot } from './capture'
import { getUiLanguage } from '../services/store'
import { localizeResult, t } from '../core/localize'
import type { TranslationResult } from '../../shared/types'

const log = createLogger('IPC:Result')

const MAX_TEXT_LENGTH = 50_000

function validateTextInput(text: string): string | null {
  const language = getUiLanguage()
  if (!text || typeof text !== 'string') return t('errormsg.noText', language)
  if (text.length > MAX_TEXT_LENGTH)
    return t('errormsg.textTooLong', language, { max: MAX_TEXT_LENGTH.toLocaleString() })
  return null
}

export interface ResultHandlerDeps {
  getService?: () => TranslationService
  showSetup?: ShowSetup
}

/**
 * Register result-related IPC handlers.
 */
export function registerResultHandlers(deps: ResultHandlerDeps = {}): void {
  const getService = deps.getService ?? getTranslationService

  async function runTextAction(
    text: string,
    sender: Electron.WebContents,
    requestId: unknown,
    run: (
      service: TranslationService,
      text: string,
      stream: StreamOptions
    ) => Promise<TranslationResult>
  ): Promise<TranslationResult> {
    const validationError = validateTextInput(text)
    if (validationError) return { success: false, error: validationError }
    const onText = (soFar: string): void => {
      if (sender && !sender.isDestroyed())
        sender.send(IPC_CHANNELS.ACTION_PARTIAL, { requestId, text: soFar })
    }
    const result = await trackResultRequest((signal) => run(getService(), text, { onText, signal }))
    recoverFromKeyProblem(result, deps.showSetup)
    return localizeResult(result, getUiLanguage())
  }

  /**
   * Handler for copying text to clipboard.
   * Uses Electron's clipboard API for cross-platform support.
   */
  handle(IPC_CHANNELS.COPY_TO_CLIPBOARD, async (_event, text: string): Promise<void> => {
    log.debug('Copying to clipboard', { preview: text.substring(0, 50) + '...' })
    await clipboard.writeText(text)
  })

  /**
   * Handler for copying the screenshot image to clipboard.
   * Writes the PNG as a ClipboardItem for cross-platform support.
   */
  handle(IPC_CHANNELS.COPY_SCREENSHOT, async (): Promise<{ success: boolean }> => {
    const base64 = getLastScreenshot()
    if (!base64) {
      log.warn('No screenshot available to copy')
      return { success: false }
    }

    log.debug('Copying screenshot to clipboard')
    await clipboard.write([pngItem(ClipboardItem, Buffer.from(base64, 'base64'))])
    return { success: true }
  })

  /**
   * Handler for closing the result window.
   */
  on(IPC_CHANNELS.CLOSE_RESULT, (): void => {
    log.debug('Closing result window')
    cancelResultRequests()
    hideResultWindow()
  })

  /**
   * Handler for commenting on text.
   * If text is a question, answers it. If statement, provides smart commentary.
   */
  handle(IPC_CHANNELS.COMMENT_TEXT, (event, text: string, requestId?: unknown) =>
    runTextAction(text, event.sender, requestId, (service, input, stream) =>
      service.commentText(input, stream)
    )
  )

  /**
   * Handler for improving text.
   * Fixes errors and improves phrasing to sound native and polished.
   */
  handle(IPC_CHANNELS.IMPROVE_TEXT, (event, text: string, requestId?: unknown) =>
    runTextAction(text, event.sender, requestId, (service, input, stream) =>
      service.improveText(input, stream)
    )
  )

  /**
   * Handler for summarizing text.
   * Extracts key points and condenses content.
   */
  handle(IPC_CHANNELS.SUMMARIZE_TEXT, (event, text: string, requestId?: unknown) =>
    runTextAction(text, event.sender, requestId, (service, input, stream) =>
      service.summarizeText(input, stream)
    )
  )
}
