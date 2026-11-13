/**
 * A cancelled dictation must never paste, even when its provider answer
 * arrives while the next dictation is already processing.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation
} = require('../src/main/services/dictation')

describe('dictation sessions', () => {
  it('a cancelled session A does not paste while session B is processing', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    let resolveA: (r: unknown) => void = () => {}
    let resolveB: (r: unknown) => void = () => {}
    const responseA = new Promise((r) => (resolveA = r))
    const responseB = new Promise((r) => (resolveB = r))
    const service = new FakeTranslationService()
    let calls = 0
    service.translateSpeech = (() => (++calls === 1 ? responseA : responseB)) as never
    setTranslationService(service)

    const pasted: string[] = []
    const deps = {
      paste: async (text: string) => {
        pasted.push(text)
      }
    }
    const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }

    startDictation()
    stopListeningAndProcess()
    const a = handleDictationComplete(audio, deps)
    cancelDictation()
    startDictation()
    stopListeningAndProcess()
    const b = handleDictationComplete(audio, deps)

    resolveA({ success: true, text: 'CANCELLED_SESSION_A' })
    await a
    resolveB({ success: true, text: 'CURRENT_SESSION_B' })
    await b

    assert.deepEqual(pasted, ['CURRENT_SESSION_B'])
  })

  it('a cancelled session never pastes when nothing else is running', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    let resolveA: (r: unknown) => void = () => {}
    const service = new FakeTranslationService()
    service.translateSpeech = (() => new Promise((r) => (resolveA = r))) as never
    setTranslationService(service)
    const pasted: string[] = []

    startDictation()
    stopListeningAndProcess()
    const a = handleDictationComplete(
      { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' },
      { paste: async (t: string) => void pasted.push(t) }
    )
    cancelDictation()
    resolveA({ success: true, text: 'LATE' })
    await a
    assert.deepEqual(pasted, [])
  })
})
