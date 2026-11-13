/** The dictation target choices: keeping the spoken language always comes first. */

import { KEEP_LANGUAGE } from './types'

export function dictationChoices(languages: readonly string[]): string[] {
  return [KEEP_LANGUAGE, ...languages.filter((language) => language !== KEEP_LANGUAGE)]
}
