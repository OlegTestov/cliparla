/**
 * "Keep my language": the first dictation target, in Settings and in the tray. The speech
 * is transcribed in the spoken language with light cleanup, never translated.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetRecorded, trayMenu } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { setTranslationService } = require('../src/main/services/translation')
const {
  buildKeepLanguageSpeechPrompt,
  buildSpeechTranslationPrompt
} = require('../src/shared/gemini-constants')
const { KEEP_LANGUAGE, SUPPORTED_LANGUAGES } = require('../src/shared/types')
const { dictationChoices } = require('../src/shared/language-choices')
const { createTray, updateTrayMenu } = require('../src/main/services/tray')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation
} = require('../src/main/services/dictation')
const store = require('../src/main/services/store')

type Item = { label?: string; checked?: boolean; enabled?: boolean; click?: () => void }
const items = (): Item[] => trayMenu.items as Item[]

/** The entries of the dictation section of the tray menu */
function dictationSection(): Item[] {
  const all = items()
  const start = all.findIndex((i) => i.label === 'Translate dictation to:')
  const rest = all.slice(start + 1)
  const end = rest.findIndex((i) => i.label === undefined)
  return rest.slice(0, end)
}

function speechService(reply = { success: true, text: 'ok' }) {
  const seen: unknown[][] = []
  const svc = new GeminiTranslationService({
    getApiKey: () => 'k',
    maxAttempts: 1,
    modelFactory: () =>
      asModel({
        generateContent: async (parts: unknown[]) => {
          seen.push(parts)
          return { response: { text: () => reply.text } }
        }
      })
  })
  return { svc, seen }
}

describe('keep my language', () => {
  beforeEach(() => {
    resetRecorded()
    cancelDictation()
    store.saveSettings({
      uiLanguage: 'en',
      preferredLanguage1: 'English',
      preferredLanguage2: 'Spanish',
      preferredLanguage3: 'Not Selected',
      dictationTargetLanguage: 'English'
    })
  })

  it('K1: it is the first entry of the tray voice list, before the preferred languages', () => {
    createTray()
    updateTrayMenu()
    assert.deepEqual(
      dictationSection().map((i) => i.label),
      ['Keep my language', 'English', 'Spanish']
    )
    // The screenshot list does not get it
    const screenshot = items()
      .slice(1, 4)
      .map((i) => i.label)
    assert.equal(screenshot.includes('Keep my language'), false)
  })

  it('K1: choosing it persists and is shown as checked', () => {
    createTray()
    updateTrayMenu()
    dictationSection()[0].click!()
    assert.equal(store.getDictationTargetLanguage(), KEEP_LANGUAGE)
    assert.deepEqual(
      dictationSection().map((i) => i.checked),
      [true, false, false]
    )
    dictationSection()[2].click!()
    assert.equal(store.getDictationTargetLanguage(), 'Spanish')
  })

  it('K1: the voice list is there even without preferred languages', () => {
    store.saveSettings({ preferredLanguage1: 'Not Selected', preferredLanguage2: 'Not Selected' })
    updateTrayMenu()
    assert.deepEqual(
      dictationSection().map((i) => i.label),
      ['Keep my language']
    )
  })

  it('K1: Settings lists it first, and it exists in every language', () => {
    assert.deepEqual(dictationChoices(['English', 'Spanish']), [
      KEEP_LANGUAGE,
      'English',
      'Spanish'
    ])
    assert.deepEqual(dictationChoices([KEEP_LANGUAGE, 'English']), [KEEP_LANGUAGE, 'English'])
    const app = readFileSync(join(__dirname, '../src/renderer/src/settings/App.tsx'), 'utf8')
    assert.match(app, /leading=\{\{ value: KEEP_LANGUAGE/)
    const select = readFileSync(
      join(__dirname, '../src/renderer/src/settings/components/LanguageSelect.tsx'),
      'utf8'
    )
    assert.ok(select.indexOf('leading &&') < select.indexOf('SUPPORTED_LANGUAGES.map'))
  })

  it('K2: the prompt names no target language and carries the keep rules', () => {
    const prompt = buildKeepLanguageSpeechPrompt()
    for (const { name } of SUPPORTED_LANGUAGES) {
      assert.equal(prompt.includes(name.split(' ')[0]), false, `mentions ${name}`)
    }
    assert.match(prompt, /never translate/i)
    assert.match(prompt, /punctuation/)
    assert.match(prompt, /filler/)
    assert.match(prompt, /scratch that/)
    assert.match(prompt, /нет, вернее/)
    assert.match(prompt, /Never summarise/)
    for (const phrase of [
      'ээ',
      'эм',
      'ну',
      'как бы',
      'um',
      'uh',
      'то есть',
      'scratch that',
      'нет, вернее'
    ])
      assert.ok(prompt.includes(phrase), phrase)
    assert.match(prompt, /EXAMPLES/)
    assert.match(prompt, /only when the later words REPLACE the earlier ones/)
    assert.match(prompt, /often clarify instead of correct/)
    assert.ok(
      prompt.includes(
        '"стоит сто евро, то есть около ста десяти долларов" -> "Стоит сто евро, то есть около ста десяти долларов."'
      )
    )
    assert.match(prompt, /illustrations only; never output them/)
    assert.match(prompt, /keep only the corrected version/)
    assert.match(prompt, /Never invent/)
    assert.match(prompt, /\[No speech detected\]/)
  })

  it('K2: the service uses the keep prompt for it and the translation prompt otherwise', async () => {
    const keep = speechService()
    await keep.svc.translateSpeech('QQ==', 'audio/webm', KEEP_LANGUAGE)
    assert.equal(keep.seen[0][0], buildKeepLanguageSpeechPrompt())
    const german = speechService()
    await german.svc.translateSpeech('QQ==', 'audio/webm', 'German')
    assert.equal(german.seen[0][0], buildSpeechTranslationPrompt('German'))
  })

  it('K2: "no speech" still ends as a retryable noSpeech result', async () => {
    const { svc } = speechService({ success: true, text: '[No speech detected]' })
    const result = await svc.translateSpeech('QQ==', 'audio/webm', KEEP_LANGUAGE)
    assert.equal(result.noSpeech, true)
  })

  it('the dictation flow is unchanged: the silence gate holds and the text is delivered', async () => {
    store.setDictationTargetLanguage(KEEP_LANGUAGE)
    const service = new FakeTranslationService({ success: true, text: 'Hola, mundo.' })
    setTranslationService(service)
    const pasted: string[] = []
    const deps = { isTrusted: () => true, paste: async (t: string) => void pasted.push(t) }
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(
      { audioBase64: 'QVVESU8=', mimeType: 'audio/webm', level: { peak: 0, activeMs: 0 } },
      deps
    )
    assert.deepEqual(service.calls, []) // silent clip: nothing sent
    cancelDictation()
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete({ audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }, deps)
    assert.deepEqual(service.calls[0].args.slice(2), [KEEP_LANGUAGE])
    assert.deepEqual(pasted, ['Hola, mundo.'])
  })
})
