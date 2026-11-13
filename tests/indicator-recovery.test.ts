/**
 * One readiness gate for the indicator page, and one store for kept audio. Each scenario here
 * was a way to lose a dictation, show a card nobody could read, or leave the app silent.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  appState,
  ipc,
  notifications,
  pageState,
  resetRecorded,
  screenState,
  sentMessages,
  shortcuts,
  trustedEvent
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const {
  watchIndicator,
  MAX_RELOADS,
  RELOAD_SETTLE_TIMEOUT_MS,
  RELOAD_WINDOW_MS,
  FIRST_LOAD_TIMEOUT_MS
} = require('../src/main/services/dictation/indicator-gate')
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  retryDictation,
  cancelDictation,
  getDictationState,
  resetIndicatorNoticesForTests
} = require('../src/main/services/dictation')
const { ERROR_PILL_ESC_MS, showErrorPill } = require('../src/main/services/dictation/error-pill')
const { KEPT_AUDIO_MAX_AGE_MS, keptAudio } = require('../src/main/services/dictation/kept-audio')
const {
  cancelCopiedIndicator,
  showCopiedNotice
} = require('../src/main/services/accessibility-hint')
const { clearWatchdogForTests } = require('../src/main/services/dictation/watchdog')
const { setRetryDelaysForTests } = require('../src/main/services/dictation/speech-retry')
const { resetEscapeShortcutForTests } = require('../src/main/services/dictation/escape-shortcut')

// ---- the gate on its own, with a fake page and fake time -------------------------------------

function fakePage() {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {}
  let reloads = 0
  return {
    on: (e: string, l: () => void) => void (listeners[e] ??= []).push(l),
    reload: () => void reloads++,
    isDestroyed: () => false,
    emit: (e: string, ...args: unknown[]) => (listeners[e] ?? []).forEach((l) => l({}, ...args)),
    reloads: () => reloads
  }
}

function fakeClock() {
  let t = 0
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => t,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = next++
        timers.set(id, { at: t + ms, fn })
        return id
      },
      clearTimeout: (id: unknown) => void timers.delete(id as number)
    },
    advance: (ms: number) => {
      const target = t + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        t = due[1].at
        due[1].fn()
      }
      t = target
    }
  }
}

describe('the readiness gate', () => {
  const crash = { reason: 'crashed' }
  const make = (quitting = false) => {
    const page = fakePage()
    const clock = fakeClock()
    const log: string[] = []
    const gate = watchIndicator(
      page,
      () => ({
        onNotReady: () => void log.push('notready'),
        onGone: () => void log.push('gone'),
        onReady: () => void log.push('ready'),
        onDead: () => void log.push('dead')
      }),
      { now: clock.now, timers: clock.timers, isQuitting: () => quitting }
    )
    // A whole successful load: it starts, finishes, and the renderer says it listens
    const up = (): void => {
      page.emit('did-start-loading')
      page.emit('did-finish-load')
      gate.pageReady()
    }
    return { page, clock, log, gate, up }
  }

  it('is ready only when the page says it listens, not when the load finished', () => {
    const { page, gate, log } = make()
    assert.equal(gate.isReady(), false)
    assert.equal(gate.request(), 'loading')
    page.emit('did-start-loading')
    page.emit('did-finish-load')
    assert.equal(gate.isReady(), false, 'a finished load is not enough')
    gate.pageReady()
    assert.equal(gate.isReady(), true)
    assert.equal(gate.request(), 'ready')
    assert.deepEqual(log, ['ready'])
  })

  it('a crash makes it not ready at once, and a reload that started is still not ready', () => {
    const { page, gate, up } = make()
    up()
    page.emit('render-process-gone', crash)
    assert.equal(gate.isReady(), false)
    assert.equal(page.reloads(), 1)
    assert.equal(gate.request(), 'loading', 'reload() started but nothing has loaded')
    up()
    assert.equal(gate.isReady(), true)
  })

  it('a failed load or a reload that does not settle in 15 s stays not ready and tells the user once', () => {
    const { page, clock, gate, log, up } = make()
    up()
    page.emit('render-process-gone', crash)
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS)
    assert.equal(gate.isReady(), false)
    assert.deepEqual(
      log.filter((l) => l === 'dead'),
      ['dead']
    )
    page.emit('render-process-gone', crash)
    page.emit('did-fail-load')
    assert.deepEqual(
      log.filter((l) => l === 'dead'),
      ['dead'],
      'still the same episode'
    )
  })

  it('a dead page is reloaded by the next request while the cap allows', () => {
    const { page, clock, gate, up } = make()
    up()
    page.emit('render-process-gone', crash)
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS) // dead
    assert.equal(gate.request(), 'loading')
    assert.equal(page.reloads(), 2)
  })

  it('crash 3 while reload 2 is pending: capped, one notice, the stale timeout cannot clear it', () => {
    const { page, clock, gate, log, up } = make()
    up()
    for (let i = 0; i < MAX_RELOADS + 1; i++) page.emit('render-process-gone', crash)
    assert.equal(page.reloads(), MAX_RELOADS)
    assert.deepEqual(
      log.filter((l) => l === 'dead'),
      ['dead']
    )
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS + 1)
    assert.deepEqual(
      log.filter((l) => l === 'dead'),
      ['dead'],
      'no second notice'
    )
    assert.equal(gate.request(), 'dead')
    assert.equal(page.reloads(), MAX_RELOADS, 'the cap still holds')
    clock.advance(60_000)
    assert.equal(page.reloads(), MAX_RELOADS + 1, 'the one deferred reload')
  })

  it('a crash while ready reports "not ready" before "gone"', () => {
    const { page, log, up } = make()
    up()
    page.emit('render-process-gone', crash)
    assert.deepEqual(log, ['ready', 'notready', 'gone'])
  })

  it('a cancelled load (-3) or a failing sub-frame is not a failed page; a real failure is', () => {
    const { page, gate, log, up } = make()
    up()
    page.emit('render-process-gone', crash)
    page.emit('did-start-loading')
    page.emit('did-fail-load', -3, 'ERR_ABORTED', 'file:///x', true)
    page.emit('did-fail-load', -6, 'ERR_FILE_NOT_FOUND', 'file:///x', false)
    assert.ok(!log.includes('dead'))
    assert.equal(gate.request(), 'loading')
    page.emit('did-fail-load', -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true)
    assert.ok(log.includes('dead'))
  })

  it('the first load gets 30 s and its failure is not announced', () => {
    const { clock, gate, log } = make()
    clock.advance(FIRST_LOAD_TIMEOUT_MS - 1)
    assert.equal(gate.request(), 'loading')
    clock.advance(1)
    assert.equal(gate.isReady(), false)
    assert.deepEqual(log, [], 'no restart notice for a cold start')
  })

  it('a failed first load is not announced either, but a failed reload is', () => {
    const { page, gate, log, clock } = make()
    page.emit('did-start-loading')
    page.emit('did-fail-load', -6, 'ERR', 'file:///x', true)
    assert.deepEqual(log, [])
    assert.equal(gate.request(), 'loading', 'the hotkey reloads it')
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS)
    assert.deepEqual(log, ['dead'])
  })

  it('a "page ready" from the old page is ignored until the new load has started', () => {
    const { page, gate, up } = make()
    up()
    page.emit('render-process-gone', crash)
    gate.pageReady() // a late message of the page that just died
    assert.equal(gate.isReady(), false)
    page.emit('did-start-loading')
    gate.pageReady()
    assert.equal(gate.isReady(), true)
  })

  it('the restart notice comes again only after the page stayed up for a whole minute', () => {
    const { page, clock, log, up } = make()
    const dead = (): number => log.filter((l) => l === 'dead').length
    up()
    page.emit('render-process-gone', crash)
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS) // first episode: notice
    assert.equal(dead(), 1)
    up()
    clock.advance(30_000) // up for only half a minute
    page.emit('render-process-gone', crash)
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS)
    assert.equal(dead(), 1, 'the same episode')
    up()
    clock.advance(RELOAD_WINDOW_MS + 1) // stable for a minute
    page.emit('render-process-gone', crash)
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS)
    assert.equal(dead(), 2, 'a new episode')
  })

  it('a navigation of a ready page makes it not ready and gives the new load 15 s', () => {
    const { page, gate, log, up, clock } = make()
    up()
    page.emit('did-start-loading')
    assert.equal(gate.isReady(), false)
    assert.deepEqual(log, ['ready', 'notready', 'gone'], 'a running dictation is ended too')
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS)
    assert.ok(log.includes('dead'))
  })

  it('a failure after the first failed load is announced (it is a reload now)', () => {
    const { page, gate, log } = make()
    page.emit('did-start-loading')
    page.emit('did-fail-load', -6, 'ERR', 'file:///x', true)
    assert.deepEqual(log, [])
    gate.request() // reload
    page.emit('did-start-loading')
    page.emit('did-fail-load', -6, 'ERR', 'file:///x', true)
    assert.deepEqual(log, ['dead'])
  })

  it('a page that cannot render is handled like a crash: not ready, reloaded', () => {
    const { page, gate, log, up } = make()
    up()
    gate.pageBroken()
    assert.deepEqual(log, ['ready', 'notready', 'gone'])
    assert.equal(page.reloads(), 1)
    assert.equal(gate.isReady(), false)
  })

  it('a clean exit, a destroyed page and a quitting app are not recovered', () => {
    const { page, log } = make()
    page.emit('render-process-gone', { reason: 'clean-exit' })
    assert.equal(page.reloads(), 0)
    const quitting = make(true)
    quitting.page.emit('render-process-gone', crash)
    quitting.clock.advance(120_000)
    assert.equal(quitting.page.reloads(), 0)
    assert.deepEqual(quitting.log, [])
    assert.deepEqual(log, [])
  })

  it('no notice and no reload once quit begins, even for a pending timeout', () => {
    let quitting = false
    const page = fakePage()
    const clock = fakeClock()
    const log: string[] = []
    watchIndicator(
      page,
      () => ({
        onGone: () => undefined,
        onReady: () => undefined,
        onDead: () => void log.push('dead')
      }),
      {
        now: clock.now,
        timers: clock.timers,
        isQuitting: () => quitting
      }
    )
    page.emit('render-process-gone', crash)
    quitting = true
    clock.advance(RELOAD_SETTLE_TIMEOUT_MS + 1)
    assert.deepEqual(log, [])
  })
})

// ---- the app: gate, cards and kept audio together -----------------------------------------

const audio = { audioBase64: 'QUJD', mimeType: 'audio/webm', durationMs: 7000 }
const crash = (): void => pageState.crash()
const loaded = (): void => pageState.load()
const cards = (): Array<{ message: string; retry: boolean }> =>
  sentMessages.filter((m) => m.channel === 'listening-mode-error').map((m) => m.args[0] as never)
const failing = (): InstanceType<typeof FakeTranslationService> =>
  new FakeTranslationService({ success: false, errorCode: 'NETWORK', error: 'offline' } as never)
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function failOnce(service = failing(), showSetup?: () => void): Promise<void> {
  setTranslationService(service)
  startDictation()
  stopListeningAndProcess()
  await handleDictationComplete(audio, { paste: async () => {}, showSetup })
}

const realPlatform = process.platform

setRetryDelaysForTests([]) // these scenarios test the failure paths, not the schedule
describe('indicator crashes in the app', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    cancelDictation()
    resetRecorded()
    resetEscapeShortcutForTests()
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    resetRecorded()
    pageState.autoLoadOnReload = false // each test says when the page is back
    resetIndicatorNoticesForTests()
    appState.hidden = false
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  afterEach(() => {
    cancelCopiedIndicator() // its timer must not outlive the mocked clock
    mock.timers.reset()
    cancelDictation()
    clearWatchdogForTests()
    screenState.cursor = { x: 0, y: 0 }
    Object.defineProperty(process, 'platform', { value: realPlatform })
  })

  it('1. a reload that never settles, then the hotkey: no dictation, no Esc held', () => {
    crash()
    mock.timers.tick(RELOAD_SETTLE_TIMEOUT_MS)
    startDictation()
    startDictation() // reload() has started but nothing has loaded: still not ready
    assert.equal(getDictationState(), 'idle')
    assert.equal(shortcuts.registered.has('Escape'), false)
    assert.equal(pageState.reloads, 2, 'the hotkey started one fresh reload')
  })

  it('2. a key-error card held for setup, a crash, setup closed during the reload: the card comes after the page', async () => {
    await failOnce(
      new FakeTranslationService({
        success: false,
        errorCode: 'INVALID_KEY',
        error: 'bad key'
      } as never),
      () => windowManager.showSetupWindow()
    )
    assert.equal(cards().length, 0, 'not over the setup window')
    crash()
    windowManager.hideSetupWindow() // closed while the page reloads
    assert.equal(cards().length, 0, 'nothing before the page is back')
    loaded()
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, true)
  })

  it('3. a crash while a Retry card is open: the card is back with Retry after the reload', async () => {
    await failOnce()
    assert.equal(cards().length, 1)
    crash()
    assert.equal(cards().length, 1, 'nothing new until the page is back')
    loaded()
    assert.equal(cards().length, 2)
    assert.equal(cards()[1].retry, true)
  })

  it('4. a crash during processing that hits the cap: Retry with that audio after the deferred reload', async () => {
    crash()
    loaded()
    crash()
    loaded()
    const service = new FakeTranslationService()
    service.translateSpeech = (() => new Promise(() => undefined)) as never
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    void handleDictationComplete(audio)
    await flush()
    crash() // the third in a minute
    assert.equal(notifications.length, 1)
    assert.equal(cards().length, 0)
    mock.timers.tick(60_001)
    assert.equal(pageState.reloads, 3)
    loaded()
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, true)

    const second = new FakeTranslationService()
    const seen: unknown[][] = []
    second.translateSpeech = (async (...args: unknown[]) => {
      seen.push(args)
      return { success: true, text: 'OK' }
    }) as never
    setTranslationService(second)
    retryDictation({ paste: async () => {} })
    await flush()
    assert.deepEqual([seen[0][0], seen[0][1], seen[0][3]], ['QUJD', 'audio/webm', 7000])
  })

  it('5. crash 3 during reload 2: one notice, and the cap state is intact', () => {
    crash()
    crash()
    crash()
    assert.equal(notifications.length, 1)
    mock.timers.tick(RELOAD_SETTLE_TIMEOUT_MS + 1)
    assert.equal(notifications.length, 1)
    startDictation()
    assert.equal(getDictationState(), 'idle')
    assert.equal(pageState.reloads, 2)
    mock.timers.tick(60_000)
    assert.equal(pageState.reloads, 3)
  })

  it('6. a crash loop for three minutes: one notice', () => {
    for (let t = 0; t < 180; t += 10) {
      crash()
      mock.timers.tick(10_000)
    }
    assert.equal(notifications.length, 1)
  })

  it('7. kept audio expires after 10 minutes', async () => {
    const service = failing()
    await failOnce(service)
    assert.ok(keptAudio())
    mock.timers.tick(KEPT_AUDIO_MAX_AGE_MS)
    assert.equal(keptAudio(), null)
    retryDictation({ paste: async () => {} })
    await flush()
    assert.equal(service.calls.length, 1, 'nothing left to send')
  })

  it('8. a pointer that left the pill into its padding does not hold a card open', () => {
    // The card is 360x124 at x 540..900, y 726..850; the page is inset by 4 px
    screenState.cursor = { x: 541, y: 727 }
    showErrorPill('no retry here')
    sentMessages.length = 0
    mock.timers.tick(7000)
    assert.ok(sentMessages.some((m) => m.channel === 'listening-mode-stop'))
  })

  for (const name of ['setup', 'permissions', 'capture']) {
    it(`9. a card waits while the ${name} window is on screen`, () => {
      windowManager.show(name)
      showErrorPill('later')
      assert.equal(cards().length, 0)
      windowManager.hide(name)
      assert.equal(cards().length, 1)
    })
  }

  it('6b. a crash loop where every reload loads again: still one notice', async () => {
    pageState.autoLoadOnReload = true
    for (let t = 0; t < 180; t += 10) {
      crash()
      await flush()
      mock.timers.tick(10_000)
      await flush()
    }
    assert.equal(notifications.length, 1)
  })

  it('a crash hides the indicator window, whatever it showed, and the card returns with the page', async () => {
    await failOnce()
    const win = windowManager.get('listening')
    assert.equal(win.isVisible(), true)
    crash()
    assert.equal(win.isVisible(), false, 'no click-blocking panel over a dead page')
    assert.equal(shortcuts.registered.has('Escape'), false)
    loaded()
    assert.equal(win.isVisible(), true)
    assert.equal(cards().length, 2)
  })

  it('a crash while the copied pill is up (hovered or not) hides it; the pill comes back with the page', () => {
    const win = windowManager.get('listening')
    for (const hovered of [false, true]) {
      sentMessages.length = 0
      screenState.cursor = hovered ? { x: 700, y: 810 } : { x: 10, y: 10 }
      showCopiedNotice({ reason: 'paste-failed' })
      if (hovered) mock.timers.tick(6001) // expired under the pointer: waiting for it to leave
      assert.equal(win.isVisible(), true)
      crash()
      assert.equal(win.isVisible(), false, `hovered=${hovered}`)
      mock.timers.tick(60_000) // no timer brings it back by itself
      assert.equal(win.isVisible(), false)
      loaded()
      assert.equal(win.isVisible(), true, 'back with the page')
      assert.ok(sentMessages.some((m) => m.channel === 'listening-mode-copied'))
      mock.timers.tick(6001)
      screenState.cursor = { x: 10, y: 10 }
    }
  })

  it('kept audio running out turns a shown Retry card into a plain message', async () => {
    await failOnce()
    mock.timers.tick(KEPT_AUDIO_MAX_AGE_MS)
    assert.equal(cards().length, 2)
    assert.equal(cards()[1].retry, false)
  })

  it('kept audio running out turns a card waiting behind setup into a plain message', async () => {
    windowManager.show('setup')
    await failOnce()
    assert.equal(cards().length, 0)
    mock.timers.tick(KEPT_AUDIO_MAX_AGE_MS)
    windowManager.hide('setup')
    assert.equal(cards().length, 1)
    assert.equal(cards()[0].retry, false)
  })

  it('a shown card steps aside for the capture overlay, gives Esc back, and returns after it', async () => {
    await failOnce()
    assert.equal(shortcuts.registered.has('Escape'), true)
    windowManager.show('capture')
    assert.equal(windowManager.get('listening').isVisible(), false)
    assert.equal(shortcuts.registered.has('Escape'), false, 'Esc belongs to the overlay now')
    windowManager.hide('capture')
    assert.equal(windowManager.get('listening').isVisible(), true)
    assert.equal(shortcuts.registered.has('Escape'), true)
    assert.equal(cards().length, 2)
  })

  it('a hotkey during a load says Cliparla is getting ready, at most once per 10 s', () => {
    crash()
    const base = Date.now() + 1e9 // later than any notice an earlier test caused
    const now = mock.method(Date, 'now', () => base)
    startDictation()
    startDictation()
    const ready = (): number =>
      notifications.filter((n) => /getting ready/.test(n.body ?? '')).length
    assert.equal(ready(), 1)
    now.mock.mockImplementation(() => base + 10_001)
    startDictation()
    assert.equal(ready(), 2)
    now.mock.restore()
  })

  it('a copied pill asked for while the page is not ready waits for it', () => {
    crash()
    showCopiedNotice({ reason: 'paste-failed' })
    assert.ok(!sentMessages.some((m) => m.channel === 'listening-mode-copied'))
    loaded()
    assert.ok(sentMessages.some((m) => m.channel === 'listening-mode-copied'))
  })

  it('a crash while only listening ends it and the card says so after the reload', () => {
    startDictation()
    crash()
    assert.equal(getDictationState(), 'idle')
    loaded()
    assert.match(cards()[0].message, /stopped unexpectedly/)
    assert.equal(cards()[0].retry, false)
  })

  it('the window is registered before its page starts loading', () => {
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    assert.equal(pageState.windowRegisteredAtLoad, true)
  })

  it('a card is sent only once the page says it listens; before that it is not sent at all', () => {
    crash()
    showErrorPill('after the crash', audio)
    pageState.autoRender = false
    pageState.emit('did-start-loading')
    pageState.emit('did-finish-load') // loaded, but its renderer has not subscribed yet
    assert.equal(cards().length, 0)
    const lostCards = (): number =>
      pageState.dropped.filter((m) => m.channel === 'listening-mode-error').length
    assert.equal(lostCards(), 0, 'no card was sent into a page that cannot hear it')
    pageState.renderer()
    assert.equal(cards().length, 1)
    assert.equal(lostCards(), 0)
  })

  it('a "page ready" that belongs to the page that died does not make the new one ready', () => {
    crash()
    windowManager.markIndicatorPageReady() // late message of the dead page
    assert.equal(windowManager.isIndicatorReady(), false)
    pageState.emit('did-start-loading')
    windowManager.markIndicatorPageReady()
    assert.equal(windowManager.isIndicatorReady(), true)
  })

  it('first start: a hotkey before the page is ready says Cliparla is getting ready', () => {
    pageState.autoRender = false
    windowManager.registerDefaultWindows()
    windowManager.createAll() // loaded, renderer not up
    startDictation()
    assert.equal(getDictationState(), 'idle')
    assert.ok(notifications.some((n) => /getting ready/.test(n.body ?? '')))
    pageState.renderer()
    startDictation()
    assert.equal(getDictationState(), 'listening')
  })

  it('a card waiting behind a minimized blocking window comes back, and steps aside when it is restored', () => {
    windowManager.show('setup')
    showErrorPill('later')
    assert.equal(cards().length, 0)
    windowManager.get('setup').emitWindowEvent('minimize')
    assert.equal(cards().length, 1)
    windowManager.get('setup').emitWindowEvent('restore')
    assert.equal(windowManager.get('listening').isVisible(), false)
    windowManager.hide('setup')
    assert.equal(windowManager.get('listening').isVisible(), true)
  })

  it('a hotkey on a dead page tells the user to restart again, at most every 30 s', () => {
    const base = Date.now() + 1e9
    const now = mock.method(Date, 'now', () => base)
    crash()
    crash()
    crash() // capped: the episode notice
    const restart = (): number =>
      notifications.filter((n) => /Restart Cliparla/.test(n.body ?? '')).length
    assert.equal(restart(), 1)
    startDictation()
    assert.equal(restart(), 1, 'too soon')
    now.mock.mockImplementation(() => base + 30_001)
    startDictation()
    assert.equal(restart(), 2)
    now.mock.restore()
  })

  it('a copied pill that waited more than 20 s for the page is dropped', () => {
    const base = Date.now() + 1e9
    const now = mock.method(Date, 'now', () => base)
    crash()
    showCopiedNotice({ reason: 'paste-failed' })
    now.mock.mockImplementation(() => base + 20_001)
    loaded()
    assert.ok(!sentMessages.some((m) => m.channel === 'listening-mode-copied'))
    now.mock.restore()
  })

  it('kept audio running out keeps Esc released and lets the information-only card close by itself', async () => {
    await failOnce()
    mock.timers.tick(ERROR_PILL_ESC_MS + 1)
    assert.equal(shortcuts.registered.has('Escape'), false)
    mock.timers.tick(KEPT_AUDIO_MAX_AGE_MS - ERROR_PILL_ESC_MS)
    assert.equal(cards().at(-1)?.retry, false)
    assert.equal(shortcuts.registered.has('Escape'), false, 'still not holding Esc')
    sentMessages.length = 0
    mock.timers.tick(5_900)
    assert.ok(!sentMessages.some((m) => m.channel === 'listening-mode-stop'))
    mock.timers.tick(200)
    assert.ok(
      sentMessages.some((m) => m.channel === 'listening-mode-stop'),
      'closed after 6 s'
    )
  })

  it('Cmd+H: nothing comes on screen while the app is hidden; after unhide the card waits for setup', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    windowManager.show('setup')
    showErrorPill('later')
    assert.equal(cards().length, 0)
    appState.hidden = true
    windowManager.hide('setup') // Cmd+H hides every window
    assert.equal(cards().length, 0, 'not rendered into a hidden app')
    assert.equal(shortcuts.registered.has('Escape'), false)
    appState.hidden = false
    windowManager.show('setup') // unhidden: the setup window is back
    for (const h of appState.handlers.get('activate') ?? []) h()
    assert.equal(cards().length, 0, 'setup is in front again: the card stays parked')
    assert.equal(windowManager.get('listening').isVisible(), false)
    windowManager.hide('setup')
    assert.equal(cards().length, 1)
  })

  it('after unhide with no blocking window the card appears when the app becomes active', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    appState.hidden = true
    showErrorPill('later')
    assert.equal(cards().length, 0)
    appState.hidden = false
    for (const h of appState.handlers.get('did-become-active') ?? []) h()
    assert.equal(cards().length, 1)
  })

  it('a blocking window shown by the system (not by us) parks a shown card', () => {
    showErrorPill('now')
    assert.equal(windowManager.get('listening').isVisible(), true)
    windowManager.get('setup').show() // the stub emits the window\'s show event
    assert.equal(windowManager.get('listening').isVisible(), false)
  })

  describe('page-ready and page-failed messages', () => {
    const fromIndicator = (
      frame: unknown = windowManager.get('listening').webContents.mainFrame
    ) => ({
      ...trustedEvent,
      sender: { id: windowManager.get('listening').webContents.id },
      senderFrame: frame
    })
    beforeEach(() => {
      const { registerDictationHandlers } = require('../src/main/ipc/dictation')
      registerDictationHandlers()
    })

    it('"page ready" counts only from the current main frame', () => {
      crash()
      pageState.emit('did-start-loading')
      ipc.listeners.get('indicator-page-ready')!(
        fromIndicator({ url: 'file:///fake/app/out/renderer/listening.html', parent: null })
      )
      assert.equal(windowManager.isIndicatorReady(), false)
      ipc.listeners.get('indicator-page-ready')!(fromIndicator())
      assert.equal(windowManager.isIndicatorReady(), true)
    })

    it('"page failed" from the main frame hides the window and reloads; from a stale frame it does nothing', () => {
      ipc.listeners.get('indicator-page-failed')!(
        fromIndicator({ url: 'file:///fake/app/out/renderer/listening.html', parent: null })
      )
      assert.equal(windowManager.isIndicatorReady(), true)
      ipc.listeners.get('indicator-page-failed')!(fromIndicator())
      assert.equal(windowManager.isIndicatorReady(), false)
      assert.equal(windowManager.get('listening').isVisible(), false)
      assert.equal(pageState.reloads, 1)
    })
  })
})
