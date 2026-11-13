/**
 * Dictation records without Accessibility. Only the paste needs it: without it
 * the result stays on the clipboard, with one notice and one system prompt per run.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clipboardWrites,
  mediaAccess,
  notificationClicks,
  resetRecorded,
  shownNotifications
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  getDictationState
} = require('../src/main/services/dictation')
const { requestAccessibility, getPermissionsStatus } = require('../src/main/services/permissions')
const { resetPromptForTests } = require('../src/main/services/paste-delivery')
const {
  liveNotificationCount,
  showCopiedNotice,
  watchAccessibilityGrant,
  onAccessibilityGranted,
  ACCESSIBILITY_WATCH_TIMEOUT_MS
} = require('../src/main/services/accessibility-hint')

/** A manual clock: tick() runs the watcher once. */
function clock() {
  let fn: (() => void) | null = null
  return {
    setInterval: (f: () => void) => ((fn = f), 'handle'),
    clearInterval: () => void (fn = null),
    tick: () => fn?.(),
    running: () => fn !== null
  }
}

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }

/** One full dictation; returns what the delivery step did. */
async function dictate(text: string) {
  const service = new FakeTranslationService()
  service.translateSpeech = (async () => ({ success: true, text })) as never
  setTranslationService(service)
  const log = {
    pasted: [] as string[],
    copied: [] as string[],
    notices: 0,
    prompts: 0,
    watches: 0,
    settings: 0
  }
  startDictation()
  const listening = getDictationState() === 'listening'
  stopListeningAndProcess()
  await handleDictationComplete(audio, {
    paste: async (t: string) => void log.pasted.push(t),
    copy: (t: string) => void log.copied.push(t),
    notify: () => void log.notices++,
    prompt: () => void log.prompts++,
    watchGrant: () => void log.watches++
  })
  return { ...log, listening }
}

describe('dictation without Accessibility', () => {
  beforeEach(() => {
    resetRecorded()
    cancelDictation()
    resetPromptForTests()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  it('records, leaves the result on the clipboard and says so', async () => {
    mediaAccess.accessibility = false
    const r = await dictate('HELLO')
    assert.equal(r.listening, true)
    assert.deepEqual(r.copied, ['HELLO'])
    assert.deepEqual(r.pasted, [])
    assert.equal(r.notices, 1)
    assert.equal(getDictationState(), 'idle')
  })

  it('asks macOS for the permission once across two dictations, but copies both', async () => {
    mediaAccess.accessibility = false
    const first = await dictate('ONE')
    const second = await dictate('TWO')
    assert.equal(first.prompts + second.prompts, 1)
    assert.equal(first.watches + second.watches, 2, 'asked on every miss; one runs at a time')
    assert.deepEqual([first.copied, second.copied], [['ONE'], ['TWO']])
    assert.equal(first.notices + second.notices, 2)
  })

  it('the prompt shows only once per run and nothing opens System Settings by itself', async () => {
    mediaAccess.accessibility = false
    const first = await dictate('ONE')
    const second = await dictate('TWO')
    const third = await dictate('THREE')
    assert.deepEqual([first.prompts, second.prompts, third.prompts], [1, 0, 0])
    const src = readFileSync('src/main/services/paste-delivery.ts', 'utf8')
    assert.doesNotMatch(
      src,
      /openAccessibilitySettings|openSettings/,
      'the pill link opens it, not delivery'
    )
  })

  it('a prompt already shown by the permissions window is not repeated at the first miss', async () => {
    mediaAccess.accessibility = false
    requestAccessibility() // the permissions window's Grant button
    const first = await dictate('ONE')
    assert.equal(first.prompts, 0)
    assert.equal(first.watches, 1, 'still watches, so the grant is announced')
    assert.deepEqual(first.copied, ['ONE'])
  })

  it('a prompt shown at a dictation miss makes the permissions window open Settings next', async () => {
    mediaAccess.accessibility = false
    assert.equal(getPermissionsStatus().accessibilityPrompted, false)
    await dictate('ONE')
    assert.equal(getPermissionsStatus().accessibilityPrompted, true)
  })

  it('by default the text goes to the real clipboard, which is not restored', async () => {
    mediaAccess.accessibility = false
    const service = new FakeTranslationService()
    service.translateSpeech = (async () => ({ success: true, text: 'KEEP' })) as never
    setTranslationService(service)
    startDictation()
    stopListeningAndProcess()
    await handleDictationComplete(audio, {
      notify: () => {},
      prompt: () => {},
      watchGrant: () => {}
    })
    assert.deepEqual(clipboardWrites, ['KEEP'])
  })

  it('never starts the microphone by itself once the permission arrives', () => {
    mediaAccess.accessibility = false
    startDictation()
    cancelDictation()
    mediaAccess.accessibility = true
    assert.equal(getDictationState(), 'idle')
  })

  it('with the permission it pastes, copies nothing and asks nothing', async () => {
    mediaAccess.accessibility = true
    const r = await dictate('PASTED')
    assert.equal(r.listening, true)
    assert.deepEqual(r.pasted, ['PASTED'])
    assert.deepEqual(r.copied, [])
    assert.equal(r.notices + r.prompts + r.watches, 0)
  })
})

describe('watchAccessibilityGrant', () => {
  it('keeps watching for ten minutes by default: a grant made later than two minutes is still caught', () => {
    assert.ok(ACCESSIBILITY_WATCH_TIMEOUT_MS >= 600_000)
    const c = clock()
    let trusted = false
    let granted = 0
    watchAccessibilityGrant({ isTrusted: () => trusted, onGranted: () => void granted++, ...c })
    for (let i = 0; i < 300; i++) c.tick() // five minutes of one-second ticks
    assert.equal(c.running(), true)
    trusted = true
    c.tick()
    assert.equal(granted, 1)
  })

  it('tells every listener (hold-to-talk retry) when the permission appears, not before and not on timeout', () => {
    const c = clock()
    let trusted = false
    let heard = 0
    onAccessibilityGranted(() => void heard++)
    watchAccessibilityGrant({ isTrusted: () => trusted, onGranted: () => {}, ...c })
    c.tick()
    assert.equal(heard, 0)
    trusted = true
    c.tick()
    assert.equal(heard, 1)
    const d = clock()
    trusted = false
    watchAccessibilityGrant({
      isTrusted: () => trusted,
      onGranted: () => {},
      timeoutMs: 1000,
      ...d
    })
    d.tick()
    assert.equal(heard, 1, 'no grant, no call')
  })

  it('calls onGranted once, when the permission appears, then stops', () => {
    const c = clock()
    let trusted = false
    let granted = 0
    watchAccessibilityGrant({
      isTrusted: () => trusted,
      onGranted: () => void granted++,
      ...c
    })
    c.tick()
    assert.equal(granted, 0)
    trusted = true
    c.tick()
    assert.equal(granted, 1)
    assert.equal(c.running(), false)
  })

  it('gives up after the timeout without saying anything', () => {
    const c = clock()
    let granted = 0
    watchAccessibilityGrant({
      isTrusted: () => false,
      onGranted: () => void granted++,
      intervalMs: 1000,
      timeoutMs: 3000,
      ...c
    })
    for (let i = 0; i < 3; i++) c.tick()
    assert.equal(c.running(), false)
    assert.equal(granted, 0)
  })

  it('a second press while one watcher runs does not start another', () => {
    const first = clock()
    const second = clock()
    watchAccessibilityGrant({
      isTrusted: () => false,
      onGranted: () => {},
      intervalMs: 1000,
      timeoutMs: 2000,
      ...first
    })
    watchAccessibilityGrant({ isTrusted: () => false, onGranted: () => {}, ...second })
    assert.equal(second.running(), false)
    first.tick()
    first.tick()
  })
})

describe('clicking the notice', () => {
  const notice = (reasons: string[]): void => {
    resetRecorded()
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      for (const reason of reasons) showCopiedNotice({ indicator: false, reason })
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
  }

  it('has a click handler for no-permission and not-trusted, not for a failed paste', () => {
    notice(['no-permission', 'not-trusted', 'paste-failed'])
    assert.deepEqual(
      notificationClicks.map((h) => typeof h),
      ['function', 'function', 'undefined']
    )
  })

  it('keeps clickable notifications referenced until they are clicked or closed', () => {
    const before = liveNotificationCount()
    notice(['no-permission', 'not-trusted', 'paste-failed'])
    assert.equal(
      liveNotificationCount(),
      before + 2,
      'the failed-paste notice has no handler to keep'
    )
    // Off macOS the click does not open System Settings (on macOS it runs the real `open`, which the stub forbids)
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      shownNotifications[0].emit('click')
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform })
    }
    assert.equal(liveNotificationCount(), before + 1)
    shownNotifications[1].emit('close')
    assert.equal(liveNotificationCount(), before)
  })
})
