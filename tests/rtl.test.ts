/**
 * Arabic lays the window out right to left; other languages left to right.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const root: { lang?: string; dir?: string } = {}
;(globalThis as unknown as { document: unknown }).document = { documentElement: root }

describe('document direction follows the interface language', () => {
  it('ar is rtl, ru and en are ltr', async () => {
    const { default: i18n } = await import('../src/renderer/src/i18n/index')
    await i18n.changeLanguage('ar')
    assert.deepEqual(root, { lang: 'ar', dir: 'rtl' })
    await i18n.changeLanguage('ru')
    assert.deepEqual(root, { lang: 'ru', dir: 'ltr' })
    await i18n.changeLanguage('en')
    assert.equal(root.dir, 'ltr')
  })
})
