/**
 * fitWindowHeight on a window with a native title bar (Windows/Linux): the page
 * height is content height, so it must be measured and set on the content area.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { fitWindowHeight, resetWindowHeight } = windowManager

const TITLE_BAR = 28

function framedWindow(contentHeight: number) {
  const content = { x: 100, y: 178, width: 500, height: contentHeight }
  const calls = { setContentBounds: [] as unknown[], setBounds: [] as unknown[] }
  return {
    calls,
    getContentBounds: () => ({ ...content }),
    getBounds: () => ({ ...content, y: content.y - TITLE_BAR, height: content.height + TITLE_BAR }),
    isVisible: () => true,
    setContentBounds: (b: typeof content) => {
      calls.setContentBounds.push(b)
      Object.assign(content, b)
    },
    setBounds: (b: unknown) => void calls.setBounds.push(b)
  }
}

describe('resetWindowHeight', () => {
  it('a new text starts at the configured height after a long one grew the window', () => {
    const win = framedWindow(350)
    fitWindowHeight(win, 700)
    resetWindowHeight(win)
    assert.equal((win.calls.setContentBounds[1] as { height: number }).height, 350)
  })

  it('does nothing for a window that never grew', () => {
    const win = framedWindow(350)
    resetWindowHeight(win)
    assert.equal(win.calls.setContentBounds.length, 0)
  })
})

describe('a new translation start', () => {
  it('leaves the window height to the page (it resets after its old text is gone)', () => {
    const { get, registerDefaultWindows, createAll, sendTranslationStart } = windowManager
    registerDefaultWindows()
    createAll()
    const win = framedWindow(350)
    Object.assign(get('result'), {
      getContentBounds: win.getContentBounds,
      getBounds: win.getBounds,
      setContentBounds: win.setContentBounds
    })
    fitWindowHeight(get('result'), 800)
    sendTranslationStart()
    assert.equal(win.calls.setContentBounds.length, 1, 'only the growth, no reset from main')
  })
})

describe('reset-window-height from a page', () => {
  const { registerAppHandlers } = require('../src/main/ipc/app')
  const { ipc, resetRecorded, trustedEvent } = require('./helpers/electron-stub')

  it("resets only the sender's own window", () => {
    resetRecorded()
    const mine = framedWindow(350)
    const other = framedWindow(350)
    fitWindowHeight(mine, 800)
    fitWindowHeight(other, 800)
    registerAppHandlers({ windowFor: (sender: { id: number }) => (sender.id === 1 ? mine : null) })
    ipc.listeners.get('reset-window-height')({ ...trustedEvent, sender: { id: 1 } })
    assert.equal((mine.calls.setContentBounds[1] as { height: number }).height, 350)
    assert.equal(other.calls.setContentBounds.length, 1)
    ipc.listeners.get('reset-window-height')({ ...trustedEvent, sender: { id: 2 } })
    assert.equal(
      other.calls.setContentBounds.length,
      1,
      'a sender without a window changes nothing'
    )
  })

  it('an untrusted page is ignored', () => {
    resetRecorded()
    const win = framedWindow(350)
    fitWindowHeight(win, 800)
    registerAppHandlers({ windowFor: () => win })
    ipc.listeners.get('reset-window-height')({
      senderFrame: { url: 'https://evil.example/', parent: null },
      sender: { id: 1 }
    })
    assert.equal(win.calls.setContentBounds.length, 1)
  })
})

describe('the result page orders clear, render, reset', () => {
  const page = readFileSync('src/renderer/src/result/App.tsx', 'utf8')

  it('marks the old content stale before it is cleared and clears the mark only after the reset', () => {
    const start = page.slice(
      page.indexOf('onTranslationStart('),
      page.indexOf('onTranslationComplete(')
    )
    assert.ok(start.indexOf('staleContent.current = true') < start.indexOf('controller.start()'))
    const reset = page.slice(page.indexOf('resetWindowHeight()'))
    assert.ok(reset.indexOf('resetWindowHeight()') < reset.indexOf('staleContent.current = false'))
    assert.match(page, /requestAnimationFrame\(\(\) => \{\s*second = requestAnimationFrame/)
  })

  it('the size observer asks for no growth while the content is stale', () => {
    assert.match(page, /ask !== null && !staleContent\.current/)
  })
})

describe('fitWindowHeight', () => {
  it('grows by content height, so a framed window gets no scrollbar', () => {
    const win = framedWindow(572)
    fitWindowHeight(win, 700)
    assert.equal((win.calls.setContentBounds[0] as { height: number }).height, 700)
    assert.equal(win.calls.setBounds.length, 0)
  })

  it('does nothing when the page already fits', () => {
    const win = framedWindow(572)
    fitWindowHeight(win, 572)
    assert.equal(win.calls.setContentBounds.length, 0)
  })

  it('shrinks back to the first-seen content height, not below', () => {
    const win = framedWindow(572)
    fitWindowHeight(win, 700)
    fitWindowHeight(win, 300)
    assert.equal((win.calls.setContentBounds[1] as { height: number }).height, 572)
  })

  it('a page taller than the screen keeps the whole window, title bar included, on screen', () => {
    const win = framedWindow(572)
    fitWindowHeight(win, 5000)
    const set = win.calls.setContentBounds[0] as { y: number; height: number }
    // work area: y 25, height 875
    assert.equal(set.height, 875 - TITLE_BAR)
    assert.ok(set.y - TITLE_BAR >= 25)
    assert.ok(set.y + set.height <= 25 + 875)
  })
})
