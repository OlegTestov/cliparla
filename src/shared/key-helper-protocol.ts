/** What the key helper (native/key-helper) prints and how it exits. */

export type KeyHelperEvent = 'ready' | 'down' | 'up'

/** Exit codes; the same meaning as the paste helper's 2. */
export const KEY_HELPER_EXIT = {
  /** Accessibility is not granted: the tap is not even tried */
  noPermission: 2,
  /** The system refused to create the tap */
  tapFailed: 3,
  badArguments: 4
} as const

/** One output line as an event; anything else (noise, a half line) is null. */
export function parseKeyHelperLine(line: string): KeyHelperEvent | null {
  const word = line.trim()
  return word === 'ready' || word === 'down' || word === 'up' ? word : null
}

/** Cuts a byte stream into lines: a line can arrive in pieces, or several in one piece. */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let rest = ''
  return (chunk) => {
    rest += chunk
    let end = rest.indexOf('\n')
    while (end !== -1) {
      onLine(rest.slice(0, end))
      rest = rest.slice(end + 1)
      end = rest.indexOf('\n')
    }
    // A runaway line without a newline is dropped instead of growing without limit
    if (rest.length > 256) rest = ''
  }
}
