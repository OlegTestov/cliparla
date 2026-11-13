/**
 * Batch 3 item 1: the service talks to `@google/genai`, keeps its prompts byte for byte,
 * and maps the new SDK's errors to the same codes.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ApiError } from '@google/genai'
import { streamingModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const c = require('../src/shared/gemini-constants')
const { classifyError } = require('../src/main/services/translation/errors')
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')

const root = join(__dirname, '..')
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : [full]
  })

describe('G1: every call site uses @google/genai', () => {
  const OLD = '@google/generative-ai'

  it('the old package is imported nowhere and is not a dependency', () => {
    const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'tools'))]
    assert.deepEqual(
      files.filter((f) => readFileSync(f, 'utf8').includes(OLD)),
      []
    )
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies[OLD], undefined)
    assert.match(pkg.dependencies['@google/genai'], /^\d+\.\d+\.\d+$/, 'pinned to an exact version')
  })

  it('all five features reach the model through one service', () => {
    const files = sourceFiles(join(root, 'src')).filter((f) =>
      readFileSync(f, 'utf8').includes("from '@google/genai'")
    )
    assert.deepEqual(
      files.map((f) => f.split('/src/')[1]),
      ['main/services/translation/gemini-service.ts']
    )
  })
})

describe('G2: prompts match their deliberately frozen bytes', () => {
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
  const names = ['Zorvath Quellin', 'Ωmega']
  const expected: Record<string, [string, string]> = {
    translation: [
      c.buildTranslationPrompt('Spanish'),
      '26c5ff0f338eea9531bec21e479dcef487362b840a06b4bfd6f3af118fc27c52'
    ],
    translationDict: [
      c.buildTranslationPrompt('Spanish', names),
      'ee50d44f2f8711074602d0eb76523d1976e75f5edb03f463d84b637ca166e0ed'
    ],
    copyText: [
      c.buildCopyTextPrompt(),
      'a87fa2c391bf5b17880bb040f7be888eacfa3018a578c797637421697a261088'
    ],
    copyTextDict: [
      c.buildCopyTextPrompt(names),
      '9850397178063f292794da71bd7ef113b9244d1ba511a6d6946f7052c545d983'
    ],
    speech: [
      c.buildSpeechTranslationPrompt('German'),
      // Filler removal now defaults ON in translation modes: add the shared rule.
      '1f3edeabaaf5e8a7dc6ffbbe4d9fa9f6a943fb345f0a30712120d666bce697f7'
    ],
    speechDict: [
      c.buildSpeechTranslationPrompt('German', names),
      // The same new filler rule; dictionary bytes are unchanged.
      'ffc2c6bee214b2aedb7f60c4a3d05e7c5d20fdcd1eeebf586f2c04199ad7c126'
    ],
    keepLanguage: [
      c.buildKeepLanguageSpeechPrompt(),
      // Share the rule with translations, adding э-э/типа and the meaning safeguard.
      'c4fe82cd32bff48b7b1ebdb169d57e7196aa90e1ecce1c092ebee7af235db629'
    ],
    keepLanguageDict: [
      c.buildKeepLanguageSpeechPrompt(names),
      // The same shared filler rule; dictionary bytes are unchanged.
      '0481d59c57b698a3091253559c7ef91f2f96884ebbc26910507ffdd60f781f69'
    ],
    comment: [
      c.buildCommentPrompt(),
      '45bdb055cac8e08c6010b91aabad23b089f6c3fab7cd961066861280d346282e'
    ],
    improve: [
      c.buildImprovePrompt(),
      '94d059ad9601d698aa8b11b6ec04b0ee96632ba87aee9e6165c5b405d7dfaac5'
    ],
    summarize: [
      c.buildSummarizePrompt(),
      'dd4b5abe2cf1a47e870ea8e33833114c0cbb0cc49545c755f7f690814058a0c0'
    ]
  }

  for (const [name, [prompt, hash]] of Object.entries(expected)) {
    it(`${name} prompt hash`, () => assert.equal(sha(prompt), hash))
  }

  it('the service sends the prompt as the first part, unchanged', async () => {
    const sent: unknown[][] = []
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      modelFactory: () => ({
        ...streamingModel([{ text: 'ok' }]),
        generateContentStream: async (parts: unknown[]) => {
          sent.push(parts)
          return (async function* () {
            yield { text: 'ok' }
          })()
        }
      })
    })
    await svc.commentText('hello')
    assert.equal(sha(sent[0][0] as string), expected.comment[1])
    assert.equal(sent[0][1], 'hello')
  })
})

describe('G3: SDK errors map to the same codes', () => {
  const api = (status: number, message: string): Error => new ApiError({ status, message })
  const body = (status: number, text: string, code: string): string =>
    JSON.stringify({ error: { code: status, message: text, status: code } })

  const table: Array<[string, unknown, string]> = [
    [
      'bad key (400)',
      api(400, body(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT')),
      'INVALID_KEY'
    ],
    [
      'expired key',
      api(400, body(400, 'API key expired. Please renew the API key.', 'INVALID_ARGUMENT')),
      'INVALID_KEY'
    ],
    ['403', api(403, body(403, 'denied', 'PERMISSION_DENIED')), 'INVALID_KEY'],
    ['401', api(401, body(401, 'unauthenticated', 'UNAUTHENTICATED')), 'INVALID_KEY'],
    [
      '429',
      api(429, body(429, 'Resource has been exhausted', 'RESOURCE_EXHAUSTED')),
      'QUOTA_EXHAUSTED'
    ],
    [
      'bad request',
      api(400, body(400, 'Request contains an invalid argument.', 'INVALID_ARGUMENT')),
      'INVALID_REQUEST'
    ],
    ['server error', api(500, body(500, 'Internal error', 'INTERNAL')), 'UNKNOWN'],
    ['503', api(503, body(503, 'The model is overloaded', 'UNAVAILABLE')), 'UNKNOWN'],
    ['blocked reply', new Error('Response blocked by the safety filters (SAFETY)'), 'BLOCKED'],
    ['abort (timeout)', new DOMException('This operation was aborted', 'AbortError'), 'TIMEOUT'],
    [
      'undici abort',
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      'TIMEOUT'
    ],
    ['offline', new TypeError('fetch failed'), 'NETWORK']
  ]
  for (const [name, error, code] of table) {
    it(`${name} is ${code}`, () => assert.equal(classifyError(error).errorCode, code))
  }

  it('a blocked prompt (empty text plus a block reason) becomes BLOCKED, not an empty reply', async () => {
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      modelFactory: () => streamingModel([{ blocked: 'SAFETY' }])
    })
    const result = await svc.commentText('x')
    assert.equal(result.errorCode, 'BLOCKED')
  })

  it('a request aborted by its own deadline is a TIMEOUT and the request is told to stop', async () => {
    let signal: AbortSignal | undefined
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      deadlineMs: 20,
      modelFactory: () => ({
        generateContent: async () => ({}),
        generateContentStream: (_p: unknown, s: AbortSignal) => {
          signal = s
          return new Promise(() => undefined)
        }
      })
    })
    const result = await svc.commentText('x')
    assert.equal(result.errorCode, 'TIMEOUT')
    assert.equal(signal?.aborted, true)
  })
})
