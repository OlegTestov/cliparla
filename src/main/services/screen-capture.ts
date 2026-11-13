/**
 * Screen Capture Service
 * Captures screenshots of active monitor and crops selected areas.
 */

import { app, desktopCapturer, screen } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { SelectionCoords } from '../../shared/types'
import { getCaptureWindowBounds } from '../core/window-manager'
import { cropRectFor, displayForSelection } from './capture-geometry'
import { isUniformBitmap } from './blank-image'
import { createLogger } from '../core/logger'

const log = createLogger('ScreenCapture')

// Maximum screenshot size in bytes (5 MB)
const MAX_SCREENSHOT_SIZE_BYTES = 5 * 1024 * 1024

/**
 * Save screenshot to file in development mode for debugging.
 * Screenshots are saved to: ~/Library/Application Support/Cliparla/debug/
 *
 * This is async and fire-and-forget to avoid blocking the capture pipeline.
 * Only runs in development mode (not in packaged app).
 */
function saveDebugScreenshot(imageBuffer: Buffer, label: string): void {
  // Skip entirely in production - no overhead at all
  if (app.isPackaged) return // Fire-and-forget async operation - don't await
  ;(async () => {
    try {
      const debugDir = join(app.getPath('userData'), 'debug')

      // Create debug directory if it doesn't exist
      if (!existsSync(debugDir)) {
        await mkdir(debugDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `${timestamp}_${label}.png`
      const filepath = join(debugDir, filename)

      await writeFile(filepath, imageBuffer)
      log.debug('Screenshot saved', { filepath })
    } catch (error) {
      log.error(
        'Failed to save debug screenshot',
        error instanceof Error ? error : new Error(String(error))
      )
    }
  })()
}

/** Returned instead of an image when the selected area is one flat colour. */
export const BLANK_CAPTURE = Symbol('blank-capture')

/** What capture needs from Electron; replaceable in tests. */
export interface CaptureDeps {
  overlayBounds: () => Electron.Rectangle | null
  displays: () => Electron.Display[]
  sources: (size: { width: number; height: number }) => Promise<Electron.DesktopCapturerSource[]>
}

const defaultDeps: CaptureDeps = {
  overlayBounds: () => getCaptureWindowBounds(),
  displays: () => screen.getAllDisplays(),
  sources: (thumbnailSize) => desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
}

/**
 * Capture and crop the selected screen area, from the display that holds the
 * whole box drawn in the overlay window.
 * @returns Base64 encoded PNG, BLANK_CAPTURE for a flat area, or null if capture failed
 */
export async function captureScreen(
  coords: SelectionCoords,
  deps: CaptureDeps = defaultDeps
): Promise<string | typeof BLANK_CAPTURE | null> {
  try {
    const windowBounds = deps.overlayBounds()
    const displaysBefore = deps.displays()
    const display = displayForSelection(coords, windowBounds, displaysBefore)
    if (!display || !windowBounds) {
      // Never guess another display: that would send the wrong screen to the service
      log.error('No display holds the selection', new Error('No selection display'))
      return null
    }
    const { width, height } = display.size
    const { scaleFactor } = display

    // CRITICAL: thumbnailSize must match actual screen size for OCR quality
    const sources = await deps.sources({
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor)
    })

    // The display may have been unplugged while the screens were captured
    const displaysNow = deps.displays()
    if (!displaysNow.some((d) => d.id === display.id)) {
      log.error('Display disappeared during capture', new Error('Display gone'))
      return null
    }

    // The source of that display; a single-screen setup may report no id
    const source =
      sources.find((s) => s.display_id === display.id.toString()) ??
      (sources.length === 1 && displaysBefore.length === 1 && displaysNow.length === 1
        ? sources[0]
        : undefined)

    if (!source) {
      log.error('No screen source found', new Error('No screen source'))
      return null
    }

    const thumbnail = source.thumbnail
    if (thumbnail.isEmpty()) {
      log.error('Thumbnail is empty', new Error('Empty thumbnail'))
      return null
    }

    const imgSize = thumbnail.getSize()

    const cropRect = cropRectFor(coords, windowBounds, display, imgSize)

    const cropped = thumbnail.crop(cropRect)
    if (cropped.isEmpty()) {
      log.error('Cropped image is empty', new Error('Empty cropped image'))
      return null
    }

    // A flat single-colour image has nothing to translate (no permission, locked screen)
    if (isUniformBitmap(cropped.toBitmap())) {
      log.warn('Selected area is one flat colour, not sending it')
      return BLANK_CAPTURE
    }

    const croppedBuffer = cropped.toPNG()

    // Quick size check (O(1) - just comparing buffer length)
    if (croppedBuffer.length > MAX_SCREENSHOT_SIZE_BYTES) {
      log.error('Screenshot exceeds size limit', new Error('Screenshot too large'), {
        sizeBytes: croppedBuffer.length,
        limitBytes: MAX_SCREENSHOT_SIZE_BYTES,
        sizeMB: (croppedBuffer.length / (1024 * 1024)).toFixed(2)
      })
      return null
    }

    // Save debug screenshots in dev mode
    saveDebugScreenshot(thumbnail.toPNG(), 'fullscreen')
    saveDebugScreenshot(croppedBuffer, 'cropped')

    return croppedBuffer.toString('base64')
  } catch (error) {
    log.error('Screen capture error', error instanceof Error ? error : new Error(String(error)))
    return null
  }
}
