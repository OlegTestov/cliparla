/**
 * Maps provider failures to a code plus a message that says what the user should do.
 */

import type { TranslationErrorCode } from '../../../shared/types'

export interface ClassifiedError {
  errorCode: TranslationErrorCode
  error: string
}

export const MISSING_KEY_MESSAGE =
  'No Gemini API key yet. Paste your key to start. A free one takes a minute to get.'

const MESSAGES: Record<TranslationErrorCode, string> = {
  MISSING_KEY: MISSING_KEY_MESSAGE,
  INVALID_KEY: 'Google rejected this API key. Paste a fresh key and press "Test key".',
  QUOTA_EXHAUSTED:
    'Your Gemini quota is used up for now. Wait a minute and try again, or check your limits in Google AI Studio.',
  QUOTA_DAILY:
    'Your daily Gemini limit is used up. It resets tomorrow. Or use another key, or turn on billing in Google AI Studio.',
  LOCATION_UNSUPPORTED:
    "Google does not offer the Gemini API in your country or region. Check Google's list of supported regions.",
  NETWORK: 'Cannot reach Google. Check your internet connection and try again.',
  TIMEOUT: 'Google did not answer in time. Check your connection and try again.',
  BLOCKED: 'Google blocked this content with its safety filters. Try a different selection.',
  INVALID_REQUEST: 'The request was not accepted. Please try again with different input.',
  UNKNOWN: 'Something went wrong while talking to Google. Please try again.'
}

/**
 * Fixed English messages the service produces besides the per-code ones.
 * Each has a translation under `errormsg.<name>`; localizeResult swaps it in.
 */
export const CANNED = {
  noImage: 'No image data provided.',
  noAudio: 'No audio data provided.',
  noAudioFormat: 'Audio format is not specified.',
  noLanguage: 'Target language is not configured. Pick a language in Settings.',
  noText: 'No text provided.',
  emptyImage: 'No text could be extracted from the image. The image might be empty or unreadable.',
  emptySpeech: 'No speech could be detected in the audio. Please try speaking more clearly.',
  emptyResponse: 'No response generated.',
  noSpeechHeard: 'No speech was detected in the recording. Please try again.'
} as const

export function messageFor(code: TranslationErrorCode): string {
  return MESSAGES[code]
}

export function failure(code: TranslationErrorCode, error?: string): ClassifiedError {
  return { errorCode: code, error: error ?? MESSAGES[code] }
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/** Google names the exhausted quota in the 429 body (for example "GenerateRequestsPerDayPerProjectPerModel"). */
export function isDailyQuota(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  // A key without any free quota lists the per-minute limit too: the reset time is then unknown
  return /per[\s_-]?day/i.test(message) && !/per[\s_-]?min/i.test(message)
}

/** Thrown when a request exceeds its deadline. */
export class DeadlineError extends Error {
  constructor() {
    super('Request deadline exceeded')
    this.name = 'DeadlineError'
  }
}

/** Reject with DeadlineError if the promise does not settle within ms. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Classify any error thrown by the Gemini SDK or the network layer. */
export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const status = statusOf(error)

  // The SDK's own request timeout surfaces as its abort error, often before our deadline
  if (
    error instanceof DeadlineError ||
    lower.includes('request aborted') ||
    (error as { name?: string })?.name === 'AbortError'
  ) {
    return failure('TIMEOUT')
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api key not valid') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key expired') ||
    lower.includes('permission_denied')
  ) {
    return failure('INVALID_KEY')
  }
  if ((status === 429 || lower.includes('quota')) && isDailyQuota(error)) {
    return failure('QUOTA_DAILY')
  }
  if (
    status === 429 ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests')
  ) {
    return failure('QUOTA_EXHAUSTED')
  }
  if (lower.includes('safety') || lower.includes('blocked')) {
    return failure('BLOCKED')
  }
  if (lower.includes('location is not supported')) {
    return failure('LOCATION_UNSUPPORTED')
  }
  if (status === 400) {
    return failure('INVALID_REQUEST')
  }
  if (
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('etimedout')
  ) {
    return failure('NETWORK')
  }
  return failure('UNKNOWN')
}
