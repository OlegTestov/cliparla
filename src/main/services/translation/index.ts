/**
 * The single place that decides which TranslationService the app uses.
 */

import { apiKeyStore } from '../api-key'
import { getDictionary, getRemoveFillerWords } from '../store'
import { parseDictionary } from '../../../shared/dictionary'
import { GeminiTranslationService } from './gemini-service'
import type { TranslationService } from './types'

let service: TranslationService = new GeminiTranslationService({
  getApiKey: () => apiKeyStore.getKey(),
  getRemoveFillerWords,
  getDictionary: () => {
    const parsed = parseDictionary(getDictionary())
    return parsed.ok ? parsed.lines : []
  }
})

export function getTranslationService(): TranslationService {
  return service
}

/** Replace the service (used by tests). */
export function setTranslationService(next: TranslationService): void {
  service = next
}

export type { StreamOptions, TranslationService } from './types'
