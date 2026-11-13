/**
 * "Copy text": a hotkey opens the same capture overlay; the region's text goes to the
 * clipboard untranslated and a short toast confirms it. No result window.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ipc,
  resetRecorded,
  sentMessages,
  shortcuts,
  shownPages,
  trustedEvent
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'
import { asModel } from './helpers/fake-model'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const { GeminiTranslationService } = require('../src/main/services/translation/gemini-service')
const { registerCaptureHandlers } = require('../src/main/ipc/capture')
const { registerSettingsHandlers } = require('../src/main/ipc/settings')
const { initializeHotkeys } = require('../src/main/core/app-bootstrap')
const { hotkeyManager } = require('../src/main/core/hotkey-manager')
const { startCapture, takeCaptureMode } = require('../src/main/core/capture-gate')
const { showToast } = require('../src/main/services/toast')
const windowManager = require('../src/main/core/window-manager')
const { buildCopyTextPrompt, NO_TEXT_MARKER } = require('../src/shared/gemini-constants')
const store = require('../src/main/services/store')

const SELECTION = { x: 0, y: 0, width: 200, height: 100 }

interface Run {
  service: FakeTranslationService
  clipboard: string[]
  toasts: string[]
}

async function selectInMode(
  mode: 'copyText' | 'translate',
  extract: { success: boolean; text?: string; errorCode?: string; error?: string }
): Promise<Run> {
  const service = new FakeTranslationService({ success: true, text: 'translated' })
  service.extractText = (async (image: string) => {
    service.calls.push({ method: 'extractText', args: [image] })
    return extract
  }) as never
  setTranslationService(service)
  const run: Run = { service, clipboard: [], toasts: [] }
  registerCaptureHandlers({
    fromOverlay: () => true,
    captureScreen: async () => 'IMAGE',
    captureAllowed: () => true,
    writeClipboard: (text: string) => void run.clipboard.push(text),
    toast: (text: string) => void run.toasts.push(text)
  })
  startCapture(
    { status: () => ({ screenRecording: 'granted' }), showOverlay: () => undefined },
    mode
  )
  await ipc.listeners.get('selection-made')!(trustedEvent, SELECTION)
  return run
}

describe('copy text', () => {
  beforeEach(() => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    takeCaptureMode()
  })

  it('C1: the prompt reads the text and does not translate', async () => {
    const prompt = buildCopyTextPrompt()
    assert.match(prompt, /Do not translate/)
    assert.doesNotMatch(prompt, /translate (it|the|them|everything)? ?into|ALWAYS translate/i)
    assert.match(prompt, /line breaks/)
    const seen: unknown[][] = []
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      modelFactory: () =>
        asModel({
          generateContent: async (parts: unknown[]) => {
            seen.push(parts)
            return { response: { text: () => 'Line one\nLine two' } }
          }
        })
    })
    const result = await svc.extractText('IMG')
    assert.deepEqual(result, { success: true, text: 'Line one\nLine two' })
    assert.equal(seen[0][0], prompt)
  })

  it('the no-text marker becomes an empty text, not an error', async () => {
    const svc = new GeminiTranslationService({
      getApiKey: () => 'k',
      maxAttempts: 1,
      modelFactory: () =>
        asModel({
          generateContent: async () => ({ response: { text: () => NO_TEXT_MARKER } })
        })
    })
    assert.deepEqual(await svc.extractText('IMG'), { success: true, text: '' })
  })

  it('C2: the clipboard gets the exact text returned and no result window opens', async () => {
    const text = 'Total:\n  42,00 €\nThank you'
    const run = await selectInMode('copyText', { success: true, text })
    assert.deepEqual(run.service.calls, [{ method: 'extractText', args: ['IMAGE'] }])
    assert.deepEqual(run.clipboard, [text])
    assert.deepEqual(run.toasts, ['Copied'])
    assert.equal(shownPages.includes('result.html'), false)
  })

  it('an empty region says "No text found" and leaves the clipboard alone', async () => {
    const run = await selectInMode('copyText', { success: true, text: '' })
    assert.deepEqual(run.clipboard, [])
    assert.deepEqual(run.toasts, ['No text found'])
  })

  it('errors use the screen-translate error window and copy nothing', async () => {
    const run = await selectInMode('copyText', {
      success: false,
      errorCode: 'NETWORK',
      error: 'Could not reach Google. Check your internet connection.'
    })
    assert.deepEqual(run.clipboard, [])
    assert.deepEqual(run.toasts, [])
    assert.ok(shownPages.includes('result.html'))
    const sent = sentMessages.filter((m) => m.channel === 'translation-complete')
    assert.equal((sent[0].args[0] as { success: boolean }).success, false)
  })

  it('a normal selection still translates', async () => {
    const run = await selectInMode('translate', { success: true, text: 'x' })
    assert.deepEqual(
      run.service.calls.map((c) => c.method),
      ['translateScreenshot']
    )
    assert.deepEqual(run.clipboard, [])
  })

  it('C3: the toast is shown near the cursor and hides itself', async () => {
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    showToast('Copied', 20)
    assert.ok(shownPages.includes('toast.html'))
    assert.ok(sentMessages.some((m) => m.channel === 'toast-show' && m.args[0] === 'Copied'))
    assert.equal(windowManager.isVisible('toast'), true)
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(windowManager.isVisible('toast'), false)
  })

  it('C4: Esc on the overlay cancels with no call and resets the mode', async () => {
    const service = new FakeTranslationService()
    setTranslationService(service)
    registerCaptureHandlers({ fromOverlay: () => true })
    startCapture(
      { status: () => ({ screenRecording: 'granted' }), showOverlay: () => undefined },
      'copyText'
    )
    await ipc.listeners.get('cancel-capture')!(trustedEvent)
    assert.equal(takeCaptureMode(), 'translate')
    assert.deepEqual(service.calls, [])
  })

  it('the hotkey opens the overlay in copy-text mode', () => {
    store.setCaptureShortcut('CommandOrControl+Shift+S')
    store.setDictationShortcut('CommandOrControl+Shift+D')
    hotkeyManager.unregisterAll()
    initializeHotkeys()
    hotkeyManager.setMode('normal')
    shortcuts.registered.get(store.getCopyTextShortcut())!()
    assert.equal(takeCaptureMode(), 'copyText')
    shortcuts.registered.get('CommandOrControl+Shift+S')!()
    assert.equal(takeCaptureMode(), 'translate')
  })

  it('C5: a hotkey that other hotkeys use is refused in Settings; defaults do not collide', async () => {
    hotkeyManager.unregisterAll()
    initializeHotkeys()
    hotkeyManager.setMode('normal')
    registerSettingsHandlers()
    const reply = await ipc.handlers.get('set-shortcut')!(
      trustedEvent,
      'copyText',
      'CommandOrControl+Shift+D'
    )
    assert.equal(reply.ok, false)
    assert.match(reply.error.replace(/[⁦⁩]/g, ''), /already used for voice dictation/)
    assert.equal(hotkeyManager.getAccelerator('copyText'), 'Command+Control+C')
    const accelerators = ['capture', 'dictation', 'pasteLast', 'copyText'].map((type) =>
      hotkeyManager.getAccelerator(type).toLowerCase()
    )
    assert.equal(new Set(accelerators).size, 4)
  })
})
