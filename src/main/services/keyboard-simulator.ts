import { BrowserWindow, clipboard, ClipboardItem, systemPreferences } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../core/logger'
import { hasExternalPasteTarget, pasteOnMac } from './mac-paste-helper'
import {
  isMimeType,
  restoreClipboard,
  saveClipboard,
  type ClipboardItemCtor,
  type ClipboardLike
} from './clipboard-store'

const execAsync = promisify(exec)
const log = createLogger('KeyboardSimulator')

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if the app has Accessibility permission on macOS.
 * This is required for sending the paste keystroke through CGEvent.
 *
 * @param prompt - If true, shows the system dialog to request permission
 * @returns true if permission is granted, false otherwise
 */
export function checkAccessibilityPermission(prompt: boolean = false): boolean {
  if (process.platform !== 'darwin') {
    return true // Not needed on Windows/Linux
  }

  return systemPreferences.isTrustedAccessibilityClient(prompt)
}

/**
 * Simulate Cmd+V (macOS) or Ctrl+V (Windows/Linux) to paste from clipboard.
 * Uses system utilities - no native dependencies required.
 *
 * - macOS: the bundled CGEvent helper
 * - Windows: PowerShell - always available in Windows 7+
 * - Linux: xdotool - needs to be installed
 */
export async function simulatePaste(pasteMac: () => Promise<void> = pasteOnMac): Promise<void> {
  if (process.platform === 'darwin') {
    await pasteMac()
  } else if (process.platform === 'win32') {
    // Windows: Use PowerShell to simulate Ctrl+V
    await execAsync(
      'powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^v\')"'
    )
  } else {
    // Linux: Use xdotool to simulate Ctrl+V
    try {
      await execAsync('xdotool key ctrl+v')
    } catch (error) {
      // Check if xdotool is installed
      try {
        await execAsync('which xdotool')
      } catch {
        throw new Error(
          'xdotool is not installed. Please install it:\n' +
            '  Ubuntu/Debian: sudo apt install xdotool\n' +
            '  Fedora: sudo dnf install xdotool\n' +
            '  Arch: sudo pacman -S xdotool'
        )
      }
      throw error
    }
  }
}

/**
 * Paste text into the currently active application.
 *
 * This function:
 * 1. Saves the original clipboard content
 * 2. Writes the new text to clipboard
 * 3. Simulates Cmd+V / Ctrl+V to paste
 * 4. Restores the original clipboard content after a successful paste
 *
 * @param text - The text to paste
 * @throws Error if pasting fails (text stays on the clipboard; the caller shows a copy notice)
 */
export interface PasteIo {
  /** Bound for reading the clipboard before the paste (default 300 ms) */
  clipboardReadTimeoutMs?: number
  clipboard?: ClipboardLike & { writeText(text: string): void | Promise<void> }
  Item?: ClipboardItemCtor
  simulate?: () => Promise<void>
  targetReady?: () => boolean | Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** A panel can retain app activation even when Electron has no focused BrowserWindow. */
export async function pasteTargetReady(
  externalAppActive: () => Promise<boolean> = hasExternalPasteTarget
): Promise<boolean> {
  if (BrowserWindow.getFocusedWindow()) return false
  const external = process.platform !== 'darwin' || (await externalAppActive())
  return external && !BrowserWindow.getFocusedWindow()
}

async function waitForPasteTarget(io: PasteIo): Promise<void> {
  const now = io.now ?? Date.now
  const pause = io.sleep ?? sleep
  let started = now()
  let firstProbe = true
  const ready = io.targetReady ?? pasteTargetReady
  while (true) {
    let safe: boolean
    const probeStarted = now()
    try {
      safe = await ready()
    } catch (error) {
      log.warn('Paste focus handoff', { waitedMs: now() - started, outcome: 'copied-probe-failed' })
      throw error
    }
    if (firstProbe) {
      // The helper's first start can take seconds; that is not time the target spent taking focus
      started += now() - probeStarted
      firstProbe = false
    }
    const waitedMs = now() - started
    if (safe && waitedMs <= 400) {
      log.info('Paste focus handoff', { waitedMs, outcome: 'external-target' })
      return
    }
    if (waitedMs >= 400) {
      log.warn('Paste focus handoff', { waitedMs, outcome: 'copied-no-target' })
      throw new Error('No external paste target after focus handoff')
    }
    await pause(Math.min(25, 400 - waitedMs))
  }
}

/** Only restore while the clipboard still contains the text this paste wrote. */
async function stillOwnsClipboard(board: ClipboardLike, text: string): Promise<boolean> {
  try {
    const items = await board.read()
    if (items.length !== 1 || !items[0].types.includes('text/plain')) return false
    // Another format signals a new copy even if its plain text happens to match ours.
    // Only real MIME types count: macOS also lists pseudo-types such as "electron application/findtext".
    if (items[0].types.some((type) => isMimeType(type) && type !== 'text/plain')) return false
    const value = await items[0].getType('text/plain')
    return (value instanceof Blob ? await value.text() : value) === text
  } catch {
    return false // An unreadable clipboard must never be overwritten.
  }
}

// A second paste must not save the clipboard while the first has not restored it
let pasteQueue: Promise<unknown> = Promise.resolve()

export function pasteText(text: string, io: PasteIo = {}): Promise<void> {
  const run = pasteQueue.then(() => pasteNow(text, io))
  pasteQueue = run.catch(() => undefined)
  return run
}

async function pasteNow(text: string, io: PasteIo): Promise<void> {
  const board = io.clipboard ?? clipboard
  const pause = io.sleep ?? sleep
  let keepText = false

  // 1. Save original clipboard content
  const originalContent = await saveClipboard(board, {
    timeoutMs: io.clipboardReadTimeoutMs,
    onTimeout: () => log.warn('Reading the clipboard took too long, saved only part of it')
  })
  log.debug('Saved original clipboard content', { items: originalContent?.length ?? 'unreadable' })

  try {
    // 2. Write new text to clipboard
    await board.writeText(text)

    // 3. Small delay for clipboard to update
    await pause(10)

    // Inside the serialized operation and immediately before posting, for every paste entry point.
    await waitForPasteTarget(io)

    // 4. Simulate Cmd+V / Ctrl+V
    await (io.simulate ?? simulatePaste)()

    // The target reads asynchronously. Keep our text available for at least 300 ms after posting.
    await pause(300)
  } catch (error) {
    // Failed delivery must leave the dictated text available for a manual paste.
    keepText = true
    log.error('Failed to paste text', error instanceof Error ? error : new Error(String(error)))
    throw error
  } finally {
    if (!keepText && (await stillOwnsClipboard(board, text))) {
      await restoreClipboard(board, io.Item ?? ClipboardItem, originalContent)
        .then((outcome) => {
          if (outcome === 'partial')
            log.warn('Clipboard restored only in part (some formats refused)')
        })
        .catch((error) => log.warn('Could not restore clipboard', { message: String(error) }))
    }
  }
}
