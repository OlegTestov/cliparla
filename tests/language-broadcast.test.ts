import { ipc, trustedEvent, resetRecorded } from './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { broadcastUiLanguage } = require('../src/main/core/language-broadcast')
const { IPC_CHANNELS } = require('../src/shared/ipc-types')

const win = (destroyed = false) => {
  const sent: unknown[][] = []
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { send: (...args: unknown[]) => sent.push(args) }
  }
}

describe('language change reaches every window', () => {
  it('sends the new language to each live window, skipping destroyed ones', () => {
    const a = win()
    const b = win()
    const gone = win(true)
    broadcastUiLanguage([a, b, gone], 'es')
    assert.deepEqual(a.sent, [[IPC_CHANNELS.UI_LANGUAGE_CHANGED, 'es']])
    assert.deepEqual(b.sent, [[IPC_CHANNELS.UI_LANGUAGE_CHANGED, 'es']])
    assert.deepEqual(gone.sent, [])
  })

  describe('saving settings', () => {
    beforeEach(() => resetRecorded())

    it('broadcasts when uiLanguage is saved, not for other settings', () => {
      const { registerSettingsHandlers } = require('../src/main/ipc/settings')
      const seen: string[] = []
      registerSettingsHandlers({ onUiLanguageChanged: (l: string) => seen.push(l) })
      const save = ipc.handlers.get('save-settings')!
      save(trustedEvent, { uiLanguage: 'de' })
      save(trustedEvent, { preferredLanguage1: 'fr' })
      assert.deepEqual(seen, ['de'])
    })
  })
})
