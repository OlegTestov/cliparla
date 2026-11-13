/**
 * IPC Capture Handler
 *
 * Handles capture-related IPC communication between main and renderer processes.
 * Domain: selection-made, cancel-capture
 *
 * Translation goes through the TranslationService.
 */

import { app, clipboard } from 'electron'
import { on } from '../core/ipc-guard'
import {
  hideCaptureWindow,
  isFromOpenOverlay,
  showResultWindow,
  sendTranslationStart,
  sendTranslationPartial,
  sendTranslationResult
} from '../core/window-manager'
import { screenCaptureAllowed, takeCaptureMode } from '../core/capture-gate'
import { showToast } from '../services/toast'
import { captureScreen, BLANK_CAPTURE } from '../services/screen-capture'
import { setLastResult } from '../services/last-result'
import { getTranslationService, type TranslationService } from '../services/translation'
import { getScreenshotTargetLanguage, getUiLanguage } from '../services/store'
import { localizeResult, t } from '../core/localize'
import { recoverFromKeyProblem, type ShowSetup } from '../core/key-recovery'
import { createLogger } from '../core/logger'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import { NO_TEXT_MARKER } from '../../shared/gemini-constants'
import type { SelectionCoords } from '../../shared/types'
import { trackResultRequest } from '../services/result-requests'

const log = createLogger('IPC:Capture')

// Minimum selection size in pixels (defense in depth - also validated in frontend)
const MIN_SELECTION_SIZE = 10

// Store last captured screenshot for "Copy screenshot" feature
let lastScreenshotBase64: string | null = null

// Guard against concurrent translation requests
let isTranslating = false

/**
 * Get the last captured screenshot as base64 PNG.
 */
export function getLastScreenshot(): string | null {
  return lastScreenshotBase64
}

/**
 * Performance timer for development debugging
 */
function createTimer(): { elapsed: () => number; log: (label: string) => void } {
  const start = performance.now()
  let lastCheckpoint = start

  return {
    elapsed: () => performance.now() - start,
    log: (label: string) => {
      if (!app.isPackaged) {
        const now = performance.now()
        const total = (now - start).toFixed(0)
        const step = (now - lastCheckpoint).toFixed(0)
        log.debug(`${label}: ${step}ms (total: ${total}ms)`)
        lastCheckpoint = now
      }
    }
  }
}

export interface CaptureHandlerDeps {
  captureScreen?: (coords: SelectionCoords) => Promise<string | typeof BLANK_CAPTURE | null>
  getService?: () => TranslationService
  showSetup?: ShowSetup
  /** False (and the permissions window opened) when Screen Recording is missing. */
  captureAllowed?: () => boolean
  /** Only the open overlay may send a selection (default: checked against the window). */
  fromOverlay?: (event: { sender?: { id: number } }) => boolean
  /** "Copy text" puts the text here; defaults to the system clipboard. */
  writeClipboard?: (text: string) => void
  /** The small message near the cursor. */
  toast?: (text: string) => void
}

/**
 * Register capture-related IPC handlers.
 */
export function registerCaptureHandlers(deps: CaptureHandlerDeps = {}): void {
  const capture = deps.captureScreen ?? captureScreen
  const getService = deps.getService ?? getTranslationService
  const fromOverlay = deps.fromOverlay ?? isFromOpenOverlay
  const captureAllowed = deps.captureAllowed ?? screenCaptureAllowed
  const writeClipboard = deps.writeClipboard ?? ((text: string) => clipboard.writeText(text))
  const toast = deps.toast ?? showToast

  /** Errors of both flows use the result window. */
  async function showFailure(message: string): Promise<void> {
    sendTranslationStart()
    await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 50 : 0))
    showResultWindow()
    sendTranslationResult({ success: false, error: message })
  }

  /** "Copy text": the region's text goes to the clipboard as it is, with a short toast. */
  async function copyRegionText(coords: SelectionCoords): Promise<void> {
    const language = getUiLanguage()
    const captured = await capture(coords)
    if (captured === BLANK_CAPTURE || !captured) {
      await showFailure(
        t(captured === BLANK_CAPTURE ? 'errormsg.blankArea' : 'errormsg.captureFailed', language)
      )
      return
    }
    const result = await getService().extractText(captured)
    if (recoverFromKeyProblem(result, deps.showSetup)) return
    if (!result.success) {
      await showFailure(localizeResult(result, language).error || t('error.UNKNOWN', language))
      return
    }
    if (!result.text?.trim()) {
      toast(t('toast.noText', language))
      return
    }
    // Not restored later: leaving the text on the clipboard is the point
    writeClipboard(result.text)
    toast(t('toast.copied', language))
  }

  /** Translate the picture, streaming the text into the result window, and show the outcome. */
  async function translateAndSend(
    imageBase64: string,
    timer: ReturnType<typeof createTimer>
  ): Promise<void> {
    const targetLanguage = getScreenshotTargetLanguage()
    let cancelled = false
    const result = await trackResultRequest((signal) => {
      signal.addEventListener('abort', () => (cancelled = true))
      return getService().translateScreenshot(imageBase64, targetLanguage, {
        onText: sendTranslationPartial,
        signal
      })
    })
    // The window was closed meanwhile: there is nobody to show the result to
    if (cancelled) return

    timer.log('Gemini API response received')

    // Missing/rejected key: open the setup screen, otherwise show the result
    if (!recoverFromKeyProblem(result, deps.showSetup)) {
      if (result.success && result.text && !result.text.includes(NO_TEXT_MARKER)) {
        setLastResult(result.text)
      }
      sendTranslationResult(localizeResult(result, getUiLanguage()))
    }
    timer.log('Workflow complete')

    log.debug('Total workflow time', {
      timeMs: timer.elapsed().toFixed(0),
      success: result.success
    })
  }

  /**
   * Handler for when user finishes selecting an area in the capture overlay.
   * Triggers the full capture → translate → display workflow.
   */
  on(IPC_CHANNELS.SELECTION_MADE, async (event, coords: SelectionCoords): Promise<void> => {
    // Another window, or no overlay on screen: nobody drew this region
    if (!fromOverlay(event)) {
      log.warn('Selection not from the open overlay, ignoring')
      return
    }
    // Read first: every way out below must also reset the mode
    const mode = takeCaptureMode()
    const timer = createTimer()
    log.debug('Selection made', {
      x: coords.x,
      y: coords.y,
      width: coords.width,
      height: coords.height
    })

    // 1. Guard against concurrent requests
    if (isTranslating) {
      log.warn('Translation already in progress, ignoring')
      hideCaptureWindow()
      return
    }

    // 2. Validate selection size (defense in depth)
    if (coords.width < MIN_SELECTION_SIZE || coords.height < MIN_SELECTION_SIZE) {
      log.warn('Selection too small, ignoring', { width: coords.width, height: coords.height })
      hideCaptureWindow()
      return
    }

    // Permission can be revoked while the overlay is open: check again before capturing
    if (!captureAllowed()) {
      hideCaptureWindow()
      return
    }

    isTranslating = true

    // 2. Hide the capture overlay immediately
    hideCaptureWindow()
    timer.log('Overlay hidden')

    if (mode === 'copyText') {
      try {
        await copyRegionText(coords)
      } catch (error) {
        log.error(
          'Error in copy-text workflow',
          error instanceof Error ? error : new Error(String(error))
        )
        await showFailure(t('error.UNKNOWN', getUiLanguage()))
      } finally {
        isTranslating = false
      }
      return
    }

    try {
      // 3. Capture the selected screen area BEFORE showing result window
      // This prevents the result window from appearing in the screenshot
      const captured = await capture(coords)
      const blank = captured === BLANK_CAPTURE
      const imageBase64 = blank ? null : captured
      lastScreenshotBase64 = imageBase64
      timer.log('Screen captured')

      // 4. Show result window with loading state AFTER screenshot is taken
      // Send translation-start BEFORE showing window so React clears old content
      // before the window becomes visible (prevents stale content flash on Windows)
      sendTranslationStart()
      await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 50 : 0))
      showResultWindow()
      timer.log('Result window shown')

      if (!imageBase64) {
        sendTranslationResult({
          success: false,
          error: t(blank ? 'errormsg.blankArea' : 'errormsg.captureFailed', getUiLanguage())
        })
        return
      }

      // 5. Translate with the configured service
      await translateAndSend(imageBase64, timer)
    } catch (error) {
      log.error(
        'Error in capture workflow',
        error instanceof Error ? error : new Error(String(error))
      )
      sendTranslationResult({
        success: false,
        error: t('error.UNKNOWN', getUiLanguage())
      })
    } finally {
      isTranslating = false
    }
  })

  /** Retry after a failed translation: the same picture again. */
  on(IPC_CHANNELS.RETRY_TRANSLATION, async (): Promise<void> => {
    if (isTranslating || !lastScreenshotBase64) return
    isTranslating = true
    try {
      sendTranslationStart()
      await translateAndSend(lastScreenshotBase64, createTimer())
    } catch (error) {
      log.error(
        'Error in translation retry',
        error instanceof Error ? error : new Error(String(error))
      )
      sendTranslationResult({ success: false, error: t('error.UNKNOWN', getUiLanguage()) })
    } finally {
      isTranslating = false
    }
  })

  /**
   * Handler for when user cancels the capture (e.g., presses ESC).
   */
  on(IPC_CHANNELS.CANCEL_CAPTURE, (): void => {
    log.info('Capture cancelled')
    takeCaptureMode()
    hideCaptureWindow()
  })
}
