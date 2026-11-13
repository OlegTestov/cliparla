/** Batch 3 item 2: hold-to-talk on the dictation hotkey (H1 to H4). */

import './helpers/electron-stub'
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resetRecorded, shortcuts } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createHoldToTalk, HOLD_MS } = require('../src/main/services/dictation/hold-to-talk')
const { createKeyHelper, keyHelperPath } = require('../src/main/services/key-helper')
const {
  parseKeyHelperLine,
  createLineSplitter,
  KEY_HELPER_EXIT
} = require('../src/shared/key-helper-protocol')
const {
  acceleratorToKeyTarget,
  MOD_COMMAND,
  MOD_SHIFT,
  MOD_OPTION,
  MOD_CONTROL
} = require('../src/shared/accelerator-keycode')
const { hotkeyManager } = require('../src/main/core/hotkey-manager')
const { initializeHotkeys } = require('../src/main/core/app-bootstrap')
const windowManager = require('../src/main/core/window-manager')
const store = require('../src/main/services/store')

type State = 'idle' | 'listening' | 'processing'

function rig(holdMs?: number) {
  const clock = { t: 1000 }
  const log: string[] = []
  let state: State = 'idle'
  const machine = createHoldToTalk({
    now: () => clock.t,
    isIdle: () => state === 'idle',
    isListening: () => state === 'listening',
    toggle: () => {
      state = state === 'idle' ? 'listening' : state === 'listening' ? 'processing' : state
      log.push(`toggle->${state}`)
    },
    stop: () => {
      state = 'processing'
      log.push('stop')
    },
    ...(holdMs ? { holdMs } : {})
  })
  return {
    machine,
    log,
    clock,
    state: () => state,
    end: () => void (state = 'idle'),
    startElsewhere: () => void (state = 'listening')
  }
}

describe('H1: the tap / hold state machine', () => {
  it('a tap keeps the toggle: release before 300 ms changes nothing, the next press stops', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 120
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
    r.clock.t += 5000
    r.machine.press()
    assert.equal(r.state(), 'processing')
    r.machine.keyUp() // the release of the stopping press
    assert.deepEqual(r.log, ['toggle->listening', 'toggle->processing'])
  })

  it('a hold is push-to-talk: the release stops once', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 2000
    r.machine.keyUp()
    r.machine.keyUp() // a second release changes nothing
    assert.deepEqual(r.log, ['toggle->listening', 'stop'])
  })

  it('299 ms is a tap and 300 ms is a hold', () => {
    const tap = rig()
    tap.machine.setHelperReady(true)
    tap.machine.press()
    tap.clock.t += HOLD_MS - 1
    tap.machine.keyUp()
    assert.equal(tap.state(), 'listening')
    const hold = rig()
    hold.machine.setHelperReady(true)
    hold.machine.press()
    hold.machine.keyDown()
    hold.clock.t += HOLD_MS
    hold.machine.keyUp()
    assert.equal(hold.state(), 'processing')
  })

  it('repeated key-down while held is ignored', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    for (let i = 0; i < 20; i++) r.machine.keyDown()
    r.clock.t += 800
    r.machine.keyUp()
    assert.deepEqual(r.log, ['toggle->listening', 'stop'])
  })

  it('a release after the dictation ended meanwhile (Esc) stops nothing', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.clock.t += 1000
    r.end() // Esc or the time limit
    r.machine.keyUp()
    assert.deepEqual(r.log, ['toggle->listening'])
  })

  it('a release is used once: a late stray one does not end a newer recording', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 900
    r.machine.keyUp() // the hold: stops
    assert.equal(r.state(), 'processing')
    r.end()
    r.startElsewhere() // a dictation from the tray menu
    r.machine.keyDown() // a fresh down must not revive the used press
    r.clock.t += 900
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
  })

  it('a press that stops a recording is never timed as a hold', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 50
    r.machine.keyUp()
    r.machine.press() // second tap stops
    r.machine.keyDown()
    r.end()
    r.startElsewhere()
    r.clock.t += 5000
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
  })

  it('a release with no down after the press is stray and stops nothing', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press() // no down arrived
    r.clock.t += 2000
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
  })

  it('the down of an earlier press does not vouch for a later release (lost release, then a stray one)', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown() // its release is lost
    r.clock.t += 9000
    r.end() // Esc
    r.machine.press() // started again; this press's down was missed
    r.clock.t += 2000
    r.machine.keyUp() // the stray release of a plain key
    assert.equal(r.state(), 'listening')
  })

  it('the down may come just before the press (either report can arrive first)', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.keyDown()
    r.clock.t += 20
    r.machine.press()
    r.clock.t += 700
    r.machine.keyUp()
    assert.equal(r.state(), 'processing')
  })

  it('a used down cannot vouch for a press made right after it', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 900
    r.machine.keyUp() // used: stops
    r.end()
    r.clock.t += 20
    r.machine.press() // new recording, its own down never arrived
    r.clock.t += 900
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
  })

  it('a lost release never blocks the next press', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press() // release lost (secure input)
    r.clock.t += 9000
    r.machine.press() // the user presses again to stop
    assert.equal(r.state(), 'processing')
    r.end()
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 600
    r.machine.keyUp()
    assert.equal(r.state(), 'processing', 'push-to-talk still works afterwards')
  })

  it('a press while the dictation is processing does nothing, as before', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.press()
    r.machine.press()
    assert.equal(r.state(), 'processing')
    assert.deepEqual(r.log.length, 3)
  })
})

describe('H2: without a working helper the hotkey is a plain toggle', () => {
  it('a long press never stops the recording when the helper is not ready', () => {
    const r = rig()
    r.machine.press()
    r.clock.t += 5000
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
    r.machine.press()
    assert.equal(r.state(), 'processing')
  })

  function fakeEnv(opts: { exists?: boolean; platform?: string } = {}) {
    const spawned: Array<{
      file: string
      args: string[]
      exit: (code: number | null) => void
      out: (s: string) => void
      killed: number
    }> = []
    const env = {
      platform: opts.platform ?? 'darwin',
      packaged: false,
      resourcesPath: '/res',
      cwd: '/work',
      exists: () => opts.exists ?? true,
      spawn: (file: string, args: string[]) => {
        let onExit: (code: number | null) => void = () => undefined
        let onOut: (chunk: string) => void = () => undefined
        const entry = {
          file,
          args,
          killed: 0,
          exit: (code: number | null) => onExit(code),
          out: (s: string) => onOut(s)
        }
        spawned.push(entry)
        return {
          onOutput: (l: (chunk: string) => void) => void (onOut = l),
          onExit: (l: (code: number | null) => void) => void (onExit = l),
          kill: () => void entry.killed++
        }
      }
    }
    return { env, spawned }
  }

  it('"no permission" (exit 2) ends hold-to-talk quietly and is tried again after the app wakes up', () => {
    const { env, spawned } = fakeEnv()
    const events: string[] = []
    const helper = createKeyHelper({ onEvent: (e: string) => void events.push(e) }, env)
    helper.watch('CommandOrControl+Shift+D')
    spawned[0].out('ready\n')
    spawned[0].exit(KEY_HELPER_EXIT.noPermission)
    assert.deepEqual(events, ['ready', 'gone'])
    helper.retryIfNoPermission()
    assert.equal(spawned.length, 2, 'a second try once Accessibility may be granted')
    spawned[1].exit(KEY_HELPER_EXIT.tapFailed)
    helper.retryIfNoPermission()
    assert.equal(spawned.length, 2, 'a tap the system refused is not retried in a loop')
  })

  it('does not start without the helper file, off macOS, or for a key it cannot map', () => {
    for (const [opts, accelerator] of [
      [{ exists: false }, 'CommandOrControl+Shift+D'],
      [{ platform: 'win32' }, 'CommandOrControl+Shift+D'],
      [{}, 'CommandOrControl+Shift+Ç']
    ] as const) {
      const { env, spawned } = fakeEnv(opts)
      const events: string[] = []
      createKeyHelper({ onEvent: (e: string) => void events.push(e) }, env).watch(accelerator)
      assert.equal(spawned.length, 0)
      assert.deepEqual(events, [])
    }
  })

  it('passes the key code and modifiers, restarts for a new shortcut and stops on quit', () => {
    const { env, spawned } = fakeEnv()
    const events: string[] = []
    const helper = createKeyHelper({ onEvent: (e: string) => void events.push(e) }, env)
    helper.watch('CommandOrControl+Shift+D')
    assert.deepEqual(spawned[0].args, ['2', String(MOD_COMMAND | MOD_SHIFT)])
    assert.equal(spawned[0].file, '/work/native/build/cliparla-keys')
    helper.watch('CommandOrControl+Shift+D')
    assert.equal(spawned.length, 1, 'the same shortcut keeps the running helper')
    helper.watch('Alt+Shift+K')
    assert.equal(spawned.length, 2)
    assert.equal(spawned[0].killed, 1)
    assert.deepEqual(events, ['gone'])
    helper.stop()
    assert.equal(spawned[1].killed, 1)
    helper.watch(null)
    assert.equal(spawned.length, 2)
  })

  it('the packaged helper sits next to the paste helper', () => {
    assert.equal(
      keyHelperPath({ packaged: true, resourcesPath: '/App/Resources', cwd: '/x' }),
      '/App/Resources/bin/cliparla-keys'
    )
  })
})

describe('H3: the helper protocol', () => {
  it('reads ready, down and up lines and ignores anything else', () => {
    assert.equal(parseKeyHelperLine('ready'), 'ready')
    assert.equal(parseKeyHelperLine('down\r'), 'down')
    assert.equal(parseKeyHelperLine(' up '), 'up')
    for (const noise of ['', 'dow', 'DOWN', 'down up', 'error: x', '{"k":1}']) {
      assert.equal(parseKeyHelperLine(noise), null, noise)
    }
  })

  it('lines split across chunks and several lines in one chunk', () => {
    const seen: string[] = []
    const feed = createLineSplitter((line: string) => void seen.push(line))
    feed('do')
    feed('wn\nu')
    feed('p\nready\ndown\n')
    assert.deepEqual(seen, ['down', 'up', 'ready', 'down'])
  })

  it('a runaway line without a newline is dropped, not kept forever', () => {
    const seen: string[] = []
    const feed = createLineSplitter((line: string) => void seen.push(line))
    feed('x'.repeat(1000))
    feed('up\n')
    assert.deepEqual(seen, ['up'])
  })

  it('events reach the machine through the manager in order', () => {
    const { env, spawned } = (() => {
      const spawned: Array<{ out: (s: string) => void }> = []
      return {
        spawned,
        env: {
          platform: 'darwin',
          packaged: false,
          resourcesPath: '',
          cwd: '/w',
          exists: () => true,
          spawn: () => {
            const entry = { out: (_s: string) => undefined }
            spawned.push(entry)
            return {
              onOutput: (l: (c: string) => void) => void (entry.out = l),
              onExit: () => undefined,
              kill: () => undefined
            }
          }
        }
      }
    })()
    const seen: string[] = []
    createKeyHelper({ onEvent: (e: string) => void seen.push(e) }, env).watch('Control+Alt+9')
    spawned[0].out('ready\ndown\nu')
    spawned[0].out('p\ngarbage\n')
    assert.deepEqual(seen, ['ready', 'down', 'up'])
  })

  it('maps accelerators to macOS key codes and modifier bits', () => {
    assert.deepEqual(acceleratorToKeyTarget('CommandOrControl+Shift+D'), {
      keyCode: 2,
      modifiers: MOD_COMMAND | MOD_SHIFT
    })
    assert.deepEqual(acceleratorToKeyTarget('Control+Alt+V'), {
      keyCode: 9,
      modifiers: MOD_CONTROL | MOD_OPTION
    })
    assert.deepEqual(acceleratorToKeyTarget('Cmd+F5'), { keyCode: 96, modifiers: MOD_COMMAND })
    assert.deepEqual(acceleratorToKeyTarget('Command+Space'), {
      keyCode: 49,
      modifiers: MOD_COMMAND
    })
    assert.equal(acceleratorToKeyTarget('Cmd+Ç'), null)
    assert.equal(acceleratorToKeyTarget('AltGr+D'), null)
    assert.equal(acceleratorToKeyTarget(''), null)
  })
})

describe('H4: a killed helper leaves the toggle working', () => {
  it('the helper ends during a hold: no stop on release, the next press stops', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.press()
    r.clock.t += 1500
    r.machine.setHelperReady(false) // killed
    r.machine.keyUp()
    assert.equal(r.state(), 'listening')
    r.machine.press()
    assert.equal(r.state(), 'processing')
  })

  it('a helper that comes back (new shortcut, new grant) works again', () => {
    const r = rig()
    r.machine.setHelperReady(true)
    r.machine.setHelperReady(false)
    r.machine.setHelperReady(true)
    r.machine.press()
    r.machine.keyDown()
    r.clock.t += 700
    r.machine.keyUp()
    assert.equal(r.state(), 'processing')
  })
})

describe('the hotkey manager tells when a shortcut changed', () => {
  before(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.registerDefaultWindows()
    windowManager.createAll()
  })
  beforeEach(() => {
    resetRecorded()
    hotkeyManager.unregisterAll()
  })

  it('on mode change, on a new shortcut and when everything is released', () => {
    store.setDictationShortcut('CommandOrControl+Shift+D')
    initializeHotkeys()
    let calls = 0
    hotkeyManager.onChange(() => void calls++)
    hotkeyManager.setMode('normal')
    assert.equal(calls, 1)
    assert.equal(hotkeyManager.updateAccelerator('dictation', 'CommandOrControl+Shift+K'), 'ok')
    assert.equal(calls, 2)
    hotkeyManager.unregisterAll()
    assert.equal(calls, 3)
    assert.ok(shortcuts.registered.size === 0)
  })
})

describe('the native helper', () => {
  const source = readFileSync('native/key-helper/main.swift', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  it('uses an active tap that passes events through and needs only Accessibility', () => {
    assert.match(source, /options: \.defaultTap/)
    assert.doesNotMatch(source, /listenOnly/)
    assert.doesNotMatch(source, /CGRequestListenEventAccess|CGPreflightListenEventAccess/)
    assert.match(source, /AXIsProcessTrusted\(\)/)
    assert.match(source, /passUnretained\(event\)/)
    assert.doesNotMatch(source, /return nil/)
  })

  it('prints down for every matching key-down, not only the first after a release', () => {
    const down = source.slice(source.indexOf('case .keyDown'), source.indexOf('case .keyUp'))
    assert.doesNotMatch(down, /!held/)
  })

  it('re-enables the tap after a timeout, never blocks on output and leaves with Cliparla', () => {
    assert.match(source, /tapDisabledByTimeout/)
    assert.match(source, /O_NONBLOCK/)
    assert.match(source, /standardInput/)
    assert.match(source, /exit\(0\)/)
  })

  it('exit codes match the protocol', () => {
    assert.match(source, /Accessibility permission is not granted", 2/)
    assert.match(source, /Could not create the event tap", 3/)
    assert.equal(KEY_HELPER_EXIT.noPermission, 2)
    assert.equal(KEY_HELPER_EXIT.tapFailed, 3)
  })

  it('is built, shipped next to the paste helper and signed', () => {
    assert.ok(existsSync('native/key-helper/main.swift'))
    assert.ok(pkg.build.mac.binaries.includes('Contents/Resources/bin/cliparla-keys'))
    assert.ok(pkg.build.mac.binaries.includes('Contents/Resources/bin/cliparla-paste'))
    assert.match(
      readFileSync('tools/build-paste-helper.sh', 'utf8'),
      /build_helper cliparla-keys native\/key-helper\/main\.swift/
    )
  })

  it('the build script checks each step and warns when the key helper fails', () => {
    const script = readFileSync('tools/build-paste-helper.sh', 'utf8')
    assert.match(script, /swiftc [^\n]*\|\| return 1/)
    assert.match(script, /lipo [^\n]*\|\| return 1/)
    assert.match(script, /if ! build_helper cliparla-keys/)
    assert.match(script, /WARNING: key helper not built/)
  })

  it('asks for no new permission text or entitlement', () => {
    assert.equal(pkg.build.mac.extendInfo.NSInputMonitoringUsageDescription, undefined)
    assert.doesNotMatch(readFileSync('build/entitlements.mac.plist', 'utf8'), /input-monitoring/)
  })
})
