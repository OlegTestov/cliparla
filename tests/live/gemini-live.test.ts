/**
 * Live checks against the real Gemini API (K3, D5). Not part of `npm test`: run with
 *   CLIPARLA_LIVE_KEY=<key> npm run test:live
 * Without the key every test is skipped. At most 5 calls in all (K3: 3, D5: 2).
 * The fixtures come from tools/make-live-fixtures.sh.
 */

import '../helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../../src/main/services/translation/gemini-service')
const { KEEP_LANGUAGE } = require('../../src/shared/types')

const key = process.env.CLIPARLA_LIVE_KEY
const skip = key ? false : 'set CLIPARLA_LIVE_KEY to run the live checks'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/speech', name)).toString('base64')

const live = (dictionary: string[] = []) =>
  new GeminiTranslationService({ getApiKey: () => key, getDictionary: () => dictionary })

async function say(name: string, target: string, dictionary: string[] = []): Promise<string> {
  const result = await live(dictionary).translateSpeech(fixture(name), 'audio/wav', target, 8000)
  assert.equal(result.success, true, JSON.stringify(result))
  return result.text as string
}

describe('K3: keep my language (live)', { skip }, () => {
  it('Russian stays Russian, the filler is gone, the correction is applied', async () => {
    const text = await say('keep-ru.wav', KEEP_LANGUAGE)
    console.log('RU:', text)
    assert.match(text, /[а-яё]/i)
    assert.doesNotMatch(text, /[a-z]{3,}/i)
    assert.doesNotMatch(text, /(^|[^а-яё])(ну|э+м?)([^а-яё]|$)/i)
    assert.match(text, /четверг/i)
    assert.doesNotMatch(text, /пятниц/i)
    assert.match(text, /отч[её]т/i)
  })

  it('English stays English, the filler is gone, the correction is applied', async () => {
    const text = await say('keep-en.wav', KEEP_LANGUAGE)
    console.log('EN:', text)
    assert.doesNotMatch(text, /\bum\b/i)
    assert.doesNotMatch(text, /scratch that/i)
    assert.match(text, /Thursday/i)
    assert.doesNotMatch(text, /Friday/i)
    assert.match(text, /report/i)
    assert.match(text, /Anna/)
  })

  it('a translation target still translates (the keep prompt is not used)', async () => {
    const text = await say('keep-ru.wav', 'English')
    console.log('RU->EN:', text)
    assert.doesNotMatch(text, /[а-яё]/i)
  })
})

describe('D5: personal dictionary (live)', { skip }, () => {
  const dictionary = ['Zorvath Quellyn']

  it('a made-up name is spelled as in the dictionary when the language is kept', async () => {
    const text = await say('name-en.wav', KEEP_LANGUAGE, dictionary)
    console.log('keep + dictionary:', text)
    assert.ok(text.includes('Zorvath Quellyn'), text)
  })

  it('and when the speech is translated', async () => {
    const text = await say('name-en.wav', 'German', dictionary)
    console.log('German + dictionary:', text)
    assert.ok(text.includes('Zorvath Quellyn'), text)
  })
})
