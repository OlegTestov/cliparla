/**
 * Esc cancels a dictation. Escape is registered globally only while a dictation
 * is listening or processing, and released on every way out.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { shortcuts } from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  failRecording,
  isCurrentSession,
  getDictationState
} = require('../src/main/services/dictation')
const {
  releaseEscapeShortcut,
  resetEscapeShortcutForTests
} = require('../src/main/services/dictation/escape-shortcut')

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }
const escapeHeld = (): boolean => shortcuts.registered.has('Escape')
const press = (): void => shortcuts.registered.get('Escape')!()

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  cancelDictation()
  shortcuts.taken.clear()
  shortcuts.registered.clear()
  resetEscapeShortcutForTests()
})

describe('Escape during dictation', () => {
  it('is not held while idle', () => {
    assert.equal(escapeHeld(), false)
  })

  it('is held while listening and while processing', () => {
    startDictation()
    assert.equal(escapeHeld(), true)
    stopListeningAndProcess()
    assert.equal(escapeHeld(), true)
    cancelDictation()
  })

  it('Esc while listening cancels: idle, Escape released, no Gemini call', async () => {
    const service = new FakeTranslationService()
    setTranslationService(service)
    startDictation()
    assert.equal(escapeHeld(), true)
    press()
    assert.equal(getDictationState(), 'idle')
    assert.equal(escapeHeld(), false)
    await handleDictationComplete(audio)
    assert.deepEqual(service.calls, [])
  })

  it('Esc while processing cancels and the late result is discarded', async () => {
    let resolve: (r: unknown) => void = () => {}
    const service = new FakeTranslationService()
    service.translateSpeech = (() => new Promise((r) => (resolve = r))) as never
    setTranslationService(service)
    const pasted: string[] = []
    startDictation()
    stopListeningAndProcess()
    const done = handleDictationComplete(audio, { paste: async (t: string) => void pasted.push(t) })
    press()
    assert.equal(getDictationState(), 'idle')
    assert.equal(escapeHeld(), false)
    resolve({ success: true, text: 'LATE' })
    await done
    assert.deepEqual(pasted, [])
  })
})

describe('Escape is released on every exit path', () => {
  it('Cancel button', () => {
    startDictation()
    assert.equal(escapeHeld(), true)
    cancelDictation()
    assert.equal(escapeHeld(), false)
  })

  it('a finished dictation (paste done)', async () => {
    setTranslationService(new FakeTranslationService())
    startDictation()
    stopListeningAndProcess()
    assert.equal(escapeHeld(), true)
    await handleDictationComplete(audio, { paste: async () => {} })
    assert.equal(getDictationState(), 'idle')
    assert.equal(escapeHeld(), false)
  })

  it('copied instead of pasted', async () => {
    setTranslationService(new FakeTranslationService())
    startDictation()
    stopListeningAndProcess()
    assert.equal(escapeHeld(), true)
    await handleDictationComplete(audio, {
      paste: async () => {
        throw new Error('no paste')
      },
      isTrusted: () => true,
      copy: () => {},
      notify: () => {}
    })
    assert.equal(escapeHeld(), false)
  })

  it('a service error: Esc stays on the error card, and closing the card releases it', async () => {
    const service = new FakeTranslationService()
    service.translateSpeech = (() => Promise.reject(new Error('boom'))) as never
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    assert.equal(escapeHeld(), true)
    await handleDictationComplete(audio)
    assert.equal(getDictationState(), 'idle')
    assert.equal(escapeHeld(), true, 'the error card is open')
    press()
    assert.equal(escapeHeld(), false)
  })

  it('a recorder failure in the indicator', () => {
    startDictation()
    failRecording(2_000_000, 'mic') // wrong session: ignored, still held
    assert.equal(escapeHeld(), true)
    cancelDictation()
    startDictation()
    let session = 0
    while (!isCurrentSession(session)) session++
    assert.equal(escapeHeld(), true)
    failRecording(session, 'mic')
    assert.equal(getDictationState(), 'idle')
    assert.equal(escapeHeld(), false)
  })

  it('app quit', () => {
    startDictation()
    assert.equal(escapeHeld(), true)
    releaseEscapeShortcut()
    assert.equal(escapeHeld(), false)
    cancelDictation()
  })
})

describe('Escape taken by another app', () => {
  it('dictation still works and nothing is unregistered later', () => {
    shortcuts.taken.add('Escape')
    startDictation()
    assert.equal(getDictationState(), 'listening')
    assert.equal(escapeHeld(), false)
    cancelDictation()
    assert.equal(getDictationState(), 'idle')
  })
})

describe('Escape after the hotkeys are re-registered', () => {
  it('setMode during a dictation takes Escape again', () => {
    const { hotkeyManager } = require('../src/main/core/hotkey-manager')
    hotkeyManager.initialize({
      capture: { normalCallback: () => {}, protectedCallback: () => {} },
      dictation: { normalCallback: () => {}, protectedCallback: () => {} }
    })
    hotkeyManager.setMode('protected')
    startDictation()
    assert.equal(escapeHeld(), true)
    hotkeyManager.setMode('normal')
    assert.equal(escapeHeld(), true)
    cancelDictation()
    assert.equal(escapeHeld(), false)
    hotkeyManager.unregisterAll()
  })
})

describe('Escape and the capture overlay', () => {
  it('belongs to the overlay while it is on screen, and comes back to the dictation after', () => {
    const windowManager = require('../src/main/core/window-manager')
    startDictation()
    assert.equal(escapeHeld(), true)
    windowManager.show('capture')
    assert.equal(escapeHeld(), false, 'Esc cancels the capture, not the dictation')
    windowManager.hide('capture')
    assert.equal(escapeHeld(), true)
    cancelDictation()
    assert.equal(escapeHeld(), false)
  })
})
