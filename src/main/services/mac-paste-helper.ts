/**
 * macOS paste: the bundled CGEvent helper posts Cmd+V and needs only Accessibility.
 * It also supplies the read-only focus and Secure Input probes.
 */

import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { createLogger } from '../core/logger'

const execFileAsync = promisify(execFile)
const log = createLogger('MacPasteHelper')

/** The helper's exit code when Accessibility is not granted (see native/paste-helper). */
export const EXIT_NOT_TRUSTED = 2
export const EXIT_NO_PASTE_TARGET = 4
export const EXIT_SECURE_INPUT = 5

export class PasteSecureInputError extends Error {
  constructor() {
    super('Secure Input is enabled in another app')
  }
}

export class PasteNotTrustedError extends Error {
  constructor() {
    super('Accessibility permission is not granted')
  }
}

export interface HelperEnv {
  packaged: boolean
  resourcesPath: string
  cwd: string
  exists: (path: string) => boolean
  run: (file: string, args: string[]) => Promise<unknown>
}

const defaultEnv = (): HelperEnv => ({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  cwd: process.cwd(),
  exists: existsSync,
  run: (file, args) => execFileAsync(file, args, { timeout: probeTimeoutMs(args) })
})

/**
 * The first run of the helper is slow (Gatekeeper and XProtect scan it): measured 160-456 ms on
 * fresh copies and 2231 ms for the signed one, then about 5 ms. 100 ms made the first paste fail.
 */
export function probeTimeoutMs(args: string[]): number {
  return args[0]?.startsWith('--check-') ? 4000 : 5000
}

/** A probe killed by its timeout says nothing about the focus: not a reason to give up pasting. */
function timedOut(error: unknown): boolean {
  const e = error as { killed?: unknown; signal?: unknown } | null
  return e?.killed === true || e?.signal === 'SIGTERM'
}

/** Runs the helper once at start-up so its slow first start happens before the first paste. */
export async function warmUpPasteHelper(env: HelperEnv = defaultEnv()): Promise<void> {
  if (process.platform !== 'darwin' || !env.packaged) return
  const file = pasteHelperPath(env)
  if (!env.exists(file)) return
  try {
    await env.run(file, ['--check-secure', String(process.pid)])
  } catch {
    // Only a warm-up: Secure Input or a failure is handled again at paste time
  }
}

/** Packaged: Contents/Resources/bin; dev: native/build (made by `npm run build:native`). */
export function pasteHelperPath(
  env: Pick<HelperEnv, 'packaged' | 'resourcesPath' | 'cwd'>
): string {
  return env.packaged
    ? join(env.resourcesPath, 'bin', 'cliparla-paste')
    : join(env.cwd, 'native', 'build', 'cliparla-paste')
}

/** Throws when the helper is missing or exits non-zero, so the caller copies the text instead. */
export async function pasteWithHelper(env: HelperEnv = defaultEnv()): Promise<void> {
  const file = pasteHelperPath(env)
  if (!env.exists(file)) {
    log.error('Paste helper not found', new Error(file))
    throw new Error(`Paste helper not found: ${file}`)
  }
  try {
    await env.run(file, ['--paste-for', String(process.pid)])
  } catch (error) {
    if ((error as { code?: unknown }).code === EXIT_SECURE_INPUT) throw new PasteSecureInputError()
    if ((error as { code?: unknown }).code === EXIT_NOT_TRUSTED) throw new PasteNotTrustedError()
    throw error
  }
}

/** Read-only probe: no activation, permission prompt, or keyboard events. */
export async function hasExternalPasteTarget(env: HelperEnv = defaultEnv()): Promise<boolean> {
  const file = pasteHelperPath(env)
  if (!env.exists(file)) throw new Error(`Paste helper not found: ${file}`)
  try {
    await env.run(file, ['--check-focus', String(process.pid)])
    return true
  } catch (error) {
    if ((error as { code?: unknown }).code === EXIT_NO_PASTE_TARGET) return false
    if (timedOut(error)) {
      log.warn('Focus probe timed out, assuming an external target')
      return true
    }
    throw error
  }
}

/** Throws when the helper fails (Secure Input, no Accessibility, no target), so the caller keeps the text on the clipboard. */
export async function pasteOnMac(): Promise<void> {
  try {
    await pasteWithHelper()
    log.info('Paste keystroke sent', { method: 'cgevent-helper' })
  } catch (error) {
    log.warn('CGEvent paste failed, keeping text on clipboard', {
      method: 'cgevent-helper',
      fallback: 'copy',
      message: String(error)
    })
    throw error
  }
}
