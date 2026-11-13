/**
 * Gemini implementation of TranslationService.
 *
 * Calls Google directly with the user's own API key. The key is read through
 * `getApiKey` on every call, so replacing or removing it takes effect at once.
 */

import { GoogleGenAI, Type } from '@google/genai'
import { KEEP_LANGUAGE, type KeyTestResult, type TranslationResult } from '../../../shared/types'
import {
  BASE_DEADLINE_MS,
  GEMINI_MODEL,
  speechDeadlineMs,
  buildTranslationPrompt,
  buildCopyTextPrompt,
  NO_TEXT_MARKER,
  buildSpeechTranslationPrompt,
  buildKeepLanguageSpeechPrompt,
  buildCommentPrompt,
  buildImprovePrompt,
  buildSummarizePrompt
} from '../../../shared/gemini-constants'
import { createLogger } from '../../core/logger'
import { errorHandler } from '../../core/errors'
import { parseScreenTranslation, partialTranslation } from '../../../shared/structured-translation'
import { CANNED, classifyError, failure, isDailyQuota, withDeadline } from './errors'
import type { StreamOptions, TranslationService } from './types'

const log = createLogger('Gemini')

type Part = string | { inlineData: { mimeType: string; data: string } }

/** One streamed piece of a reply; `blocked` carries the reason when Google refused the content. */
export interface ModelChunk {
  text?: string
  blocked?: string
}

/** The slice of the Gemini SDK model that this service uses. */
export interface GenerativeModelLike {
  generateContent(parts: Part[], signal: AbortSignal): Promise<ModelChunk>
  generateContentStream(parts: Part[], signal: AbortSignal): Promise<AsyncIterable<ModelChunk>>
}

export interface RequestOptions {
  /** Aborts the HTTP request after this many milliseconds. */
  timeout: number
}

/** Asks the model for JSON that follows a schema (structured output). */
export interface JsonOutput {
  responseMimeType: 'application/json'
  responseSchema: {
    type: Type
    properties: Record<string, { type: Type }>
    propertyOrdering: string[]
    required: string[]
  }
}

export type ModelFactory = (
  apiKey: string,
  modelName: string,
  requestOptions: RequestOptions,
  output?: JsonOutput
) => GenerativeModelLike

const BLOCKING_FINISH = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'IMAGE_SAFETY'
])

interface SdkResponse {
  text?: string
  promptFeedback?: { blockReason?: string }
  candidates?: Array<{ finishReason?: string }>
}

function toChunk(response: SdkResponse): ModelChunk {
  const text = response.text
  if (text) return { text }
  const finish = response.candidates?.[0]?.finishReason
  const blocked =
    response.promptFeedback?.blockReason ?? (BLOCKING_FINISH.has(finish ?? '') ? finish : undefined)
  return blocked ? { blocked: String(blocked) } : {}
}

export const defaultModelFactory: ModelFactory = (apiKey, modelName, requestOptions, output) => {
  const ai = new GoogleGenAI({ apiKey })
  const request = (parts: Part[], signal: AbortSignal) => ({
    model: modelName,
    contents: parts,
    config: {
      httpOptions: { timeout: requestOptions.timeout },
      abortSignal: signal,
      automaticContinuation: false,
      ...(output ?? {})
    }
  })
  return {
    generateContent: async (parts, signal) =>
      toChunk(await ai.models.generateContent(request(parts, signal))),
    generateContentStream: async (parts, signal) => {
      const stream = await ai.models.generateContentStream(request(parts, signal))
      return (async function* () {
        for await (const response of stream) yield toChunk(response)
      })()
    }
  }
}

const SOURCE_AND_TRANSLATION: JsonOutput = {
  responseMimeType: 'application/json',
  responseSchema: {
    type: Type.OBJECT,
    properties: { source: { type: Type.STRING }, translation: { type: Type.STRING } },
    propertyOrdering: ['source', 'translation'],
    required: ['source', 'translation']
  }
}

// Key check: fast, the user is watching it
const DEFAULT_TEST_DEADLINE_MS = 15_000

export interface GeminiServiceOptions {
  getApiKey: () => string
  /** Names and terms to spell exactly; read on every call like the key */
  getDictionary?: () => readonly string[]
  /** Read for every dictation request, including Retry of a kept recording. */
  getRemoveFillerWords?: () => boolean
  modelFactory?: ModelFactory
  /** Attempts per request; 1 disables retries. */
  maxAttempts?: number
  deadlineMs?: number
  testDeadlineMs?: number
}

export class GeminiTranslationService implements TranslationService {
  private readonly getApiKey: () => string
  private readonly getDictionary: () => readonly string[]
  private readonly getRemoveFillerWords: () => boolean
  private readonly modelFactory: ModelFactory
  private readonly maxAttempts: number
  private readonly deadlineMs: number
  private readonly testDeadlineMs: number

  constructor(options: GeminiServiceOptions) {
    this.getApiKey = options.getApiKey
    this.getDictionary = options.getDictionary ?? (() => [])
    this.getRemoveFillerWords = options.getRemoveFillerWords ?? (() => true)
    this.modelFactory = options.modelFactory ?? defaultModelFactory
    this.maxAttempts = options.maxAttempts ?? 2
    this.deadlineMs = options.deadlineMs ?? BASE_DEADLINE_MS
    this.testDeadlineMs = options.testDeadlineMs ?? DEFAULT_TEST_DEADLINE_MS
  }

  async translateScreenshot(
    imageBase64: string,
    targetLanguage: string,
    stream?: StreamOptions
  ): Promise<TranslationResult> {
    if (!imageBase64?.trim()) return invalid(CANNED.noImage)
    if (!targetLanguage?.trim()) return invalid(CANNED.noLanguage)
    const result = await this.generate(
      [
        buildTranslationPrompt(targetLanguage, this.getDictionary()),
        { inlineData: { mimeType: 'image/png', data: imageBase64 } }
      ],
      CANNED.emptyImage,
      {
        output: SOURCE_AND_TRANSLATION,
        show: partialTranslation,
        stream
      }
    )
    if (!result.success || !result.text) return result
    const parsed = parseScreenTranslation(result.text)
    if (!parsed) {
      log.warn('Received an empty translation in the JSON reply')
      return { success: false, errorCode: 'UNKNOWN', error: CANNED.emptyImage }
    }
    return {
      success: true,
      text: parsed.translation,
      ...(parsed.source ? { source: parsed.source } : {})
    }
  }

  async extractText(imageBase64: string): Promise<TranslationResult> {
    if (!imageBase64?.trim()) return invalid(CANNED.noImage)
    const result = await this.generate(
      [
        buildCopyTextPrompt(this.getDictionary()),
        { inlineData: { mimeType: 'image/png', data: imageBase64 } }
      ],
      CANNED.emptyImage
    )
    // An empty picture is an answer, not a failure
    if (result.success && result.text === NO_TEXT_MARKER) return { success: true, text: '' }
    return result
  }

  async translateSpeech(
    audioBase64: string,
    mimeType: string,
    targetLanguage: string,
    durationMs?: number,
    deadlineMs?: number,
    stream?: StreamOptions
  ): Promise<TranslationResult> {
    if (!audioBase64?.trim()) return invalid(CANNED.noAudio)
    if (!mimeType?.trim()) return invalid(CANNED.noAudioFormat)
    if (!targetLanguage?.trim()) return invalid(CANNED.noLanguage)
    const removeFillerWords = this.getRemoveFillerWords()
    const result = await this.generate(
      [
        targetLanguage === KEEP_LANGUAGE
          ? buildKeepLanguageSpeechPrompt(this.getDictionary(), removeFillerWords)
          : buildSpeechTranslationPrompt(targetLanguage, this.getDictionary(), removeFillerWords),
        { inlineData: { mimeType, data: audioBase64 } }
      ],
      CANNED.emptySpeech,
      {
        deadlineMs: deadlineMs ?? speechDeadlineMs(this.deadlineMs, durationMs),
        maxAttempts: 1, // dictation owns the retry schedule (own deadline per attempt, cancellable)
        show: hideNoSpeechMarker,
        stream
      }
    )
    if (result.success && result.text === NO_SPEECH_MARKER) {
      return {
        success: false,
        errorCode: 'INVALID_REQUEST',
        noSpeech: true,
        error: CANNED.noSpeechHeard
      }
    }
    return result
  }

  commentText(text: string, stream?: StreamOptions): Promise<TranslationResult> {
    return this.textAction(buildCommentPrompt(), text, stream)
  }

  improveText(text: string, stream?: StreamOptions): Promise<TranslationResult> {
    return this.textAction(buildImprovePrompt(), text, stream)
  }

  summarizeText(text: string, stream?: StreamOptions): Promise<TranslationResult> {
    return this.textAction(buildSummarizePrompt(), text, stream)
  }

  async testKey(apiKey: string): Promise<KeyTestResult> {
    const key = apiKey?.trim()
    if (!key) return { ok: false, ...failure('MISSING_KEY') }
    const controller = new AbortController()
    try {
      const model = this.modelFactory(key, GEMINI_MODEL, { timeout: this.testDeadlineMs })
      const reply = await withDeadline(
        model.generateContent(['Reply with the single word: OK'], controller.signal),
        this.testDeadlineMs
      )
      if (reply.blocked) throw new Error(blockedMessage(reply.blocked))
      return { ok: true }
    } catch (error) {
      controller.abort()
      const { errorCode, error: message } = classifyError(error)
      log.warn('Key test failed', { errorCode })
      return { ok: false, errorCode, error: message }
    }
  }

  private textAction(
    prompt: string,
    text: string,
    stream?: StreamOptions
  ): Promise<TranslationResult> {
    if (!text?.trim()) return Promise.resolve(invalid(CANNED.noText))
    return this.generate([prompt, text], CANNED.emptyResponse, { stream })
  }

  private async generate(
    parts: Part[],
    emptyMessage: string,
    options: GenerateOptions = {}
  ): Promise<TranslationResult> {
    const apiKey = this.getApiKey()?.trim()
    if (!apiKey) return { success: false, ...failure('MISSING_KEY') }

    const deadlineMs = options.deadlineMs ?? this.deadlineMs
    const maxAttempts = options.maxAttempts ?? this.maxAttempts
    const show = options.show ?? ((text: string) => text.trim() || null)
    const outer = options.stream?.signal
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (outer?.aborted) abort()
    else outer?.addEventListener('abort', abort)

    let received = ''
    let shown = ''
    let closed = false
    const push = (chunk: ModelChunk): void => {
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      if (chunk.blocked) throw new Error(blockedMessage(chunk.blocked))
      if (!chunk.text) return
      received += chunk.text
      const next = show(received)
      if (!closed && next && next !== shown) {
        shown = next
        options.stream?.onText?.(next)
      }
    }

    try {
      const model = this.modelFactory(apiKey, GEMINI_MODEL, { timeout: deadlineMs }, options.output)
      await withDeadline(
        (async () => {
          // Only the opening of the stream is retried: once text has arrived a retry would repeat it
          const opened = await openWithRetry(async () => {
            const iterator = (await model.generateContentStream(parts, controller.signal))[
              Symbol.asyncIterator
            ]()
            return { iterator, first: await iterator.next() }
          }, maxAttempts)
          let step = opened.first
          while (!step.done) {
            push(step.value)
            step = await opened.iterator.next()
          }
        })(),
        deadlineMs
      )
      closed = true
      const text = received.trim()
      if (!text) {
        log.warn('Received empty response from API')
        return { success: false, errorCode: 'UNKNOWN', error: emptyMessage }
      }
      return { success: true, text }
    } catch (error) {
      closed = true
      abort() // a deadline must also stop the request itself
      const classified = classifyError(error)
      log.error(
        'Gemini request failed',
        error instanceof Error ? error : new Error(String(error)),
        {
          errorCode: classified.errorCode
        }
      )
      return { success: false, ...classified, ...(shown ? { partial: shown } : {}) }
    } finally {
      outer?.removeEventListener('abort', abort)
    }
  }
}

interface GenerateOptions {
  deadlineMs?: number
  maxAttempts?: number
  output?: JsonOutput
  /** What to display of the reply so far (null: nothing yet); default is the trimmed text */
  show?: (received: string) => string | null
  stream?: StreamOptions
}

const RETRY_DELAY_MS = 500

/** An HTTP status decides first (the SDK's message is a JSON body the text rules cannot read). */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  if (isDailyQuota(error)) return false // the daily limit resets tomorrow
  if (typeof status === 'number') return status >= 500 || status === 429
  const app = errorHandler.handle(error)
  return app.retryable && (app.category === 'network' || app.category === 'api')
}

async function openWithRetry<T>(open: () => Promise<T>, maxAttempts: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await open()
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2 ** (attempt - 1)))
    }
  }
}

const NO_SPEECH_MARKER = '[No speech detected]'

/** The pill must not flash the marker the model answers when nobody spoke. */
function hideNoSpeechMarker(received: string): string | null {
  const text = received.trim()
  return !text || NO_SPEECH_MARKER.startsWith(text) || text === NO_SPEECH_MARKER ? null : text
}

function blockedMessage(reason: string): string {
  return `Response blocked by the safety filters (${reason})`
}

function invalid(error: string): TranslationResult {
  return { success: false, errorCode: 'INVALID_REQUEST', error }
}
