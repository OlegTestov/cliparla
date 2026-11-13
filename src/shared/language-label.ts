/**
 * Display names for the target languages, in the interface language.
 * The stored value stays the English name (it goes into the prompt).
 */

const CODES: Record<string, string> = {
  Arabic: 'ar',
  'Chinese (Simplified)': 'zh-Hans',
  Dutch: 'nl',
  English: 'en',
  French: 'fr',
  German: 'de',
  Hindi: 'hi',
  Italian: 'it',
  Japanese: 'ja',
  Korean: 'ko',
  Polish: 'pl',
  Portuguese: 'pt',
  Russian: 'ru',
  Spanish: 'es',
  Turkish: 'tr',
  Ukrainian: 'uk'
}

export function languageLabel(englishName: string, uiLanguage: string): string {
  const code = CODES[englishName]
  if (!code) return englishName
  try {
    return new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(code) ?? englishName
  } catch {
    return englishName
  }
}
