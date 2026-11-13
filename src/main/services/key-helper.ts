/**
 * Runs the signed key helper (native/key-helper) while the dictation hotkey can be watched.
 * Any problem (no Accessibility, no helper file, a crash) leaves hold-to-talk off and the hotkey a
 * plain toggle; nothing is shown to the user.
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../core/logger'
import { acceleratorToKeyTarget } from '../../shared/accelerator-keycode'
import {
  KEY_HELPER_EXIT,
  createLineSplitter,
  parseKeyHelperLine,
  type KeyHelperEvent
} from '../../shared/key-helper-protocol'

const log = createLogger('KeyHelper')

/** The part of a child process this module uses. */
export interface HelperProcess {
  onOutput: (listener: (chunk: string) => void) => void
  onExit: (listener: (code: number | null) => void) => void
  /** Closes the helper's stdin and kills it */
  kill: () => void
}

export interface KeyHelperEnv {
  platform: string
  packaged: boolean
  resourcesPath: string
  cwd: string
  exists: (path: string) => boolean
  spawn: (file: string, args: string[]) => HelperProcess
}

let blockedForTests = false

/** Test hook: the real helper is never started by a test that did not ask for it. */
export function blockRealKeyHelperForTests(): void {
  blockedForTests = true
}

const defaultEnv = (): KeyHelperEnv => ({
  platform: process.platform,
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  cwd: process.cwd(),
  exists: (path) => !blockedForTests && existsSync(path),
  spawn: (file, args) => {
    // stdin stays open on purpose: when Cliparla goes away the pipe closes and the helper exits
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    child.stdin.on('error', () => undefined)
    return {
      onOutput: (listener) => {
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', listener)
      },
      onExit: (listener) => {
        child.on('exit', (code) => listener(code))
        child.on('error', () => listener(null))
      },
      kill: () => {
        child.stdin.destroy()
        child.kill()
      }
    }
  }
})

/** Packaged: Contents/Resources/bin; dev: native/build (made by `npm run build:native`). */
export function keyHelperPath(
  env: Pick<KeyHelperEnv, 'packaged' | 'resourcesPath' | 'cwd'>
): string {
  return env.packaged
    ? join(env.resourcesPath, 'bin', 'cliparla-keys')
    : join(env.cwd, 'native', 'build', 'cliparla-keys')
}

export interface KeyHelperEvents {
  /** The helper reported an event, or null when it is gone (hold-to-talk is off) */
  onEvent: (event: KeyHelperEvent | 'gone') => void
}

export interface KeyHelper {
  /** Watch this accelerator (null: nothing to watch). Starts, restarts or stops as needed. */
  watch: (accelerator: string | null) => void
  /** Try again after a missing permission may have been granted */
  retryIfNoPermission: () => void
  stop: () => void
}

export function createKeyHelper(
  events: KeyHelperEvents,
  env: KeyHelperEnv | (() => KeyHelperEnv) = defaultEnv
): KeyHelper {
  let running: { child: HelperProcess; accelerator: string } | null = null
  let wanted: string | null = null
  let failedForPermission = false

  const resolveEnv = typeof env === 'function' ? env : () => env

  function end(child: HelperProcess): void {
    child.kill()
    if (running?.child === child) running = null
  }

  function start(accelerator: string): void {
    const environment = resolveEnv()
    const target = acceleratorToKeyTarget(accelerator)
    if (environment.platform !== 'darwin' || !target) {
      log.info('Hold-to-talk is not available for this shortcut, dictation stays a toggle', {
        accelerator
      })
      return
    }
    const file = keyHelperPath(environment)
    if (!environment.exists(file)) {
      log.warn('Key helper not found, dictation stays a toggle', { file })
      return
    }
    failedForPermission = false
    let child: HelperProcess
    try {
      child = environment.spawn(file, [String(target.keyCode), String(target.modifiers)])
    } catch (error) {
      log.error('Key helper could not start', error as Error)
      return
    }
    running = { child, accelerator }
    const feed = createLineSplitter((line) => {
      const event = parseKeyHelperLine(line)
      if (event && running?.child === child) events.onEvent(event)
    })
    child.onOutput(feed)
    child.onExit((code) => {
      const current = running?.child === child
      if (current) running = null
      if (code === KEY_HELPER_EXIT.noPermission) failedForPermission = true
      log.info('Key helper ended, dictation stays a toggle', { code, replaced: !current })
      if (current) events.onEvent('gone')
    })
  }

  return {
    watch(accelerator) {
      wanted = accelerator
      if (running && running.accelerator === accelerator) return
      if (running) {
        const old = running.child
        running = null
        end(old)
        events.onEvent('gone')
      }
      if (accelerator) start(accelerator)
    },

    retryIfNoPermission() {
      if (running || !failedForPermission || !wanted) return
      start(wanted)
    },

    stop() {
      wanted = null
      if (running) end(running.child)
      running = null
    }
  }
}
