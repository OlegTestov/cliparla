/**
 * Real paste into a real second app. Nothing is stubbed on the paste path: the real `pasteText`,
 * the real CGEvent helper `native/build/cliparla-paste`,
 * the real macOS clipboard (through pbcopy/pbpaste) and a real TextEdit document that is read back.
 * Earlier E2E runs stubbed the paste and missed a total paste failure; this test is the one that cannot.
 *
 * NOT part of `npm test`. It takes the keyboard focus, uses the clipboard and opens TextEdit, so run it
 * only on a Mac nobody is using (live screen lock), from a terminal that already has Accessibility
 * permission (the osascript calls below only drive TextEdit and read it back, they are not the paste path):
 *
 *   npm run build:native
 *   CLIPARLA_REAL_PASTE=1 npm run test:live -- --test-name-pattern "real paste"
 *   CLIPARLA_REAL_PASTE=1 CLIPARLA_REAL_PASTE_RUNS=20 ...      (N1: number of pastes in a row, default 20)
 *
 * Without CLIPARLA_REAL_PASTE every test is skipped and nothing on the machine is touched.
 */

import '../helpers/electron-stub'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

/* eslint-disable @typescript-eslint/no-require-imports */
const { pasteText } = require('../../src/main/services/keyboard-simulator')
const { pasteWithHelper } = require('../../src/main/services/mac-paste-helper')

// The electron stub wraps execFile and drops its promisify form, so the promise is built by hand.
const run = (
  file: string,
  args: string[],
  options: { timeout: number }
): Promise<{ stdout: string }> =>
  new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) =>
      error ? reject(error) : resolve({ stdout: String(stdout) })
    )
  })
const enabled = process.env.CLIPARLA_REAL_PASTE === '1' && process.platform === 'darwin'
const skip = enabled ? false : 'set CLIPARLA_REAL_PASTE=1 on a free Mac to run the real paste test'
const RUNS = Number(process.env.CLIPARLA_REAL_PASTE_RUNS ?? 20)
const HELPER = join(__dirname, '../../native/build/cliparla-paste')

const osa = async (script: string): Promise<string> =>
  (await run('/usr/bin/osascript', ['-e', script], { timeout: 10_000 })).stdout.trim()
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

/** The real macOS clipboard, plain text only (what F6 "text" restores). */
const readBoard = (): string => execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' })
const writeBoard = (text: string): void => {
  execFileSync('/usr/bin/pbcopy', { input: text })
}
class Item {
  readonly types: readonly string[]
  constructor(private readonly data: Record<string, string | Blob>) {
    this.types = Object.keys(data)
  }
  async getType(type: string): Promise<unknown> {
    return this.data[type]
  }
}
const board = {
  async read() {
    const text = readBoard()
    return text ? [new Item({ 'text/plain': new Blob([text]) })] : []
  },
  async write(items: Item[]) {
    const first = items[0]
    const value = first ? await first.getType('text/plain') : ''
    writeBoard(value instanceof Blob ? await value.text() : String(value ?? ''))
  },
  async writeText(text: string) {
    writeBoard(text)
  },
  clear() {
    writeBoard('')
  }
}
const io = { clipboard: board, Item, sleep }

describe('real paste into TextEdit', { skip }, () => {
  let textEditWasRunning = false

  const frontApp = (): Promise<string> =>
    osa(
      'tell application "System Events" to name of first application process whose frontmost is true'
    )
  const documentText = (): Promise<string> =>
    osa('tell application "TextEdit" to get text of front document')

  /** A fresh empty document, TextEdit in front with the cursor in it. */
  async function freshDocument(): Promise<void> {
    await osa('tell application "TextEdit" to activate')
    await osa('tell application "TextEdit" to make new document')
    for (let i = 0; i < 40 && (await frontApp()) !== 'TextEdit'; i++) await sleep(100)
    assert.equal(await frontApp(), 'TextEdit', 'TextEdit did not come to the front')
    await sleep(300)
    assert.equal(await documentText(), '', 'the new document is not empty')
  }

  const closeDocument = (): Promise<string> =>
    osa('tell application "TextEdit" to close front document saving no').catch(() => '')

  before(() => {
    assert.ok(
      existsSync(HELPER),
      'run `npm run build:native` first: native/build/cliparla-paste is missing'
    )
    try {
      execFileSync('/usr/bin/pgrep', ['-x', 'TextEdit'])
      textEditWasRunning = true
    } catch {
      textEditWasRunning = false
    }
  })

  after(async () => {
    await closeDocument()
    if (!textEditWasRunning) await osa('tell application "TextEdit" to quit').catch(() => '')
  })

  it('one paste: the text appears once in the other app and the clipboard comes back', async () => {
    await freshDocument()
    const before = `before-${randomUUID()}`
    const token = `cliparla-paste-${randomUUID()}`
    writeBoard(before)
    await pasteText(token, io)
    await sleep(500)
    assert.equal(await documentText(), token, 'the dictated text did not arrive exactly once')
    assert.equal(readBoard(), before, 'the clipboard was not restored')
    await closeDocument()
  })

  it(`N1: ${RUNS} pastes in a row, each exactly once, the clipboard restored every time`, async () => {
    await freshDocument()
    const before = `before-${randomUUID()}`
    writeBoard(before)
    const tokens: string[] = []
    for (let i = 0; i < RUNS; i++) {
      const token = `[${i}:${randomUUID().slice(0, 8)}]`
      tokens.push(token)
      await pasteText(token, io)
      await sleep(250)
      assert.equal(sha(readBoard()), sha(before), `clipboard not restored after paste ${i}`)
    }
    assert.equal(await documentText(), tokens.join(''), 'pasted text differs from what was sent')
    await closeDocument()
  })

  it('the CGEvent helper alone also pastes', async () => {
    await freshDocument()
    const token = `cliparla-helper-${randomUUID()}`
    writeBoard(token)
    await pasteWithHelper()
    await sleep(500)
    assert.equal(await documentText(), token)
    await closeDocument()
  })

  it('with Cliparla not in front the focus probe sees TextEdit as a target', async () => {
    await freshDocument()
    const { hasExternalPasteTarget } = require('../../src/main/services/mac-paste-helper')
    assert.equal(await hasExternalPasteTarget(), true)
    await closeDocument()
  })
})
