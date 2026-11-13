/**
 * The macOS paste can fall back to a bundled helper; a failing fallback must
 * make the caller copy the text instead.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  pasteHelperPath,
  pasteWithHelper,
  PasteNotTrustedError
} = require('../src/main/services/mac-paste-helper')
const { simulatePaste } = require('../src/main/services/keyboard-simulator')
const { deliverText, resetPromptForTests } = require('../src/main/services/paste-delivery')
const { notifications, resetRecorded } = require('./helpers/electron-stub')

const env = (over: Record<string, unknown> = {}) => ({
  packaged: true,
  resourcesPath: '/App/Contents/Resources',
  cwd: '/repo',
  exists: () => true,
  run: async () => ({}),
  ...over
})

describe('paste helper path', () => {
  it('is inside Resources/bin when packaged', () => {
    assert.equal(pasteHelperPath(env()), '/App/Contents/Resources/bin/cliparla-paste')
  })

  it('is native/build in the repo in dev', () => {
    assert.equal(pasteHelperPath(env({ packaged: false })), '/repo/native/build/cliparla-paste')
  })
})

describe('the macOS paste', () => {
  it('dispatches to the injected macOS paste implementation', async () => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    let calls = 0
    try {
      await simulatePaste(async () => {
        calls += 1
      })
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
    assert.equal(calls, 1)
  })
})

describe('running the paste helper', () => {
  it('runs the resolved file once and resolves on success', async () => {
    const ran: string[] = []
    await pasteWithHelper(env({ run: async (file: string) => ran.push(file) }))
    assert.deepEqual(ran, ['/App/Contents/Resources/bin/cliparla-paste'])
  })

  it('rejects when the helper exits non-zero', async () => {
    await assert.rejects(
      pasteWithHelper(
        env({
          run: async () => {
            throw new Error('exit 2')
          }
        })
      ),
      /exit 2/
    )
  })

  it('rejects without running anything when the binary is missing', async () => {
    let ran = false
    await assert.rejects(
      pasteWithHelper(
        env({
          exists: () => false,
          run: async () => {
            ran = true
          }
        })
      ),
      /not found/
    )
    assert.equal(ran, false)
  })

  it('a failing helper ends in a copied notice, not a lost text', async () => {
    resetRecorded()
    resetPromptForTests()
    const copied: string[] = []
    await deliverText('HELLO', {
      isTrusted: () => true,
      paste: () => pasteWithHelper(env({ exists: () => false })),
      copy: (text: string) => copied.push(text),
      notify: () => {}
    })
    assert.deepEqual(copied, ['HELLO'])
    assert.equal(notifications.length, 0)
  })

  it('exit code 2 (Accessibility not granted) is its own error', async () => {
    await assert.rejects(
      pasteWithHelper(
        env({
          run: async () => {
            throw Object.assign(new Error('exit 2'), { code: 2 })
          }
        })
      ),
      PasteNotTrustedError
    )
  })

  it('exit code 2 with a trusted app: re-add hint, no prompt, no grant watcher, no "enabled" message', async () => {
    resetRecorded()
    resetPromptForTests()
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    let prompts = 0
    let watchers = 0
    const copied: string[] = []
    try {
      await deliverText('HELLO', {
        isTrusted: () => true,
        paste: () =>
          pasteWithHelper(
            env({
              run: async () => {
                throw Object.assign(new Error('exit 2'), { code: 2 })
              }
            })
          ),
        copy: (t: string) => void copied.push(t),
        prompt: () => void prompts++,
        watchGrant: () => void watchers++
      })
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
    assert.deepEqual(copied, ['HELLO'])
    assert.deepEqual([prompts, watchers], [0, 0])
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].body ?? '', /Remove Cliparla from Accessibility and add it again/)
    assert.doesNotMatch(notifications[0].body ?? '', /Accessibility is on/)
  })
})
