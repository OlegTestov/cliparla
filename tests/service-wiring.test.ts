/**
 * Screenshot, dictation and the three text actions must all go through the
 * injected TranslationService, and nothing else in src may talk to a provider.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ipc, resetRecorded, trustedEvent } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { registerResultHandlers } = require('../src/main/ipc/result')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete
} = require('../src/main/services/dictation')

const SELECTION = { x: 0, y: 0, width: 200, height: 100 }

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : [full]
  })
}

describe('service wiring', () => {
  let service: FakeTranslationService

  beforeEach(() => {
    resetRecorded()
    service = new FakeTranslationService()
    setTranslationService(service)
  })

  it('screenshot translation calls the injected service with the image and target language', async () => {
    registerCaptureHandlers({ fromOverlay: () => true, captureScreen: async () => 'IMAGE_BASE64' })
    await ipc.listeners.get('selection-made')!(trustedEvent, SELECTION)
    assert.deepEqual(service.calls, [
      { method: 'translateScreenshot', args: ['IMAGE_BASE64', 'English'] }
    ])
  })

  it('dictation calls the injected service and pastes its text', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const pasted: string[] = []
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(
      { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' },
      { paste: async (text: string) => void pasted.push(text) }
    )
    assert.deepEqual(service.calls, [
      { method: 'translateSpeech', args: ['QVVESU8=', 'audio/webm', 'English'] }
    ])
    assert.deepEqual(pasted, ['translated'])
  })

  it('comment, improve and summarize call the injected service', async () => {
    registerResultHandlers()
    await ipc.handlers.get('comment-text')!(trustedEvent, 'hello')
    await ipc.handlers.get('improve-text')!(trustedEvent, 'hello')
    await ipc.handlers.get('summarize-text')!(trustedEvent, 'hello')
    assert.deepEqual(
      service.calls.map((c) => c.method),
      ['commentText', 'improveText', 'summarizeText']
    )
    assert.ok(service.calls.every((c) => c.args[0] === 'hello'))
  })

  it('rejects empty and oversized text before calling the service', async () => {
    registerResultHandlers()
    const empty = await ipc.handlers.get('comment-text')!(trustedEvent, '')
    const huge = await ipc.handlers.get('improve-text')!(trustedEvent, 'x'.repeat(50_001))
    assert.equal(empty.success, false)
    assert.equal(huge.success, false)
    assert.equal(service.calls.length, 0)
  })
})

describe('provider isolation', () => {
  const files = sourceFiles(join(__dirname, '..', 'src'))

  it('only the Gemini service imports the provider SDK', () => {
    const importers = files.filter((f) => readFileSync(f, 'utf8').includes('@google/genai'))
    assert.deepEqual(
      importers.map((f) => f.split('/src/')[1]),
      ['main/services/translation/gemini-service.ts']
    )
  })

  it('no per-feature key branching is left', () => {
    const banned = /canUseOwnApiKey|getAccessToken|isAuthenticated|ViaProxy|useDirectApi/
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8')))
    assert.deepEqual(hits, [])
  })
})
