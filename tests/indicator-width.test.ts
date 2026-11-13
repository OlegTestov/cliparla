/**
 * The indicator text must fit its 164 px slot in the copied view: 240 window width
 * (window-manager.ts) - 8 outer p-1 - 24 inset px-3 - 32 icon w-8 - 12 gap-3 (App.tsx).
 * Widths are measured with AppKit and the macOS system font by
 * tools/measure-indicator-text.swift (14 px, medium, 0.025em tracking), with the
 * paste key as ⌘V. A changed string must be measured again.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SLOT = 164

const MEASURED: Record<string, [string, number]> = {
  ar: ['تم النسخ · {{paste}}', 90],
  de: ['Kopiert · {{paste}}', 87],
  en: ['Copied · {{paste}}', 85],
  es: ['Copiado · {{paste}}', 94],
  fr: ['Copié · {{paste}}', 76],
  hi: ['कॉपी हुआ · {{paste}}', 90],
  it: ['Copiato · {{paste}}', 90],
  ja: ['コピー済み · {{paste}}', 109],
  ko: ['복사됨 · {{paste}}', 74],
  nl: ['Gekopieerd · {{paste}}', 116],
  pl: ['Skopiowano · {{paste}}', 120],
  pt: ['Copiado · {{paste}}', 94],
  ru: ['Скопировано · {{paste}}', 133],
  tr: ['Kopyalandı · {{paste}}', 112],
  uk: ['Скопійовано · {{paste}}', 128],
  zh: ['已复制 · {{paste}}', 80]
}

const locale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(`${__dirname}/../src/renderer/src/i18n/locales/${code}.json`, 'utf8'))

describe('indicator text width', () => {
  it('covers all 16 locales', () => {
    assert.equal(Object.keys(MEASURED).length, 16)
  })

  for (const [code, [text, width]] of Object.entries(MEASURED)) {
    it(`${code}: the measured text is the shipped text and fits ${SLOT} px`, () => {
      assert.equal(locale(code)['listening.copied'], text)
      assert.ok(width <= SLOT, `${code} is ${width} px`)
    })
  }
})
