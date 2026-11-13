import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createPendingChanges } = require('../src/renderer/src/settings/pending-changes')

describe('settings save only what the user changed', () => {
  it('returns just the edited fields, then nothing', () => {
    const p = createPendingChanges()
    p.set('captureShortcut', 'Alt+S')
    p.set('captureShortcut', 'Alt+T')
    assert.deepEqual(p.take(), { captureShortcut: 'Alt+T' })
    assert.deepEqual(p.take(), {})
  })

  it('Settings follows the language event and saves through the pending set', () => {
    const src = readFileSync(`${__dirname}/../src/renderer/src/settings/App.tsx`, 'utf8')
    assert.match(src, /onUiLanguageChanged/)
    assert.match(src, /pending\.(current\.)?take\(\)/)
    assert.doesNotMatch(src, /saveSettings\(settings\)/)
  })
})
