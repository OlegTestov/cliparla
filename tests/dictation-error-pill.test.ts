/**
 * Dictation errors are shown in the indicator, never in a modal dialog. A usable
 * audio is kept for Retry until the next dictation starts.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  dialogs,
  resetRecorded,
  screenState,
  sentMessages,
  shortcuts
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  retryDictation,
  rejectAudio,
  failRecording,
  isCurrentSession,
  getDictationState
} = require('../src/main/services/dictation')
const { setRetryDelaysForTests } = require('../src/main/services/dictation/speech-retry')
const { resetEscapeShortcutForTests } = require('../src/main/services/dictation/escape-shortcut')
const {
  ERROR_PILL_AUTO_HIDE_MS,
  ERROR_PILL_ESC_MS,
  setErrorPillHover,
  showErrorPill
} = require('../src/main/services/dictation/error-pill')

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm', durationMs: 4000 }
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const errors = (): Array<{ message: string; retry: boolean }> =>
  sentMessages.filter((m) => m.channel === 'listening-mode-error').map((m) => m.args[0] as never)
const channels = (): string[] => sentMessages.map((m) => m.channel)

const failing = (errorCode: string, error: string) =>
  new FakeTranslationService({ success: false, errorCode, error } as never)

async function dictate(service: unknown, data: object = audio): Promise<void> {
  setTranslationService(service)
  startDictation()
  stopListeningAndProcess()
  await handleDictationComplete(data, { paste: async () => {} })
}
const realPlatform = process.platform

setRetryDelaysForTests([]) // these suites test the failure paths, not the schedule
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  cancelDictation()
  resetRecorded()
  resetEscapeShortcutForTests()
  windowManager.registerDefaultWindows()
  windowManager.createAll()
  resetRecorded()
})
afterEach(() => {
  mock.timers.reset()
  cancelDictation()
  screenState.cursor = { x: 0, y: 0 }
  Object.defineProperty(process, 'platform', { value: realPlatform })
})

describe('every dictation error is shown in the indicator', () => {
  const kinds: Array<[string, () => Promise<void>, RegExp, boolean]> = [
    [
      'no audio',
      () => dictate(new FakeTranslationService(), { audioBase64: '', mimeType: 'audio/webm' }),
      /No audio/i,
      false
    ],
    [
      'too large',
      () =>
        dictate(new FakeTranslationService(), {
          audioBase64: 'A'.repeat(7_000_000),
          mimeType: 'audio/webm'
        }),
      /too large/i,
      false
    ],
    [
      'API error',
      () => dictate(failing('QUOTA_EXHAUSTED', 'Your Gemini quota is used up')),
      /quota/i,
      true
    ],
    ['timeout', () => dictate(failing('TIMEOUT', 'The request timed out')), /timed out/i, true],
    ['offline', () => dictate(failing('NETWORK', 'No internet connection')), /internet/i, true],
    [
      'an exception',
      async () => {
        const service = new FakeTranslationService()
        service.translateSpeech = (() => Promise.reject(new Error('boom'))) as never
        await dictate(service)
      },
      /./,
      true
    ]
  ]
  for (const [name, run, text, retry] of kinds) {
    it(`${name}: a message in the pill, Retry ${retry ? 'offered' : 'not offered'}, no dialog`, async () => {
      await run()
      assert.equal(dialogs.length, 0)
      assert.equal(errors().length, 1)
      assert.match(errors()[0].message, text)
      assert.equal(errors()[0].retry, retry)
      assert.equal(getDictationState(), 'idle')
    })
  }

  it('an unusable payload: a local text, not the Google one, and no dialog', () => {
    startDictation()
    let session = 0
    while (!isCurrentSession(session)) session++
    rejectAudio(session)
    assert.equal(dialogs.length, 0)
    assert.match(errors()[0].message, /could not be used/)
    assert.equal(errors()[0].retry, false)
    assert.equal(getDictationState(), 'idle')
  })

  it('a key problem: no card over the setup window; it appears, with Retry, when setup is gone', async () => {
    const service = failing('INVALID_KEY', 'bad key')
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    let opened = 0
    await handleDictationComplete(audio, {
      showSetup: () => {
        opened++
        windowManager.showSetupWindow()
      }
    })
    assert.equal(opened, 1)
    assert.equal(errors().length, 0, 'nothing on top of the setup window')
    assert.ok(channels().includes('listening-mode-stop'), 'the indicator is hidden')
    assert.equal(
      shortcuts.registered.has('Escape'),
      false,
      'Esc is not held while setup is in front'
    )
    assert.equal(getDictationState(), 'idle')

    windowManager.hideSetupWindow() // saved a key, or closed the window: the same
    assert.equal(errors().length, 1)
    assert.equal(errors()[0].retry, true)

    service.translateSpeech = (async () => ({ success: true, text: 'OK' })) as never
    const pasted: string[] = []
    retryDictation({ paste: async (t: string) => void pasted.push(t) })
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(pasted, ['OK'])
  })

  it('a dictation started while setup is open drops the held card', async () => {
    setTranslationService(failing('MISSING_KEY', 'no key'))
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(audio, { showSetup: () => windowManager.showSetupWindow() })
    startDictation()
    cancelDictation()
    windowManager.hideSetupWindow()
    assert.equal(errors().length, 0)
  })

  it('hiding setup with nothing held shows nothing, and the close handler is wired', () => {
    windowManager.hideSetupWindow()
    assert.equal(errors().length, 0)
    const src = readFileSync('src/main/core/window-manager.ts', 'utf8')
    assert.match(src, /notifyBlockingHidden\(config\.type\)/)
  })

  it('no modal error box is left in the dictation path', () => {
    for (const file of [
      'src/main/services/dictation.ts',
      'src/main/ipc/dictation.ts',
      'src/main/services/dictation/error-pill.ts',
      'src/main/services/paste-delivery.ts'
    ]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /showErrorBox/, file)
    }
  })
})

describe('a clip without speech', () => {
  const silent = { ...audio, level: { peak: 0, activeMs: 0 } }

  it('never reaches the model: a "no speech" card with Retry, nothing pasted', async () => {
    const service = new FakeTranslationService()
    const pasted: string[] = []
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(silent, { paste: async (t: string) => void pasted.push(t) })
    assert.equal(service.calls.length, 0)
    assert.deepEqual(pasted, [])
    assert.equal(errors().length, 1)
    assert.match(errors()[0].message, /speech/i)
    assert.equal(errors()[0].retry, true)
  })

  it('Retry sends that audio once, without the level check', async () => {
    const service = new FakeTranslationService()
    const pasted: string[] = []
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(silent, { paste: async (t: string) => void pasted.push(t) })
    assert.equal(service.calls.length, 0)
    retryDictation({ paste: async (t: string) => void pasted.push(t) })
    await flush()
    await flush()
    assert.equal(service.calls.length, 1)
  })

  it('a clip with speech, or one that was not measured, is sent', async () => {
    for (const level of [{ peak: 0.3, activeMs: 1200 }, undefined]) {
      const service = new FakeTranslationService()
      await dictate(service, { ...audio, level })
      assert.equal(service.calls.length, 1)
    }
  })

  it('the prompt tells the model not to invent text', () => {
    const { buildSpeechTranslationPrompt } = require('../src/shared/gemini-constants')
    assert.match(buildSpeechTranslationPrompt('English'), /Never invent/)
    assert.match(buildSpeechTranslationPrompt('English'), /\[No speech detected\]/)
  })
})

describe('Retry', () => {
  it('sends the same audio again; success pastes as usual and closes the card', async () => {
    const service = new FakeTranslationService({
      success: false,
      errorCode: 'TIMEOUT',
      error: 'timed out'
    } as never)
    await dictate(service)
    assert.equal(service.calls.length, 1)
    service.translateSpeech = (async (...args: unknown[]) => {
      service.calls.push({ method: 'translateSpeech', args })
      return { success: true, text: 'TRANSLATED' }
    }) as never
    const pasted: string[] = []
    retryDictation({ paste: async (t: string) => void pasted.push(t) })
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(service.calls.length, 2)
    assert.deepEqual(service.calls[1].args.slice(0, 5), [
      'QVVESU8=',
      'audio/webm',
      service.calls[0].args[2],
      4000,
      31_000 // 30 s + 0.25 s per second of audio
    ])
    assert.deepEqual(pasted, ['TRANSLATED'])
    assert.equal(getDictationState(), 'idle')
    assert.equal(dialogs.length, 0)
  })

  it('a failing retry shows the error again, with Retry', async () => {
    const service = failing('NETWORK', 'No internet connection')
    await dictate(service)
    retryDictation({ paste: async () => {} })
    await flush()
    await flush()
    assert.equal(service.calls.length, 2)
    assert.equal(errors().length, 2)
    assert.equal(errors()[1].retry, true)
  })

  it('a new dictation clears the kept audio', async () => {
    const service = failing('NETWORK', 'No internet connection')
    await dictate(service)
    startDictation()
    let session = 0
    while (!isCurrentSession(session)) session++
    failRecording(session, 'empty') // back to idle without a cancel
    retryDictation({ paste: async () => {} })
    await flush()
    assert.equal(service.calls.length, 1)
  })

  it('does nothing without an error card', async () => {
    const service = new FakeTranslationService()
    setTranslationService(service)
    retryDictation()
    await flush()
    assert.equal(service.calls.length, 0)
    assert.equal(getDictationState(), 'idle')
  })
})

describe('the global Esc on the error card', () => {
  it('is given back after 10 s; the card stays and Retry and Close still work', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const service = failing('NETWORK', 'No internet connection')
    await dictate(service)
    assert.equal(shortcuts.registered.has('Escape'), true)
    mock.timers.tick(ERROR_PILL_ESC_MS - 1)
    assert.equal(shortcuts.registered.has('Escape'), true)
    mock.timers.tick(1)
    assert.equal(shortcuts.registered.has('Escape'), false, 'other apps get Esc back')
    assert.ok(!channels().includes('listening-mode-stop'), 'the card is still there')
    retryDictation({ paste: async () => {} })
    await flush()
    assert.equal(service.calls.length, 2, 'Retry still works')
  })

  it('Close still works after the release', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    await dictate(failing('NETWORK', 'No internet connection'))
    mock.timers.tick(ERROR_PILL_ESC_MS)
    cancelDictation() // the Close button
    assert.ok(channels().includes('listening-mode-stop'))
    assert.equal(shortcuts.registered.has('Escape'), false)
  })
})

describe('an error while a setup window is open', () => {
  it('the Processing pill goes away at once; the card comes when setup closes', async () => {
    windowManager.show('setup')
    await dictate(failing('NETWORK', 'No internet connection'))
    assert.equal(errors().length, 0, 'not over the setup window')
    assert.ok(channels().includes('listening-mode-stop'), 'the page leaves the processing state')
    assert.equal(windowManager.get('listening').isVisible(), false, 'and the pill is hidden')
    assert.equal(shortcuts.registered.has('Escape'), false)
    windowManager.hide('setup')
    assert.equal(errors().length, 1)
    assert.equal(errors()[0].retry, true)
  })
})

describe('a failure after the text was produced', () => {
  it('shows the card without Retry, so the text can never be delivered twice', async () => {
    const service = new FakeTranslationService({ success: true, text: 'HELLO' })
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(audio, {
      paste: async () => {
        throw new Error('fail')
      },
      copy: () => {
        throw new Error('clipboard gone')
      },
      notify: () => {}
    })
    assert.equal(errors().length, 1)
    assert.equal(errors()[0].retry, false)
    retryDictation({ paste: async () => {} })
    await flush()
    assert.equal(service.calls.length, 1, 'no second request')
    assert.equal(dialogs.length, 0)
  })
})

describe('the copied pill and the error card', () => {
  it('a pending copied timer cannot hide an error card that replaced it', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const { showCopiedNotice } = require('../src/main/services/accessibility-hint')
    showCopiedNotice({ reason: 'paste-failed' })
    showErrorPill('card', audio)
    sentMessages.length = 0
    mock.timers.tick(10_000)
    assert.ok(!channels().includes('listening-mode-stop'))
  })
})

describe('hover on the error card', () => {
  it('a hover that arrives right after the card opens holds it past 6 s', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    showErrorPill('no retry here')
    screenState.cursor = { x: 700, y: 780 } // over the card when its 6 s are up
    mock.timers.tick(ERROR_PILL_AUTO_HIDE_MS + 1000)
    assert.ok(!channels().includes('listening-mode-stop'))
    screenState.cursor = { x: 10, y: 10 }
    setErrorPillHover(false)
    assert.ok(channels().includes('listening-mode-stop'))
  })
})

describe('closing the error card', () => {
  it('Esc closes it and releases Esc', async () => {
    await dictate(failing('NETWORK', 'No internet connection'))
    assert.equal(shortcuts.registered.has('Escape'), true)
    shortcuts.registered.get('Escape')!()
    assert.equal(shortcuts.registered.has('Escape'), false)
    assert.ok(channels().includes('listening-mode-stop'))
    assert.equal(retryAvailable(), false)
  })

  it('the Close button (cancel) closes it and releases Esc', async () => {
    await dictate(failing('NETWORK', 'No internet connection'))
    cancelDictation()
    assert.equal(shortcuts.registered.has('Escape'), false)
  })

  it('an error with Retry stays; one without hides after 6 s, but not while hovered', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    await dictate(failing('NETWORK', 'No internet connection'))
    mock.timers.tick(60_000)
    assert.ok(!channels().includes('listening-mode-stop'))
    cancelDictation()
    sentMessages.length = 0

    await dictate(new FakeTranslationService(), { audioBase64: '', mimeType: 'audio/webm' })
    sentMessages.length = 0
    screenState.cursor = { x: 700, y: 780 }
    mock.timers.tick(ERROR_PILL_AUTO_HIDE_MS + 1000)
    assert.ok(!channels().includes('listening-mode-stop'), 'held while hovered')
    screenState.cursor = { x: 10, y: 10 }
    setErrorPillHover(false)
    assert.ok(channels().includes('listening-mode-stop'))
    assert.equal(shortcuts.registered.has('Escape'), false)
  })
})

function retryAvailable(): boolean {
  const service = new FakeTranslationService()
  setTranslationService(service)
  retryDictation({ paste: async () => {} })
  return service.calls.length > 0
}
