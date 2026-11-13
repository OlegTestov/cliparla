/**
 * Screen translation asks for JSON {source, translation}; the result window shows the
 * recognised text in a collapsed "Original" row. A reply that is not JSON is never an error.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { ResultController } = require('../src/renderer/src/result/result-controller')
const { buildTranslationPrompt } = require('../src/shared/gemini-constants')

interface Seen {
  parts: unknown[]
  output?: { responseMimeType: string; responseSchema: { required: string[] } }
}

function service(reply: string, seen: Seen[] = []) {
  return new GeminiTranslationService({
    getApiKey: () => 'k',
    maxAttempts: 1,
    modelFactory: (_k: string, _m: string, _o: unknown, output: Seen['output']) =>
      asModel({
        generateContent: async (parts: unknown[]) => {
          seen.push({ parts, output })
          return { response: { text: () => reply } }
        }
      })
  })
}

const shown = (c: typeof ResultController.prototype) => c.getState()

describe('show the original text', () => {
  it('O1: valid JSON gives the translation and the source; the row starts collapsed', async () => {
    const seen: Seen[] = []
    const reply = JSON.stringify({ source: 'Bonjour\nle monde', translation: 'Hello\nworld' })
    const result = await service(reply, seen).translateScreenshot('IMG', 'English')
    assert.deepEqual(result, { success: true, text: 'Hello\nworld', source: 'Bonjour\nle monde' })
    // one call, asking for structured output
    assert.equal(seen.length, 1)
    assert.equal(seen[0].output?.responseMimeType, 'application/json')
    assert.deepEqual(seen[0].output?.responseSchema.required, ['source', 'translation'])
    assert.match(String(seen[0].parts[0]), /"source"/)

    const c = new ResultController()
    c.start()
    c.complete(result)
    assert.equal(shown(c).original, 'Bonjour\nle monde')
    assert.equal(shown(c).originalOpen, false)
    c.toggleOriginal()
    assert.equal(shown(c).originalOpen, true)
    c.toggleOriginal()
    assert.equal(shown(c).originalOpen, false)
  })

  it('O2: a reply that is not valid JSON is shown whole, without an original row', async () => {
    for (const reply of ['Hola mundo', '{"translation": "cut off', '[1, 2]', '{"other": "x"}']) {
      const result = await service(reply).translateScreenshot('IMG', 'Spanish')
      assert.deepEqual(result, { success: true, text: reply })
      const c = new ResultController()
      c.start()
      c.complete(result)
      assert.equal(shown(c).original, null)
    }
  })

  it('JSON in a code fence is still read; an empty translation is an empty answer', async () => {
    const fenced = '```json\n{"source":"a","translation":"b"}\n```'
    assert.deepEqual(await service(fenced).translateScreenshot('IMG', 'English'), {
      success: true,
      text: 'b',
      source: 'a'
    })
    const empty = await service('{"source":"","translation":" "}').translateScreenshot('IMG', 'x')
    assert.equal(empty.success, false)
    assert.equal(empty.errorCode, 'UNKNOWN')
  })

  it('O3: Copy on the original copies only the source', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'Hello', source: 'Bonjour' })
    const copied: string[] = []
    assert.equal(await c.copyOriginal(async (text: string) => void copied.push(text)), true)
    assert.deepEqual(copied, ['Bonjour'])
  })

  it('O4: a source equal to the translation (same language) hides the row', () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'Hello  world', source: 'Hello world\n' })
    assert.equal(shown(c).original, null)
    c.toggleOriginal()
    assert.equal(shown(c).originalOpen, false)
  })

  it('the row belongs to the translation: AI action results do not show it', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'Hello', source: 'Bonjour' })
    await c.runAction('summarize', async () => ({ success: true, text: 'Hi' }), {
      failed: 'f',
      unexpected: 'u'
    })
    assert.equal(shown(c).original, null)
    c.showTranslation()
    assert.equal(shown(c).original, 'Bonjour')
    c.start()
    assert.equal(shown(c).original, null)
  })

  it('the prompt asks for both fields and keeps the translation rules', () => {
    const prompt = buildTranslationPrompt('German')
    assert.match(prompt, /"source"/)
    assert.match(prompt, /"translation"/)
    assert.match(prompt, /ALWAYS translate the extracted text into German/)
    assert.match(prompt, /\[No text detected in image\]/)
  })

  it('O5: the expanded original has a height cap and the window content scrolls', () => {
    const source = readFileSync(join(__dirname, '../src/renderer/src/result/App.tsx'), 'utf8')
    assert.match(source, /max-h-40 overflow-auto[^"]*"\s*>\s*\{original\}/)
    assert.match(source, /flex-1 p-4 overflow-auto/)
  })
})
