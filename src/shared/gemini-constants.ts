/**
 * Gemini API Constants and Prompts
 *
 * Used by the Gemini translation service. No Electron dependencies - pure TypeScript.
 */

import { COPY_TEXT_LEAD, dictionaryBlock } from './dictionary'

// One model for every action (screenshot, speech, text)
export const GEMINI_MODEL = 'gemini-3.1-flash-lite'

// One attempt; speech adds time for the audio on top
export const BASE_DEADLINE_MS = 30_000
const SPEECH_DEADLINE_MS_PER_AUDIO_SECOND = 250

/** Dictation retries a failed speech request after these pauses (3 attempts in all). */
export const SPEECH_RETRY_DELAYS_MS: readonly number[] = [1000, 3000]
/** All attempts together may run this long beyond the first attempt's deadline. */
export const SPEECH_RETRY_EXTRA_MS = 20_000

/** 30 s plus 0.25 s per second of audio: about 75 s for 180 s. */
export function speechDeadlineMs(baseMs: number, durationMs: number | undefined): number {
  return baseMs + Math.round(((durationMs ?? 0) / 1000) * SPEECH_DEADLINE_MS_PER_AUDIO_SECOND)
}

/**
 * Generate the optimal prompt for OCR and translation.
 * The prompt instructs the model to recognize text and translate it in one step.
 */
export function buildTranslationPrompt(
  targetLanguage: string,
  dictionary: readonly string[] = []
): string {
  return `You are a professional translator. Analyze this image and perform the following tasks:

1. Recognize and extract ALL text visible in the image (OCR)
2. ALWAYS translate the extracted text into ${targetLanguage}

Reply as JSON with two fields:
- "source": the recognised text exactly as it appears, with its line breaks
- "translation": the translation into ${targetLanguage}

IMPORTANT RULES:
- Only skip translation if the text is ALREADY in ${targetLanguage}; then "translation" repeats the text
- Put the original text only in "source" and the translated text only in "translation"
- Do not add any explanations or commentary
- **Sound natural and idiomatic to native speakers**
- **Match the original style (formal/informal, technical/casual)**
- **Preserve sentence types: questions must remain questions with correct grammar (word order, auxiliaries) for ${targetLanguage}**
- Preserve the original formatting (line breaks, paragraphs)
- If there are multiple text blocks, process them all and maintain their relative order
- If no text is found in the image, set "source" to "" and "translation" to "[No text detected in image]"
- Do not include explanations about whether translation was needed${dictionaryBlock(dictionary)}`
}

/** The marker the model returns when a picture has no text; the copy-text flow turns it into "No text found". */
export const NO_TEXT_MARKER = '[No text detected in image]'

/** Prompt for "Copy text": read the text of the picture, nothing else. */
export function buildCopyTextPrompt(dictionary: readonly string[] = []): string {
  return `Read all text visible in this image (OCR) and return it exactly as it appears.

IMPORTANT RULES:
- Do not translate anything; keep the original language
- Keep the line breaks and the reading order
- Return ONLY the text, with no commentary, no quotes and no formatting marks you added
- Never invent, guess or complete text that is not clearly visible
- If there is no text in the image, respond with exactly: ${NO_TEXT_MARKER}${dictionaryBlock(dictionary, COPY_TEXT_LEAD)}`
}

/** Shared by every speech mode when filler removal is enabled. */
export const REMOVE_FILLER_WORDS_RULE =
  'Remove filler sounds and filler words, in whatever language they occur: "um", "uh", "er", "like" and "you know" used as fillers; "ээ", "э-э", "эм", "ну", "типа" and "как бы" used as fillers; "eh", "este", "pues" and their equivalents in other languages. A sentence-opening "ну" or "well" that only fills time is a filler: drop it ("Ну, позвони Ивану" -> "Позвони Ивану"). Never remove words that carry meaning ("like" meaning "similar to" is not a filler)'

/** Transcribe and translate speech in one step. */
export function buildSpeechTranslationPrompt(
  targetLanguage: string,
  dictionary: readonly string[] = [],
  removeFillerWords = true
): string {
  return `You are a professional translator. Listen to this audio and perform the following tasks:

1. Transcribe the speech in the audio
2. ALWAYS translate the transcription into ${targetLanguage}

IMPORTANT RULES:
- Only skip translation if the speech is ALREADY in ${targetLanguage}
- Return ONLY the translated text, NOT the original transcription — do not include both
- Do not add any explanations or commentary
- **Sound natural and idiomatic to native speakers**
- **Match the original style (formal/informal, technical/casual)**
- **Preserve sentence types: questions must remain questions with correct grammar (word order, auxiliaries) for ${targetLanguage}**
- Preserve the original meaning and emotional tone${removeFillerWords ? `\n- ${REMOVE_FILLER_WORDS_RULE}` : ''}
- If there is no clearly intelligible speech in the audio (silence, noise, music, mumbling), respond with exactly: [No speech detected]
- Never invent, guess or complete text that was not clearly spoken
- Do not include explanations about whether translation was needed${dictionaryBlock(dictionary)}`
}

/**
 * Prompt for dictation that keeps the spoken language: a clean transcript, never a translation.
 */
export function buildKeepLanguageSpeechPrompt(
  dictionary: readonly string[] = [],
  removeFillerWords = true
): string {
  return `You are a careful transcriber. Listen to this audio and write down the speech in the language it is spoken in.

IMPORTANT RULES:
- Write the text in the spoken language; never translate it into another language
- Add punctuation and paragraph breaks where the speech calls for them
- ${removeFillerWords ? REMOVE_FILLER_WORDS_RULE : 'Transcribe filler sounds and words as spoken'}
- Apply spoken self-corrections only when the later words REPLACE the earlier ones ("scratch that", "no, I mean", "нет, вернее", "perdón, quiero decir"): drop the corrected-away part and the correction phrase itself, and keep only the corrected version
- "I mean", "то есть" and "точнее" often clarify instead of correct: when the earlier words stay true, keep everything as spoken
- Never summarise, shorten or reword; do not change the meaning, names, numbers or the speaker's style
- Return ONLY the text, with no explanations or commentary
- If there is no clearly intelligible speech in the audio (silence, noise, music, mumbling), respond with exactly: [No speech detected]
- Never invent, guess or complete text that was not clearly spoken

EXAMPLES (spoken -> written). They are illustrations only; never output them:
- "um, call Peter at nine, scratch that, at ten" -> "${removeFillerWords ? 'Call' : 'Um, call'} Peter at ten."
- "ну, ээ, позвони Ивану завтра, нет, вернее, сегодня вечером" -> "${removeFillerWords ? 'Позвони' : 'Ну, ээ, позвони'} Ивану сегодня вечером."
- "завтра встреча, то есть послезавтра, в десять" -> "Послезавтра встреча в десять."
- "стоит сто евро, то есть около ста десяти долларов" -> "Стоит сто евро, то есть около ста десяти долларов."${dictionaryBlock(dictionary)}`
}

/**
 * Generate prompt for commenting on text.
 * If text is a question, answer it. If statement, provide smart commentary.
 */
export function buildCommentPrompt(): string {
  return `You are a helpful assistant. Analyze the following text and respond appropriately:

- If the text is a QUESTION: Provide a clear, helpful answer
- If the text is a STATEMENT: Provide insightful commentary, context, or additional information
- If the text is CODE: Explain what it does and suggest improvements if applicable
- If the text is a URL or command: Explain its purpose

IMPORTANT RULES:
- Be concise (2-4 sentences for simple queries, more for complex topics)
- Match the language of the input text (respond in the same language)
- Do not repeat the original text back
- Do not add preamble like "Here's my response:" or "Great question!"
- Just provide the answer or commentary directly
- For code, use the same programming language in examples`
}

/**
 * Generate prompt for improving text phrasing.
 * Fix errors and make it sound native and polished.
 */
export function buildImprovePrompt(): string {
  return `You are a professional editor and language expert. Improve the following text:

TASKS:
1. Fix grammatical errors, typos, and punctuation issues
2. Improve phrasing to sound more natural and native
3. Make it more polished while preserving the original meaning

DO NOT CHANGE:
- Code snippets (text in backticks or code blocks)
- Technical terms and abbreviations
- Proper nouns, names, brands
- Quoted text (text in quotes)
- URLs, file paths, commands
- Numbers, dates, measurements

IMPORTANT RULES:
- Preserve the original meaning and intent
- Keep the same language as the input
- Maintain the original tone (formal/informal)
- Return ONLY the improved text, no explanations
- If the text is already good, return it unchanged`
}

/**
 * Generate prompt for summarizing text.
 * Extract key points and condense content.
 */
export function buildSummarizePrompt(): string {
  return `You are a professional summarizer. Summarize the following text:

TASKS:
1. Extract the key points and main ideas
2. Condense the content to ~20-30% of original length
3. Present as a clear, concise summary

FORMAT:
- For short text (1-3 sentences): return 1 sentence
- For medium text: return 2-3 sentences
- For long text: use bullet points (• ) for clarity

IMPORTANT RULES:
- Keep the same language as the input
- Preserve the most important facts, numbers, and conclusions
- Return ONLY the summary, no preamble like "Here's a summary:"
- If the text is already 1-2 sentences, return it unchanged`
}
