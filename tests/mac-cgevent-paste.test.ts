import './helpers/electron-stub'
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* eslint-disable @typescript-eslint/no-require-imports */
// Intercept execFile before promisify captures it: even the default wiring cannot send real keys.
const childProcess = require('node:child_process')
const fs = require('node:fs')
const existsSync = fs.existsSync
const originalExecFile = childProcess.execFile
let onExec: (
  file: string,
  args: string[],
  options: { timeout: number }
) => Promise<void> = async () => assert.fail('unexpected subprocess')
// A fresh function also removes execFile's custom promisify hook to the real subprocess API.
childProcess.execFile = (file, args, options, callback) => {
  void Promise.resolve()
    .then(() => onExec(file, args, options))
    .then(() => callback(null, '', ''), callback)
  return {}
}
mock.method(fs, 'existsSync', (file) =>
  String(file).endsWith('/native/build/cliparla-paste') ? true : existsSync(file)
)
after(() => {
  childProcess.execFile = originalExecFile
  mock.restoreAll()
})

const {
  pasteOnMac,
  PasteSecureInputError,
  PasteNotTrustedError
} = require('../src/main/services/mac-paste-helper')
const { pasteText, simulatePaste } = require('../src/main/services/keyboard-simulator')
const { deliverText } = require('../src/main/services/paste-delivery')

class Item {
  constructor(private readonly data: Record<string, unknown>) {}
  get types() {
    return Object.keys(this.data)
  }
  async getType(type: string) {
    return this.data[type]
  }
}

function fixture() {
  const calls: string[] = []
  let items = [new Item({ 'text/plain': 'OLD' })]
  let now = 0
  const board = {
    read: async () => items,
    write: async (next: Item[]) => {
      calls.push('restore')
      items = next
    },
    writeText: (text: string) => {
      calls.push(`copy:${text}`)
      items = [new Item({ 'text/plain': text })]
    }
  }
  const io = {
    clipboard: board,
    Item,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
      calls.push(`sleep:${ms}`)
    },
    targetReady: () => {
      calls.push('focus')
      return true
    }
  }
  return { calls, board, io, text: async () => items[0].getType('text/plain') }
}

const original = process.platform
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  onExec = async () => assert.fail('unexpected subprocess')
})
afterEach(() => Object.defineProperty(process, 'platform', { value: original }))

const helperExit = (code: number) => Object.assign(new Error(`exit ${code}`), { code })

describe('CGEvent-only macOS paste (all IO faked)', () => {
  it('runs only the bundled helper, never osascript, then holds the clipboard for 300 ms', async () => {
    const f = fixture()
    const spawned: string[][] = []
    onExec = async (file, args) => {
      assert.ok(file.endsWith('/native/build/cliparla-paste'), file)
      spawned.push(args)
      f.calls.push('helper')
    }
    await pasteText('NEW', f.io)
    assert.deepEqual(spawned, [['--paste-for', String(process.pid)]])
    assert.deepEqual(f.calls, ['copy:NEW', 'sleep:10', 'focus', 'helper', 'sleep:300', 'restore'])
    assert.equal(await f.text(), 'OLD')
  })

  it('never spawns osascript, whatever the helper does', async () => {
    for (const fail of [false, true]) {
      const files: string[] = []
      onExec = async (file) => {
        files.push(file)
        if (fail) throw helperExit(3)
      }
      await pasteOnMac().catch(() => {})
      assert.ok(files.length > 0)
      assert.ok(
        files.every((file) => !/osascript/.test(file)),
        files.join()
      )
    }
  })

  it('helper failure: keeps the text on the clipboard and shows the copy notice', async () => {
    const f = fixture()
    onExec = async () => {
      throw helperExit(3)
    }
    const notices: unknown[] = []
    await deliverText('NEW', {
      isTrusted: () => true,
      paste: (text: string) => pasteText(text, f.io),
      copy: f.board.writeText,
      notify: (notice: unknown) => notices.push(notice)
    })
    assert.deepEqual(f.calls, ['copy:NEW', 'sleep:10', 'focus', 'copy:NEW'])
    assert.equal(await f.text(), 'NEW')
    assert.deepEqual(notices, [{ indicator: true, reason: 'paste-failed' }])
  })

  it('Secure Input (helper exit 5) keeps the notice', async () => {
    const f = fixture()
    onExec = async () => {
      throw helperExit(5)
    }
    await assert.rejects(pasteOnMac(), PasteSecureInputError)
    const notices: unknown[] = []
    await deliverText('NEW', {
      isTrusted: () => true,
      paste: (text: string) => pasteText(text, f.io),
      copy: f.board.writeText,
      notify: (notice: unknown) => notices.push(notice)
    })
    assert.deepEqual(notices, [{ indicator: true, reason: 'secure-input' }])
  })

  it('no Accessibility (helper exit 2) raises PasteNotTrustedError', async () => {
    onExec = async () => {
      throw helperExit(2)
    }
    await assert.rejects(pasteOnMac(), PasteNotTrustedError)
  })

  it('does not overwrite a newer clipboard copy after the paste', async () => {
    const f = fixture()
    onExec = async () => f.board.writeText('USER COPY')
    await pasteText('NEW', f.io)
    assert.equal(await f.text(), 'USER COPY')
    assert.ok(!f.calls.includes('restore'))
  })

  it('logs the method, and the failure with the copy fallback', async (t) => {
    const info = t.mock.method(console, 'log', () => {})
    const warn = t.mock.method(console, 'warn', () => {})
    onExec = async () => {}
    await pasteOnMac()
    assert.ok(
      info.mock.calls.some(
        ({ arguments: args }) =>
          String(args[0]).includes('Paste keystroke sent') && args[1]?.method === 'cgevent-helper'
      )
    )
    onExec = async () => {
      throw helperExit(3)
    }
    await assert.rejects(pasteOnMac())
    assert.ok(
      warn.mock.calls.some(
        ({ arguments: args }) =>
          args[1]?.method === 'cgevent-helper' && args[1]?.fallback === 'copy'
      )
    )
  })

  it('main.swift posts to the session tap and waits before exit (events posted right before exit are lost)', () => {
    const source = readFileSync('native/paste-helper/main.swift', 'utf8')
    assert.match(source, /down\.post\(tap: \.cgSessionEventTap\)/)
    assert.match(source, /up\.post\(tap: \.cgSessionEventTap\)/)
    assert.doesNotMatch(source, /cghidEventTap/)
    assert.match(source, /usleep\(8_000\)\s*\n\s*up\.post/)
    assert.match(
      source,
      /up\.post\(tap: \.cgSessionEventTap\)\s*\n\s*usleep\(50_000\)\s*\n\s*exit\(0\)/
    )
    assert.match(source, /\.maskCommand, CGEventFlags\(rawValue: 0x000008\)/)
  })

  it('no Automation leftovers in the shipped config or the paste source', () => {
    const files = [
      'package.json',
      'build/entitlements.mac.plist',
      'src/main/services/mac-paste-helper.ts',
      'native/paste-helper/main.swift'
    ]
    for (const file of files) {
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        /osascript|System Events|apple-events|NSAppleEvents/i,
        file
      )
    }
  })
})
