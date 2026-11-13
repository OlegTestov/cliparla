/**
 * Pasting must save and restore the user's clipboard through the async
 * ClipboardItem API (the synchronous image/HTML methods no longer exist).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FakeItem } from './helpers/fake-clipboard'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  saveClipboard,
  restoreClipboard,
  pngItem,
  CLIPBOARD_READ_TIMEOUT_MS
} = require('../src/main/services/clipboard-store')

// Items like Electron's: getType resolves a Blob, never a string
const text = async (item: FakeItem, type: string): Promise<string> =>
  (await item.getType(type)).text()

function fakeClipboard(initial: Array<Record<string, string | Blob>>) {
  let items = initial.map((d) => new FakeItem(d))
  return {
    read: async () => items,
    write: async (next: FakeItem[]) => void (items = next)
  }
}

describe('clipboard save and restore', () => {
  it('round-trips text, html and image items', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const original = [{ 'text/plain': 'hello', 'text/html': '<b>hello</b>', 'image/png': png }]
    const clip = fakeClipboard(original)

    const saved = await saveClipboard(clip)
    await clip.write([new FakeItem({ 'text/plain': 'temporary paste text' })])
    await restoreClipboard(clip, FakeItem, saved)

    const restored = await clip.read()
    assert.deepEqual(restored[0].types.sort(), ['image/png', 'text/html', 'text/plain'])
    assert.equal(await text(restored[0], 'text/plain'), 'hello')
    assert.equal(await restored[0].getType('image/png'), png)
  })

  it('an empty clipboard is empty again afterwards (clear)', async () => {
    let cleared = 0
    const clip = { ...fakeClipboard([]), clear: () => void cleared++ }
    const saved = await saveClipboard(clip)
    assert.deepEqual(saved, [])
    await clip.write([new FakeItem({ 'text/plain': 'pasted' })])
    await restoreClipboard(clip, FakeItem, saved)
    assert.equal(cleared, 1)
  })

  it('the pseudo-item macOS reports for an empty pasteboard counts as empty and is cleared', async () => {
    let cleared = 0
    const marker = new Blob(['marker'], { type: 'electron application/findtext' })
    const clip = {
      ...fakeClipboard([{ 'electron application/findtext': marker }]),
      clear: () => void cleared++
    }
    const saved = await saveClipboard(clip)
    assert.deepEqual(saved, [{}])
    await clip.write([new FakeItem({ 'text/plain': 'pasted' })])
    await restoreClipboard(clip, FakeItem, saved)
    assert.equal(cleared, 1)
  })

  it('the pseudo-type is dropped from a real item and the real formats are restored', async () => {
    const clip = fakeClipboard([{ 'text/plain': 'kept', 'electron application/findtext': 'x' }])
    const saved = await saveClipboard(clip)
    assert.deepEqual(Object.keys(saved[0]), ['text/plain'])
  })

  it('an empty clipboard without clear() gets an empty write', async () => {
    const clip = fakeClipboard([])
    await clip.write([new FakeItem({ 'text/plain': 'pasted' })])
    await restoreClipboard(clip, FakeItem, [])
    assert.equal((await clip.read()).length, 0)
  })

  it('entries without any format count as an empty clipboard and are cleared', async () => {
    let cleared = 0
    const clip = { ...fakeClipboard([{}]), clear: () => void cleared++ }
    const saved = await saveClipboard(clip)
    await restoreClipboard(clip, FakeItem, saved)
    assert.equal(cleared, 1)
  })

  it('one unreadable format does not drop the readable ones', async () => {
    const item = {
      types: ['text/plain', 'image/png'],
      getType: async (type: string) => {
        if (type === 'image/png') throw new Error('unreadable')
        return new Blob(['kept'])
      }
    }
    const saved = await saveClipboard({ read: async () => [item] })
    assert.deepEqual(Object.keys(saved[0]), ['text/plain'])
  })

  it('formats that all fail to read leave the clipboard alone', async () => {
    let cleared = 0
    const item = {
      types: ['text/plain'],
      getType: async () => {
        throw new Error('unreadable')
      }
    }
    const saved = await saveClipboard({ read: async () => [item] })
    assert.equal(saved, null)
    await restoreClipboard(
      { write: async () => undefined, clear: () => void cleared++ },
      FakeItem,
      saved
    )
    assert.equal(cleared, 0)
  })

  it('a clipboard that cannot be read is left alone, not emptied', async () => {
    let cleared = 0
    const broken = {
      read: async () => {
        throw new Error('unsupported')
      },
      write: async () => undefined,
      clear: () => void cleared++
    }
    const saved = await saveClipboard(broken)
    assert.equal(saved, null)
    await restoreClipboard(broken, FakeItem, saved)
    assert.equal(cleared, 0)
  })

  it('a copied file (uri-list with the same lines as plain text) comes back once, exactly', async () => {
    const clip = fakeClipboard([
      { 'text/uri-list': 'file:///a.txt', 'text/plain': 'file:///a.txt' }
    ])
    const saved = await saveClipboard(clip)
    await clip.write([new FakeItem({ 'text/plain': 'pasted' })])
    await restoreClipboard(clip, FakeItem, saved)
    const [item] = await clip.read()
    assert.deepEqual(item.types, ['text/uri-list'], 'the plain copy is left to the list')
    assert.equal(await text(item, 'text/uri-list'), 'file:///a.txt')
  })

  it('several copied files keep every line and their line breaks', async () => {
    const list = 'file:///a.txt\r\nfile:///b%20c.txt\r\nfile:///d.txt'
    const clip = fakeClipboard([
      { 'text/uri-list': list, 'text/plain': 'file:///a.txt\nfile:///b%20c.txt\nfile:///d.txt' }
    ])
    const saved = await saveClipboard(clip)
    await restoreClipboard(clip, FakeItem, saved)
    const [item] = await clip.read()
    assert.equal(await text(item, 'text/uri-list'), list)
    assert.deepEqual(item.types, ['text/uri-list'])
  })

  it('a uri-list next to text that is different keeps both', async () => {
    const clip = fakeClipboard([{ 'text/uri-list': 'file:///a.txt', 'text/plain': 'my note' }])
    const saved = await saveClipboard(clip)
    await restoreClipboard(clip, FakeItem, saved)
    assert.deepEqual((await clip.read())[0].types.sort(), ['text/plain', 'text/uri-list'])
  })

  it('pngItem wraps raw PNG bytes for the clipboard', async () => {
    const item = pngItem(FakeItem, Buffer.from([137, 80, 78, 71]))
    const blob = (await item.getType('image/png')) as Blob
    assert.equal(blob.type, 'image/png')
    assert.equal(blob.size, 4)
  })
})

describe('partial clipboard restore', () => {
  // A clipboard that refuses any entry with a type it cannot store
  function pickyClipboard(supported: string[]) {
    let items: FakeItem[] = []
    return {
      read: async () => items,
      write: async (next: FakeItem[]) => {
        for (const item of next) {
          for (const type of item.types) {
            if (!supported.includes(type)) throw new Error(`unsupported type ${type}`)
          }
        }
        items = next
      }
    }
  }

  it('restores the formats it can when one format is refused', async () => {
    const clip = pickyClipboard(['text/plain', 'text/html', 'image/png'])
    const saved = [
      { 'text/plain': 'hello', 'text/html': '<b>hello</b>', 'application/x-finder-file': 'blob' }
    ]
    await restoreClipboard(clip, FakeItem, saved)
    const restored = await clip.read()
    assert.deepEqual(restored[0].types.sort(), ['text/html', 'text/plain'])
    assert.equal(await text(restored[0], 'text/plain'), 'hello')
  })

  it('falls back to plain text when only text is accepted', async () => {
    const clip = pickyClipboard(['text/plain'])
    await restoreClipboard(clip, FakeItem, [{ 'text/plain': 'hi', 'text/html': '<i>hi</i>' }])
    const restored = await clip.read()
    assert.deepEqual(restored[0].types, ['text/plain'])
  })

  it('reports a restore that is impossible instead of hiding it', async () => {
    const clip = pickyClipboard([])
    await assert.rejects(restoreClipboard(clip, FakeItem, [{ 'text/plain': 'hi' }]), /unsupported/)
  })
})

describe('no removed Electron clipboard APIs', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })

  it('src uses none of the synchronous clipboard methods', () => {
    const banned = /clipboard\.(readHTML|readImage|writeImage|writeHTML|readRTF|write\(\{)/
    const hits = walk(join(__dirname, '..', 'src'))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => banned.test(readFileSync(f, 'utf8')))
    assert.deepEqual(hits, [])
  })
})

describe('bounded clipboard read', () => {
  const never = new Promise<never>(() => {})
  const slowClipboard = (fast: Record<string, string>, hung: string[]) => ({
    read: async () => [
      {
        types: [...hung, ...Object.keys(fast)],
        getType: async (type: string) => (hung.includes(type) ? never : new Blob([fast[type]]))
      }
    ]
  })

  it('the default bound is 300 ms', () => {
    assert.equal(CLIPBOARD_READ_TIMEOUT_MS, 300)
  })

  it('an empty private format (what Electron resolves for an unreadable one) is not saved', async () => {
    const pseudo = 'electron application/osclipboard;format="com.example.p"'
    const clip = fakeClipboard([{ [pseudo]: new Blob([]) }])
    assert.equal(await saveClipboard(clip), null)
    const withText = fakeClipboard([{ [pseudo]: new Blob([]), 'text/plain': 'kept' }])
    assert.deepEqual(Object.keys((await saveClipboard(withText))![0]), ['text/plain'])
  })

  const marker = (name: string): string =>
    `electron application/osclipboard;format="org.nspasteboard.${name}"`

  it('the nspasteboard.org markers are saved empty and written back with the text', async () => {
    for (const name of ['ConcealedType', 'TransientType', 'AutoGeneratedType']) {
      const clip = fakeClipboard([{ 'text/plain': 'secret', [marker(name)]: new Blob([]) }])
      const saved = await saveClipboard(clip)
      assert.deepEqual(Object.keys(saved![0]).sort(), ['text/plain', marker(name)].sort())
      await clip.write([new FakeItem({ 'text/plain': 'dictated' })])
      await restoreClipboard(clip, FakeItem, saved)
      assert.ok((await clip.read())[0].types.includes(marker(name)))
    }
  })

  it('a marker alone is kept; another empty private type next to it is still dropped', async () => {
    const other = 'electron application/osclipboard;format="com.example.p"'
    const saved = await saveClipboard(
      fakeClipboard([
        { 'text/plain': 't', [marker('ConcealedType')]: new Blob([]), [other]: new Blob([]) }
      ])
    )
    assert.deepEqual(Object.keys(saved![0]).sort(), ['text/plain', marker('ConcealedType')].sort())
  })

  it('a secret whose marker could not be read is not saved', async () => {
    const clip = {
      read: async () => [
        {
          types: ['text/plain', marker('ConcealedType')],
          getType: async (type: string) => {
            if (type === 'text/plain') return new Blob(['secret'])
            throw new Error('unreadable')
          }
        }
      ]
    }
    assert.equal(await saveClipboard(clip), null)
  })

  it('when the platform refuses the marker, the secret is not written back without it', async () => {
    const written: string[][] = []
    const clip = {
      read: async () => [],
      write: async (items: FakeItem[]) => {
        written.push(items.flatMap((item) => item.types))
        if (items.some((item) => item.types.includes(marker('ConcealedType')))) {
          throw new Error('unsupported format')
        }
      }
    }
    const saved = [{ 'text/plain': 'secret', [marker('ConcealedType')]: new Blob([]) }]
    await assert.rejects(restoreClipboard(clip as never, FakeItem as never, saved))
    assert.deepEqual(written, [['text/plain', marker('ConcealedType')]])
  })

  const rawPng = 'electron application/osclipboard;format="Apple PNG pasteboard type"'
  const rawTiff = 'electron application/osclipboard;format="NeXT TIFF v4.0 pasteboard type"'

  it('an image is written back as its raw formats only, without a second image/png', async () => {
    const png = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const clip = fakeClipboard([{ 'image/png': png, [rawPng]: png, [rawTiff]: new Blob(['t']) }])
    const saved = await saveClipboard(clip)
    await restoreClipboard(clip, FakeItem, saved)
    assert.deepEqual((await clip.read())[0].types.sort(), [rawPng, rawTiff].sort())
  })

  it('an image/png without a raw image format is still written (Chromium image copy)', async () => {
    const png = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const clip = fakeClipboard([{ 'image/png': png }])
    await restoreClipboard(clip, FakeItem, await saveClipboard(clip))
    assert.deepEqual((await clip.read())[0].types, ['image/png'])
  })

  it('a read that never finishes ends at the limit, keeps what was read and says so', async () => {
    let told = 0
    const started = Date.now()
    const saved = await saveClipboard(slowClipboard({ 'text/plain': 'kept' }, ['image/png']), {
      timeoutMs: 40,
      onTimeout: () => void told++
    })
    assert.ok(Date.now() - started < 400)
    assert.equal(told, 1)
    assert.deepEqual(Object.keys(saved![0]), ['text/plain'])
  })

  it('a format that never arrives does not hold back the others', async () => {
    const pseudo = 'electron application/osclipboard;format="com.example.p"'
    const saved = await saveClipboard(slowClipboard({ 'text/plain': 'kept' }, [pseudo]), {
      timeoutMs: 40
    })
    assert.deepEqual(Object.keys(saved![0]), ['text/plain'])
  })

  it('nothing read in time leaves the clipboard alone (null), also when read() itself hangs', async () => {
    assert.equal(await saveClipboard(slowClipboard({}, ['text/plain']), { timeoutMs: 30 }), null)
    assert.equal(await saveClipboard({ read: () => never }, { timeoutMs: 30 }), null)
  })

  it('a format that arrives after the limit does not change what was saved', async () => {
    let release: (value: Blob) => void = () => {}
    const late = new Promise<Blob>((resolve) => (release = resolve))
    const clip = {
      read: async () => [
        {
          types: ['text/plain', 'text/html'],
          getType: async (type: string) => (type === 'text/html' ? late : new Blob(['kept']))
        }
      ]
    }
    const saved = await saveClipboard(clip, { timeoutMs: 30 })
    release(new Blob(['<b>late</b>']))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(Object.keys(saved![0]), ['text/plain'])
  })

  it('a fast read pays no wait and does not call onTimeout', async () => {
    let told = 0
    const started = Date.now()
    await saveClipboard(fakeClipboard([{ 'text/plain': 'x' }]), { onTimeout: () => void told++ })
    assert.ok(Date.now() - started < 100)
    assert.equal(told, 0)
  })
})
