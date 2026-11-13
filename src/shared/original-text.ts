/** What the "Original" row of the result window shows, if anything. */

const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The source text, unless there is none or it is the translation (the text was already in the target language). */
export function originalToShow(result: { text?: string; source?: string } | null): string | null {
  const source = result?.source?.trim()
  if (!source || !result?.text) return source || null
  return normalise(source) === normalise(result.text) ? null : source
}
