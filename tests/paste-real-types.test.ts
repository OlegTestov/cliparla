/**
 * Electron on macOS reports plain text as three types, two of them pseudo-types
 * (measured in the built app, Electron 45.1). The clipboard must still be restored after a paste.
 * The clipboard fake has only the methods Electron 45 has (tests/helpers/fake-clipboard.ts).
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fakeClipboard, FakeItem, type Data } from './helpers/fake-clipboard'

/* eslint-disable @typescript-eslint/no-require-imports */
const { pasteText } = require('../src/main/services/keyboard-simulator')

const realShape = (text: string): Data => ({
  'electron application/findtext': text,
  'electron application/osclipboard;format="NSStringPboardType"': text,
  'text/plain': text
})
const io = {
  Item: FakeItem,
  simulate: async () => {},
  targetReady: async () => true,
  sleep: async () => {}
}
const textOf = async (data: Data): Promise<string> =>
  (await new FakeItem(data).getType('text/plain')).text()

describe('clipboard restore after a paste', () => {
  it('restores the user clipboard when the types are the ones a real Mac reports', async () => {
    const c = fakeClipboard(realShape('USER COPY'), realShape)
    await pasteText('DICTATED', { clipboard: c.board, ...io })
    assert.equal(await textOf(c.current), 'USER COPY')
    assert.deepEqual(c.log, ['writeText', 'write'])
  })

  it('does not restore over something the user copied meanwhile (a second real MIME type)', async () => {
    const c = fakeClipboard(realShape('USER COPY'), realShape)
    const simulate = async (): Promise<void> => {
      c.current = { ...realShape('DICTATED'), 'image/png': 'x' }
    }
    await pasteText('DICTATED', { clipboard: c.board, ...io, simulate })
    assert.deepEqual(c.log, ['writeText'])
  })

  it('does not restore when the plain text changed meanwhile', async () => {
    const c = fakeClipboard(realShape('USER COPY'), realShape)
    const simulate = async (): Promise<void> => {
      c.current = realShape('SOMETHING NEW')
    }
    await pasteText('DICTATED', { clipboard: c.board, ...io, simulate })
    assert.deepEqual(c.log, ['writeText'])
  })
})

/** Formats only the source app understands (Figma, Excel): listed as osclipboard pseudo-types. */
describe('clipboard with private formats', () => {
  const pseudo = (name: string): string => `electron application/osclipboard;format="${name}"`
  const A = 'com.example.private-design'
  const B = 'com.example.other'
  const blob = (...bytes: number[]) => new Blob([new Uint8Array(bytes)])
  const privateOnly = (): Data => ({
    'electron application/findtext': '',
    [pseudo(A)]: blob(1, 2, 3, 250)
  })
  const ioOf = (c: ReturnType<typeof fakeClipboard>) => ({
    clipboard: c.board,
    ...io,
    Item: FakeItem
  })
  const bytesOf = async (c: ReturnType<typeof fakeClipboard>, type: string) =>
    new Uint8Array(await (await new FakeItem(c.current).getType(type)).arrayBuffer())

  it('a clipboard holding only a private format gets it back in one write, never cleared', async () => {
    const c = fakeClipboard(privateOnly(), realShape)
    await pasteText('DICTATED', ioOf(c))
    assert.deepEqual(c.log, ['writeText', 'write'])
    assert.deepEqual([...(await bytesOf(c, pseudo(A)))], [1, 2, 3, 250])
  })

  it('several private formats and text come back together', async () => {
    const c = fakeClipboard(
      { ...privateOnly(), [pseudo(B)]: blob(9), 'text/plain': 'USER COPY' },
      realShape
    )
    await pasteText('DICTATED', ioOf(c))
    assert.deepEqual(c.log, ['writeText', 'write'])
    assert.deepEqual([...(await bytesOf(c, pseudo(A)))], [1, 2, 3, 250])
    assert.deepEqual([...(await bytesOf(c, pseudo(B)))], [9])
    assert.equal(await (await new FakeItem(c.current).getType('text/plain')).text(), 'USER COPY')
  })

  it('if the system refuses the private format, a private-only clipboard is not cleared (the text stays)', async () => {
    const c = fakeClipboard(privateOnly(), realShape, {
      refuse: (items) => items.some((i) => i.types.some((t) => t.includes('private-design')))
    })
    await pasteText('DICTATED', ioOf(c))
    assert.ok(!c.log.includes('clear'))
    assert.equal(await (await new FakeItem(c.current).getType('text/plain')).text(), 'DICTATED')
  })

  it('if the system refuses the private format next to text, the text comes back and a warning is logged', async (t) => {
    const warned = t.mock.method(console, 'warn', () => {})
    const c = fakeClipboard({ ...privateOnly(), 'text/plain': 'USER COPY' }, realShape, {
      refuse: (items) => items.some((i) => i.types.some((t) => t.includes('private-design')))
    })
    await pasteText('DICTATED', ioOf(c))
    assert.equal(await (await new FakeItem(c.current).getType('text/plain')).text(), 'USER COPY')
    assert.ok(!c.log.includes('clear'))
    assert.ok(warned.mock.calls.some((call) => /only in part/.test(String(call.arguments))))
  })

  it('a private format that cannot be read leaves the clipboard alone, not cleared', async () => {
    const c = fakeClipboard({ ...privateOnly(), [pseudo(A)]: new Error('unreadable') }, realShape)
    await pasteText('DICTATED', ioOf(c))
    assert.deepEqual(c.log, ['writeText'])
  })

  it('a private-only clipboard that cannot be written back logs it and keeps the text', async (t) => {
    const warned = t.mock.method(console, 'warn', () => {})
    const c = fakeClipboard(privateOnly(), realShape, { refuse: () => true })
    await pasteText('DICTATED', ioOf(c))
    assert.ok(warned.mock.calls.some((call) => /Could not restore/.test(String(call.arguments))))
  })

  it('plain text needs nothing special: the text pseudo-type is not treated as private', async () => {
    const c = fakeClipboard(realShape('USER COPY'), realShape)
    let written: string[] = []
    const original = c.board.write
    c.board.write = async (items: never[]) => {
      written = (items as unknown as FakeItem[]).flatMap((i) => i.types)
      return original(items)
    }
    await pasteText('DICTATED', ioOf(c))
    assert.deepEqual(written, ['text/plain'])
  })
})

describe('a slow clipboard does not hold up the paste', () => {
  it('the keystroke goes out after the read limit, and a later dictation is not blocked', async () => {
    const never = new Promise<never>(() => {})
    const stuck = fakeClipboard(realShape('USER COPY'), realShape)
    stuck.board.read = async () =>
      [
        {
          types: ['text/plain', 'image/png'],
          getType: async (type: string) => (type === 'image/png' ? never : new Blob(['USER COPY']))
        }
      ] as never
    let posted = 0
    const started = Date.now()
    await pasteText('FIRST', {
      clipboard: stuck.board,
      ...io,
      clipboardReadTimeoutMs: 40,
      simulate: async () => void posted++
    })
    assert.equal(posted, 1)
    assert.ok(Date.now() - started < 200, 'the read limit passed in is the one used')
    const next = fakeClipboard(realShape('OTHER'), realShape)
    await pasteText('SECOND', { clipboard: next.board, ...io, simulate: async () => void posted++ })
    assert.equal(posted, 2)
    assert.equal(await textOf(next.current), 'OTHER')
  })
})
