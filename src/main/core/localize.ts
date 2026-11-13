/**
 * Localizes the canned provider error messages for the main process.
 * The service always produces English text plus an error code; this swaps in
 * the interface language's version of the same message.
 */

import { UI_LANGUAGES, type UILanguage } from '../../shared/types'
import { CANNED, messageFor } from '../services/translation/errors'
import ar from '../../renderer/src/i18n/locales/ar.json'
import de from '../../renderer/src/i18n/locales/de.json'
import en from '../../renderer/src/i18n/locales/en.json'
import es from '../../renderer/src/i18n/locales/es.json'
import fr from '../../renderer/src/i18n/locales/fr.json'
import hi from '../../renderer/src/i18n/locales/hi.json'
import it from '../../renderer/src/i18n/locales/it.json'
import ja from '../../renderer/src/i18n/locales/ja.json'
import ko from '../../renderer/src/i18n/locales/ko.json'
import nl from '../../renderer/src/i18n/locales/nl.json'
import pl from '../../renderer/src/i18n/locales/pl.json'
import pt from '../../renderer/src/i18n/locales/pt.json'
import ru from '../../renderer/src/i18n/locales/ru.json'
import tr from '../../renderer/src/i18n/locales/tr.json'
import uk from '../../renderer/src/i18n/locales/uk.json'
import zh from '../../renderer/src/i18n/locales/zh.json'

const LOCALES: Record<string, Record<string, string>> = {
  ar,
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  nl,
  pl,
  pt,
  ru,
  tr,
  uk,
  zh
}

/** First supported language in the user's preference order (e.g. ["sv-SE", "es-ES"] gives "es"). */
export function resolveSystemLanguages(locales: readonly string[]): UILanguage {
  for (const locale of locales) {
    const code = locale.toLowerCase().split(/[-_]/)[0]
    const match = UI_LANGUAGES.find((l) => l.code === code)
    if (match) return match.code
  }
  return 'en'
}

/** Pick a supported interface language for a system locale such as "es-ES". */
export function resolveSystemLanguage(locale: string): UILanguage {
  const code = locale.toLowerCase().split(/[-_]/)[0]
  const match = UI_LANGUAGES.find((l) => l.code === code)
  return match ? match.code : 'en'
}

export function t(key: string, language: string, params?: Record<string, string | number>): string {
  const text = LOCALES[language]?.[key] ?? LOCALES.en[key] ?? key
  if (!params) return text
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(params[name] ?? ''))
}

const CANNED_KEYS = new Map<string, string>(
  Object.entries(CANNED).map(([name, english]) => [english, `errormsg.${name}`])
)

interface Localizable {
  errorCode?: string
  error?: string
}

/**
 * Replace a canned error message with its translation. Specific messages
 * (anything that is not the exact canned text for its code) are kept as is.
 */
export function localizeResult<T extends Localizable>(result: T, language: string): T {
  const code = result.errorCode
  if (!result.error) return result

  const cannedKey = CANNED_KEYS.get(result.error)
  if (cannedKey) return { ...result, error: t(cannedKey, language) }

  if (!code) return result
  let canned: string
  try {
    canned = messageFor(code as never)
  } catch {
    return result
  }
  if (result.error !== canned) return result
  return { ...result, error: t(`error.${code}`, language) }
}
