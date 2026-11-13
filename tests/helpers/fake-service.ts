import type { KeyTestResult, TranslationResult } from '../../src/shared/types'
import type { StreamOptions, TranslationService } from '../../src/main/services/translation/types'

export interface RecordedCall {
  method: string
  args: unknown[]
}

/** TranslationService that records every call and answers with a fixed result. */
export class FakeTranslationService implements TranslationService {
  calls: RecordedCall[] = []
  /** The streaming hooks of each translateSpeech call */
  speechStreams: Array<StreamOptions | undefined> = []

  constructor(
    private readonly result: TranslationResult = { success: true, text: 'translated' },
    private readonly keyTest: KeyTestResult = { ok: true }
  ) {}

  private record(method: string, args: unknown[]): Promise<TranslationResult> {
    this.calls.push({ method, args })
    return Promise.resolve(this.result)
  }

  translateScreenshot(image: string, language: string): Promise<TranslationResult> {
    return this.record('translateScreenshot', [image, language])
  }
  extractText(image: string): Promise<TranslationResult> {
    return this.record('extractText', [image])
  }
  translateSpeech(
    audio: string,
    mime: string,
    language: string,
    durationMs?: number,
    deadlineMs?: number,
    stream?: StreamOptions
  ): Promise<TranslationResult> {
    void durationMs
    void deadlineMs
    this.speechStreams.push(stream)
    return this.record('translateSpeech', [audio, mime, language])
  }
  commentText(text: string): Promise<TranslationResult> {
    return this.record('commentText', [text])
  }
  improveText(text: string): Promise<TranslationResult> {
    return this.record('improveText', [text])
  }
  summarizeText(text: string): Promise<TranslationResult> {
    return this.record('summarizeText', [text])
  }
  testKey(apiKey: string): Promise<KeyTestResult> {
    this.calls.push({ method: 'testKey', args: [apiKey] })
    return Promise.resolve(this.keyTest)
  }
}
