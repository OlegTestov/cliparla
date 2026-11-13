/** The pill shows the END of a growing dictation, the part being written now. */

export const PILL_TEXT_CHARS = 60

export function pillTail(text: string, max: number = PILL_TEXT_CHARS): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(line)
  return chars.length <= max ? line : `…${chars.slice(-max).join('').trimStart()}`
}
