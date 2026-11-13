/**
 * A clipboard fake that has exactly the methods of Electron 45's `clipboard` (checked by
 * `satisfies Pick<Electron.Clipboard, ...>` under `npm run check`) and returns Blobs from
 * `getType`, as the real one does. A test cannot rely on a method Electron does not have.
 */

import type {} from 'electron'

/** An Error value stands for a private format Electron cannot read: it resolves an empty Blob. */
export type Data = Record<string, string | Blob | Error>

export class FakeItem {
  readonly types: string[]
  constructor(readonly data: Data) {
    this.types = Object.keys(data)
  }
  async getType(type: string): Promise<Blob> {
    const value = this.data[type]
    if (value === undefined) throw new Error(`no ${type}`)
    if (value instanceof Error) return new Blob([])
    return typeof value === 'string' ? new Blob([value]) : value
  }
}

export function fakeClipboard(
  initial: Data,
  afterWriteText: (text: string) => Data,
  options: { refuse?: (items: FakeItem[]) => boolean } = {}
) {
  let current = initial
  const log: string[] = []
  const board = {
    async read() {
      return [new FakeItem(current)] as never
    },
    async write(items: never[]) {
      const list = items as unknown as FakeItem[]
      if (options.refuse?.(list)) throw new Error('unsupported format')
      // One write carries every format of every item, as on the real pasteboard
      current = Object.assign({}, ...list.map((item) => item.data))
      log.push('write')
    },
    async writeText(text: string) {
      current = afterWriteText(text)
      log.push('writeText')
    },
    clear() {
      current = {}
      log.push('clear')
    }
  } satisfies Pick<Electron.Clipboard, 'write' | 'writeText' | 'clear'> & {
    read(): Promise<never>
  }
  return {
    board,
    log,
    get current() {
      return current
    },
    set current(value: Data) {
      current = value
    }
  }
}
