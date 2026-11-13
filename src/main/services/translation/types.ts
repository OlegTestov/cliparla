/**
 * TranslationService - the only way the app talks to an AI provider.
 *
 * Screenshot translation, dictation and text actions all call this interface.
 * Every method resolves (never throws) with a TranslationResult.
 */

import type { KeyTestResult, TranslationResult } from '../../../shared/types'

/** Streaming hooks: `onText` gets everything that has arrived so far, `signal` cancels the request. */
export interface StreamOptions {
  onText?: (soFar: string) => void
  signal?: AbortSignal
}

export interface TranslationService {
  translateScreenshot(
    imageBase64: string,
    targetLanguage: string,
    stream?: StreamOptions
  ): Promise<TranslationResult>
  /** The text of a picture exactly as it appears (no translation); `text` is '' when there is none. */
  extractText(imageBase64: string): Promise<TranslationResult>
  translateSpeech(
    audioBase64: string,
    mimeType: string,
    targetLanguage: string,
    durationMs?: number,
    /** Overrides the deadline of this one attempt */
    deadlineMs?: number,
    stream?: StreamOptions
  ): Promise<TranslationResult>
  commentText(text: string, stream?: StreamOptions): Promise<TranslationResult>
  improveText(text: string, stream?: StreamOptions): Promise<TranslationResult>
  summarizeText(text: string, stream?: StreamOptions): Promise<TranslationResult>
  /** Check a candidate key without storing it. */
  testKey(apiKey: string): Promise<KeyTestResult>
}
