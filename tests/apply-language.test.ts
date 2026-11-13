import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { applyUiLanguage } = require('../src/renderer/src/i18n/apply-language')

describe('applyUiLanguage', () => {
  it('switches every window to the saved or system language', async () => {
    const changed: string[] = []
    await applyUiLanguage({ changeLanguage: (l: string) => void changed.push(l) }, async () => ({
      uiLanguage: 'es'
    }))
    assert.deepEqual(changed, ['es'])
  })

  it('keeps English when settings are unavailable or empty', async () => {
    const changed: string[] = []
    const i18n = { changeLanguage: (l: string) => void changed.push(l) }
    await applyUiLanguage(i18n, async () => {
      throw new Error('no bridge')
    })
    await applyUiLanguage(i18n, async () => ({}))
    assert.deepEqual(changed, [])
  })
})
