/**
 * The listening page tells main when it listens ("page ready") and when it cannot render
 * ("page failed"); main sends it nothing before the first and reloads it after the second.
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ErrorBoundary } from '../src/renderer/src/listening/ErrorBoundary'

const read = (file: string): string => readFileSync(`${__dirname}/../${file}`, 'utf8')

describe('page ready', () => {
  it('is sent right after the page subscribed to main, inside the same effect', () => {
    const app = read('src/renderer/src/listening/App.tsx')
    const bind = app.indexOf('bindListeningEvents(window.electronAPI')
    const ready = app.indexOf('window.electronAPI.indicatorPageReady()')
    const cleanup = app.indexOf('return () => {', bind)
    assert.ok(bind > 0, 'the page subscribes')
    assert.ok(ready > bind, 'ready is sent after subscribing')
    assert.ok(ready < cleanup, 'and in the same effect, not somewhere else')
  })

  it('the preload exposes it as a send-only message', () => {
    const preload = read('src/preload/index.ts')
    assert.match(
      preload,
      /indicatorPageReady: \(\): void => ipcRenderer\.send\('indicator-page-ready'\)/
    )
  })
})

describe('the error boundary', () => {
  const real = (globalThis as { window?: unknown }).window
  afterEach(() => {
    ;(globalThis as { window?: unknown }).window = real
  })

  it('wraps the page', () => {
    assert.match(
      read('src/renderer/src/listening/main.tsx'),
      /<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/
    )
  })

  it('a render error tells main the page cannot be used and renders nothing', () => {
    let failed = 0
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: { indicatorPageFailed: () => failed++ }
    }
    assert.deepEqual(ErrorBoundary.getDerivedStateFromError(), { failed: true })
    const boundary = new ErrorBoundary({ children: 'content' })
    boundary.componentDidCatch()
    assert.equal(failed, 1)
    boundary.state = { failed: true }
    assert.equal(boundary.render(), null)
    boundary.state = { failed: false }
    assert.equal(boundary.render(), 'content')
  })
})
