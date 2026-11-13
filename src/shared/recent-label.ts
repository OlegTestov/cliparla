/** A result as one short menu line: whitespace collapsed, cut with an ellipsis. */

export const RECENT_LABEL_CHARS = 40

export function recentLabel(text: string, max: number = RECENT_LABEL_CHARS): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(line) // never cut an emoji or a CJK character in half
  return chars.length <= max ? line : `${chars.slice(0, max).join('').trimEnd()}…`
}
