import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { FakeBrowserWindow, notifications, resetRecorded } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { pasteText, pasteTargetReady } = require('../src/main/services/keyboard-simulator')
const { deliverText } = require('../src/main/services/paste-delivery')
const { pasteLastResult } = require('../src/main/services/paste-last')
const { setLastResult } = require('../src/main/services/last-result')
const {
  pasteWithHelper,
  hasExternalPasteTarget,
  PasteSecureInputError
} = require('../src/main/services/mac-paste-helper')

class Item {
  constructor(readonly data: Record<string, string | Blob>) {}
  get types() {
    return Object.keys(this.data)
  }
  async getType(type: string) {
    return this.data[type]
  }
}

function fixture() {
  let now = 0
  let items = [new Item({ 'text/plain': 'OLD' })]
  const writes: string[] = []
  const board = {
    read: async () => items,
    write: async (next: Item[]) => {
      writes.push('restore')
      items = next
    },
    writeText: (text: string) => {
      writes.push(text)
      items = [new Item({ 'text/plain': text })]
    }
  }
  const sleeps: number[] = []
  return {
    board,
    writes,
    sleeps,
    text: async () => items[0].getType('text/plain'),
    io: {
      clipboard: board,
      Item,
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        now += ms
      },
      targetReady: () => true
    }
  }
}

const helperEnv = (code?: number) => ({
  packaged: true,
  resourcesPath: '/fake/Resources',
  cwd: '/fake',
  exists: () => true,
  run: async () => {
    if (code !== undefined) throw Object.assign(new Error('helper failed'), { code })
  }
})

describe('paste focus handoff', () => {
  it('F1 waits in 25 ms steps until the target is ready, then posts', async (t) => {
    const logged = t.mock.method(console, 'log', () => {})
    const f = fixture()
    let checks = 0
    let postedAt = -1
    await pasteText('NEW', {
      ...f.io,
      targetReady: () => ++checks === 4,
      simulate: async () => void (postedAt = f.io.now())
    })
    assert.equal(checks, 4)
    assert.equal(postedAt, 85) // 10 ms clipboard update + 75 ms focus handoff
    assert.deepEqual(f.sleeps.slice(1, 4), [25, 25, 25])
    assert.ok(
      logged.mock.calls.some(
        ({ arguments: args }) => args[1]?.waitedMs === 75 && args[1]?.outcome === 'external-target'
      )
    )
  })

  it('F1 stays active for 400 ms: copies and notifies without posting', async (t) => {
    const logged = t.mock.method(console, 'warn', () => {})
    const f = fixture()
    let posts = 0
    const notices: unknown[] = []
    await deliverText('NEW', {
      isTrusted: () => true,
      paste: (text: string) =>
        pasteText(text, {
          ...f.io,
          targetReady: () => false,
          simulate: async () => void posts++
        }),
      copy: f.board.writeText,
      notify: (notice: unknown) => notices.push(notice)
    })
    assert.equal(posts, 0)
    assert.equal(f.io.now(), 410)
    assert.equal(await f.text(), 'NEW')
    assert.deepEqual(notices, [{ indicator: true, reason: 'paste-failed' }])
    assert.ok(
      logged.mock.calls.some(
        ({ arguments: args }) =>
          args[1]?.waitedMs === 400 && args[1]?.outcome === 'copied-no-target'
      )
    )
  })

  it('F1 counts probe time of later probes toward the 400 ms deadline', async () => {
    const f = fixture()
    let probes = 0
    await assert.rejects(
      pasteText('NEW', {
        ...f.io,
        targetReady: async () => {
          if (++probes === 1) return false // the cold first probe is not counted (below)
          await f.io.sleep(400)
          return false
        },
        simulate: async () => assert.fail('must not post')
      }),
      /target/i
    )
  })

  it('a cold first probe (the helper starts slowly) does not use up the 400 ms', async () => {
    const f = fixture()
    let posted = false
    await pasteText('NEW', {
      ...f.io,
      targetReady: async () => {
        await f.io.sleep(2300) // measured: first run of the signed helper took 2231 ms
        return true
      },
      simulate: async () => void (posted = true)
    })
    assert.equal(posted, true)
  })

  it('a slow first probe that says "no target" still gets the full 400 ms of retries', async () => {
    const f = fixture()
    let probes = 0
    let posted = false
    await pasteText('NEW', {
      ...f.io,
      targetReady: async () => {
        if (++probes === 1) {
          await f.io.sleep(2300)
          return false
        }
        return probes === 5
      },
      simulate: async () => void (posted = true)
    })
    assert.equal(posted, true)
  })

  it('F1 checks after waiting for the previous queued paste', async () => {
    const f = fixture()
    let ready = true
    let posts = 0
    const io = {
      ...f.io,
      targetReady: () => ready,
      simulate: async () => {
        posts++
        ready = false
      }
    }
    const first = pasteText('FIRST', io)
    const second = pasteText('SECOND', io)
    await first
    await assert.rejects(second, /target/i)
    assert.equal(posts, 1)
  })

  it('F1 rejects a focused panel and an active app without a focused BrowserWindow', async () => {
    const original = FakeBrowserWindow.getFocusedWindow
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      FakeBrowserWindow.getFocusedWindow = () => ({})
      assert.equal(await pasteTargetReady(async () => true), false)
      FakeBrowserWindow.getFocusedWindow = () => null
      assert.equal(await pasteTargetReady(async () => false), false)
      assert.equal(await pasteTargetReady(async () => true), true)
    } finally {
      FakeBrowserWindow.getFocusedWindow = original
      Object.defineProperty(process, 'platform', { value: platform })
    }
  })

  it('F1 probes the frontmost app without posting, treating no frontmost app as unsafe', async () => {
    const calls: string[][] = []
    assert.equal(
      await hasExternalPasteTarget({
        ...helperEnv(),
        run: async (_file: string, args: string[]) => void calls.push(args)
      }),
      true
    )
    assert.deepEqual(calls, [['--check-focus', String(process.pid)]])
    assert.equal(await hasExternalPasteTarget(helperEnv(4)), false)
    await assert.rejects(hasExternalPasteTarget(helperEnv(3)))
  })

  it('H4 dictation delivery also falls back when an own window retains focus', async () => {
    const f = fixture()
    await deliverText('DICTATED', {
      isTrusted: () => true,
      paste: (text: string) =>
        pasteText(text, {
          ...f.io,
          targetReady: () => false,
          simulate: async () => assert.fail('must not paste into Cliparla')
        }),
      copy: f.board.writeText,
      notify: () => {}
    })
    assert.equal(await f.text(), 'DICTATED')
  })
})

describe('native paste contract (never runs the helper)', () => {
  const source = readFileSync('native/paste-helper/main.swift', 'utf8')

  it('F3 isolates synthetic Command+V from held physical Control', () => {
    assert.match(source, /CGEventSource\(stateID: \.privateState\)/)
    assert.doesNotMatch(source, /CGEventSource\(stateID: \.combinedSessionState\)/)
    assert.match(source, /down.flags = commandFlags/)
    assert.match(source, /up.flags = commandFlags/)
    assert.match(source, /commandFlags: CGEventFlags = \[\.maskCommand,/)
  })

  it('F4 checks Secure Input before trust and event creation, with a distinct exit', () => {
    assert.match(source, /guard !IsSecureEventInputEnabled\(\) else \{[\s\S]*?exit\(5\)/)
    assert.ok(
      source.indexOf('IsSecureEventInputEnabled()') < source.indexOf('AXIsProcessTrusted()')
    )
    assert.ok(source.indexOf('IsSecureEventInputEnabled()') < source.indexOf('CGEventSource('))
  })
})

describe('Secure Input fallback', () => {
  it('F4 helper exit 5 has a distinct error', async () => {
    assert.equal(typeof PasteSecureInputError, 'function')
    await assert.rejects(pasteWithHelper(helperEnv(5)), PasteSecureInputError)
  })

  for (const entry of ['dictation', 'paste-last']) {
    it(`F4 ${entry}: keeps text, never restores, and gives the Secure Input reason`, async () => {
      const f = fixture()
      const notices: unknown[] = []
      const deps = {
        isTrusted: () => true,
        paste: (text: string) =>
          pasteText(text, { ...f.io, simulate: () => pasteWithHelper(helperEnv(5)) }),
        copy: f.board.writeText,
        notify: (notice: unknown) => notices.push(notice),
        prompt: () => assert.fail('must not prompt'),
        watchGrant: () => assert.fail('must not watch permission')
      }
      if (entry === 'paste-last') {
        setLastResult('NEW')
        await pasteLastResult({ ...deps, ownWindowFocused: () => false })
      } else await deliverText('NEW', deps)
      assert.equal(await f.text(), 'NEW')
      assert.ok(!f.writes.includes('restore'))
      assert.deepEqual(notices, [{ indicator: true, reason: 'secure-input' }])
    })
  }

  it('F4 shows the exact English notice and supplies a translation in every locale', async () => {
    resetRecorded()
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      await deliverText('NEW', {
        isTrusted: () => true,
        paste: () => pasteWithHelper(helperEnv(5)),
        copy: () => {},
        indicatorAllowed: () => false
      })
    } finally {
      Object.defineProperty(process, 'platform', { value: original })
    }
    const expected =
      'Secure input is on in another app, so Cliparla could not paste. The text is on the clipboard: press Cmd+V.'
    assert.equal(notifications[0].body, expected)
    const dir = 'src/renderer/src/i18n/locales'
    const files = readdirSync(dir).filter((file) => file.endsWith('.json'))
    assert.equal(files.length, 16)
    for (const file of files) {
      const message = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))[
        'accessibility.copiedSecureInput'
      ]
      assert.ok(message, file)
      if (file !== 'en.json') assert.notEqual(message, expected, file)
    }
  })
})

describe('clipboard restore ownership and timing', () => {
  it('F5 a slow reader still sees the new text at 299 ms after posting', async () => {
    const f = fixture()
    let postedAt = 0
    const sleep = async (ms: number) => {
      if (postedAt) {
        assert.equal(await f.text(), 'NEW')
        assert.ok(ms >= 300)
        await f.io.sleep(299)
        assert.equal(await f.text(), 'NEW')
        await f.io.sleep(ms - 299)
      } else await f.io.sleep(ms)
    }
    await pasteText('NEW', {
      ...f.io,
      sleep,
      simulate: async () => void (postedAt = f.io.now())
    })
    assert.ok(f.io.now() - postedAt >= 300)
    assert.equal(await f.text(), 'OLD')
  })

  it('F5 preserves something the user copied during the paste', async () => {
    const f = fixture()
    await pasteText('NEW', {
      ...f.io,
      simulate: async () => f.board.writeText('USER COPY')
    })
    assert.equal(await f.text(), 'USER COPY')
  })

  it('F5 handles Blob text from the async clipboard API', async () => {
    const f = fixture()
    await pasteText('NEW', {
      ...f.io,
      simulate: async () => {
        await f.board.write([new Item({ 'text/plain': new Blob(['NEW']) })])
      }
    })
    assert.equal(await f.text(), 'OLD')
  })
})
