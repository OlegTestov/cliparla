/**
 * Screen translation asks the model for JSON `{source, translation}`. A reply that is not
 * that JSON is shown whole as the translation: this is never an error.
 */

export interface ScreenTranslation {
  translation: string
  /** The recognised text; absent when the reply was not valid JSON or had no source */
  source?: string
}

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i

/** A JSON reply with a translation, or null when the reply is something else. */
function parseJson(reply: string): { source: unknown; translation: unknown } | null {
  const body = FENCE.exec(reply.trim())?.[1] ?? reply
  try {
    const value: unknown = JSON.parse(body)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { source: unknown; translation: unknown })
      : null
  } catch {
    return null
  }
}

/** Returns null when the JSON is valid but the translation is empty (an empty answer). */
export function parseScreenTranslation(reply: string): ScreenTranslation | null {
  const json = parseJson(reply)
  if (!json || typeof json.translation !== 'string') return { translation: reply.trim() }
  const source = typeof json.source === 'string' ? json.source.trim() : ''
  // No translation but a source: show the source rather than an error
  const translation = json.translation.trim() || source
  if (!translation) return null
  return source ? { translation, source } : { translation }
}

const TRANSLATION_KEY = /"translation"\s*:\s*"/
const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '"': '"',
  '\\': '\\',
  '/': '/'
}

/**
 * What to show while a screen translation is still arriving: the `translation` string read from the
 * unfinished JSON, or the raw reply when it is not JSON. Null: nothing to show yet.
 */
export function partialTranslation(reply: string): string | null {
  const head = reply.trimStart()
  if (!head) return null
  if (!head.startsWith('{') && !head.startsWith('```')) return reply.trim() || null
  const key = TRANSLATION_KEY.exec(head)
  if (!key) return null
  let out = ''
  for (let i = key.index + key[0].length; i < head.length; i++) {
    const ch = head[i]
    if (ch === '"') break
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = head[i + 1]
    if (next === undefined) break
    if (next === 'u') {
      const hex = head.slice(i + 2, i + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
    } else {
      out += SIMPLE_ESCAPES[next] ?? next
      i++
    }
  }
  return out.trim() ? out : null
}
