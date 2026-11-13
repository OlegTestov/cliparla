/** A short message near the cursor that hides itself. */

import { hideToastWindow, showToastWindow } from '../core/window-manager'

export const TOAST_MS = 2000

let timer: ReturnType<typeof setTimeout> | null = null

export function showToast(text: string, durationMs: number = TOAST_MS): void {
  if (timer) clearTimeout(timer)
  showToastWindow(text)
  timer = setTimeout(() => {
    timer = null
    hideToastWindow()
  }, durationMs)
  timer.unref?.()
}
