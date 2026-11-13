/**
 * The parts of the paste fallback that were only checked by reading code:
 * the grant watcher never starts the microphone, a successful paste restores
 * the user's clipboard, and the notice names the paste key.
 */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mediaAccess, notifications, resetRecorded, sentMessages } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  armAccessibilityHint,
  showCopiedNotice
} = require('../src/main/services/accessibility-hint')
const { getDictationState } = require('../src/main/services/dictation')
const { pasteText } = require('../src/main/services/keyboard-simulator')

class FakeItem {
  constructor(private readonly data: Record<string, unknown>) {}
  get types() {
    return Object.keys(this.data)
  }
  async getType(type: string) {
    return this.data[type]
  }
}

function fakeClipboard(initialText: string) {
  let items = [new FakeItem({ 'text/plain': initialText })]
  return {
    read: async () => items,
    write: async (next: FakeItem[]) => void (items = next),
    writeText: (text: string) => void (items = [new FakeItem({ 'text/plain': text })]),
    text: async () => (await items[0].getType('text/plain')) as string
  }
}

describe('Accessibility grant watcher', () => {
  beforeEach(() => resetRecorded())

  it('says pasting is automatic now, and does not start the microphone', () => {
    let tick: (() => void) | null = null
    mediaAccess.accessibility = false
    armAccessibilityHint({
      setInterval: (fn: () => void) => ((tick = fn), 'handle'),
      clearInterval: () => void (tick = null)
    })
    tick!()
    assert.deepEqual(notifications, [])
    mediaAccess.accessibility = true
    tick!()
    assert.equal(notifications.length, 1)
    assert.equal(getDictationState(), 'idle')
    assert.ok(!sentMessages.some((m) => m.channel === 'listening-mode-start'))
  })
})

describe('pasteText', () => {
  it('restores the previous clipboard after a successful paste', async () => {
    const clip = fakeClipboard('before')
    const seen: string[] = []
    await pasteText('DICTATED', {
      clipboard: clip,
      targetReady: () => true,
      Item: FakeItem,
      simulate: async () => void seen.push(await clip.text())
    })
    assert.deepEqual(seen, ['DICTATED'])
    assert.equal(await clip.text(), 'before')
  })

  it('keeps the dictated text when the paste fails, then rethrows', async () => {
    const clip = fakeClipboard('before')
    await assert.rejects(
      pasteText('DICTATED', {
        clipboard: clip,
        targetReady: () => true,
        Item: FakeItem,
        simulate: async () => {
          throw new Error('blocked')
        }
      }),
      /blocked/
    )
    assert.equal(await clip.text(), 'DICTATED')
  })
})

describe('copied notice', () => {
  beforeEach(() => resetRecorded())

  it('names the paste key instead of leaving a blank', () => {
    showCopiedNotice()
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].body ?? '', /⌘V/)
    assert.doesNotMatch(notifications[0].body ?? '', /\{\{/)
  })
})
