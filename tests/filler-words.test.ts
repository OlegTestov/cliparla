import './helpers/electron-stub'
import './helpers/with-indicator'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const store = require('../src/main/services/store')
const prompts = require('../src/shared/gemini-constants')
const { KEEP_LANGUAGE } = require('../src/shared/types')
const { dictionaryBlock } = require('../src/shared/dictionary')
const { registerSettingsHandlers } = require('../src/main/ipc/settings')
const translation = require('../src/main/services/translation')
const dictation = require('../src/main/services/dictation')
const { setRetryDelaysForTests } = require('../src/main/services/dictation/speech-retry')

const targets = [KEEP_LANGUAGE, 'Russian', 'Spanish']
const initialDefault = store.getAllSettings().removeFillerWords
const build = (target: string, enabled: boolean, dictionary: string[] = []): string =>
  target === KEEP_LANGUAGE
    ? prompts.buildKeepLanguageSpeechPrompt(dictionary, enabled)
    : prompts.buildSpeechTranslationPrompt(target, dictionary, enabled)

describe('remove filler words', () => {
  beforeEach(() => {
    resetRecorded()
    dictation.cancelDictation()
    store.saveSettings({ uiLanguage: 'en', removeFillerWords: true })
    setRetryDelaysForTests([])
  })

  afterEach(() => {
    dictation.cancelDictation()
    mock.restoreAll()
    setRetryDelaysForTests()
  })

  it('F1: defaults ON; an existing settings record missing the key also reads ON', () => {
    assert.equal(initialDefault, true)
    assert.equal(store.getAllSettings().removeFillerWords, true)
    assert.equal(store.getRemoveFillerWords(), true)
    // Model an old settings record without touching a real settings file.
    store.store.delete('removeFillerWords')
    assert.equal(store.getRemoveFillerWords(), true)
    assert.equal(store.getAllSettings().removeFillerWords, true)
    store.saveSettings({ removeFillerWords: false })
    assert.equal(store.getRemoveFillerWords(), false)
    store.saveSettings({ preferredLanguage1: 'Russian' })
    assert.equal(store.getRemoveFillerWords(), false, 'existing OFF survives other saves')
  })

  it('F2: ON includes exactly one shared rule in keep and two translation targets', () => {
    const rule = prompts.REMOVE_FILLER_WORDS_RULE
    assert.equal(typeof rule, 'string')
    for (const word of ['um', 'uh', 'er', 'э-э', 'эм', 'ну', 'типа']) {
      assert.ok(rule.includes(`"${word}"`), word)
    }
    assert.match(rule, /[Nn]ever remove words that carry meaning/)
    for (const target of targets) {
      const prompt = build(target, true)
      assert.equal(prompt.split(rule).length - 1, 1, target)
      assert.equal(
        build(target, true),
        target === KEEP_LANGUAGE
          ? prompts.buildKeepLanguageSpeechPrompt()
          : prompts.buildSpeechTranslationPrompt(target)
      )
    }
  })

  it('F3: OFF keeps spoken fillers, punctuation and self-corrections; dictionary bytes stay intact', () => {
    // OFF translation is byte-identical to the prompt before the filler toggle feature.
    assert.equal(
      createHash('sha256').update(build('German', false)).digest('hex'),
      'ad7d65a9ee4d1ef3c56bd29f74ee2cbba69aec0d0298429a31e2005b323d13d8'
    )
    for (const target of targets) {
      const off = build(target, false)
      assert.ok(!off.includes(prompts.REMOVE_FILLER_WORDS_RULE), target)
      assert.doesNotMatch(off, /Remove filler|drop it|fillers.*removed/i)
      const terms = ['Zorvath Quellin', 'say "hello"']
      for (const enabled of [true, false]) {
        assert.equal(build(target, enabled, terms), build(target, enabled) + dictionaryBlock(terms))
      }
    }
    const off = build(KEEP_LANGUAGE, false)
    assert.match(off, /Transcribe filler sounds and words as spoken/)
    assert.match(off, /Add punctuation/)
    assert.match(off, /Apply spoken self-corrections only when the later words REPLACE/)
    assert.match(off, /often clarify instead of correct/)
    assert.match(off, /Never summarise/)
    assert.ok(
      off.includes('"um, call Peter at nine, scratch that, at ten" -> "Um, call Peter at ten."')
    )
    assert.ok(off.includes('-> "Ну, ээ, позвони Ивану сегодня вечером."'))
  })

  it('F5: all 16 locales translate both strings within label/hint length budgets', () => {
    const dir = join(__dirname, '../src/renderer/src/i18n/locales')
    const files = readdirSync(dir).filter((file) => file.endsWith('.json'))
    assert.equal(files.length, 16)
    const keys = ['settings.voice.removeFillerWords', 'settings.voice.removeFillerWordsHint']
    const english = [
      'Remove filler words',
      'Drops um, uh and similar sounds. Never changes the meaning.'
    ]
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      keys.forEach((key, i) => {
        const text = locale[key]
        assert.equal(typeof text, 'string', `${file}:${key}`)
        assert.ok(
          text.trim().length > 0 && text.length <= [40, 100][i],
          `${file}:${key}: ${text.length}`
        )
        assert.doesNotMatch(text, /[\r\n]/)
        if (file === 'en.json') assert.equal(text, english[i])
        else assert.notEqual(text, english[i], `${file}:${key} needs a real translation`)
      })
    }
  })

  it('F6: the production service reads changes on the next dictation and at kept-audio Retry', async () => {
    assert.equal(typeof prompts.REMOVE_FILLER_WORDS_RULE, 'string')
    const seen: unknown[][] = []
    let fail = false
    // Keep the production singleton and its store wiring; only replace outbound model IO.
    const service = translation.getTranslationService()
    mock.method(service, 'getApiKey', () => 'fake-key')
    mock.method(service, 'modelFactory', () =>
      asModel({
        generateContent: async (parts: unknown[]) => {
          seen.push(parts)
          return { response: { text: () => (fail ? '' : 'dictated text') } }
        }
      })
    )
    registerSettingsHandlers()
    const save = (enabled: boolean) =>
      ipc.handlers.get('save-settings')!(trustedEvent, { removeFillerWords: enabled })
    const audio = { audioBase64: 'QQ==', mimeType: 'audio/webm' }
    const deps = { isTrusted: () => true, paste: async () => {} }
    const dictate = async () => {
      dictation.startDictation()
      dictation.stopListeningAndProcess()
      await dictation.handleDictationComplete(audio, deps)
    }
    for (const target of targets) {
      store.setDictationTargetLanguage(target)
      for (const enabled of [true, false, true]) {
        await save(enabled)
        const count = seen.length
        await dictate()
        assert.equal(seen.length, count + 1, target)
        assert.equal(seen.at(-1)![0], build(target, enabled))
        assert.equal(String(seen.at(-1)![0]).includes(prompts.REMOVE_FILLER_WORDS_RULE), enabled)
      }
      for (const enabled of [false, true]) {
        await save(!enabled)
        fail = true
        await dictate()
        const count = seen.length
        await save(enabled)
        fail = false
        dictation.retryDictation(deps)
        for (let i = 0; i < 20 && dictation.getDictationState() !== 'idle'; i++) {
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        assert.equal(dictation.getDictationState(), 'idle')
        assert.equal(seen.length, count + 1, `${target}: Retry sends the kept recording`)
        assert.equal(
          seen.at(-1)![0],
          build(target, enabled),
          `${target}: Retry reads the new value`
        )
        assert.deepEqual(seen.at(-1)![1], {
          inlineData: { mimeType: audio.mimeType, data: audio.audioBase64 }
        })
      }
    }
  })
})
