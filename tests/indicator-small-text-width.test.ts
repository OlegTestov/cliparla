/**
 * The small line at the bottom of the indicator (countdown text, Open Settings link)
 * must fit: 240 window - 8 outer p-1 - 32 px-4 = 200 px. Widths are measured with AppKit
 * (10 px, medium, 0.025em tracking, {{s}} = 15) by tools/measure-indicator-text.swift.
 * A changed string must be measured again.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SLOT = 200

const MEASURED: Record<string, Record<string, [string, number]>> = {
  'permissions.openSettings': {
    ar: ['فتح الإعدادات', 60],
    de: ['Einstellungen öffnen', 107],
    en: ['Open Settings', 74],
    es: ['Abrir ajustes', 66],
    fr: ['Ouvrir les paramètres', 113],
    hi: ['सेटिंग्स खोलें', 48],
    it: ['Apri impostazioni', 91],
    ja: ['設定を開く', 53],
    ko: ['설정 열기', 39],
    nl: ['Instellingen openen', 102],
    pl: ['Otwórz ustawienia', 96],
    pt: ['Abrir configurações', 103],
    ru: ['Открыть настройки', 106],
    tr: ['Ayarları Aç', 56],
    uk: ['Відкрити налаштування', 128],
    zh: ['打开设置', 42]
  },
  'listening.endsIn': {
    ar: ['ينتهي التسجيل خلال {{s}} ث', 113],
    de: ['Aufnahme endet in {{s}} s', 121],
    en: ['Recording ends in {{s}} s', 117],
    es: ['La grabación termina en {{s}} s', 149],
    fr: ["L'enregistrement s'arrête dans {{s}} s", 183],
    hi: ['रिकॉर्डिंग {{s}} सेकंड में समाप्त होगी', 129],
    it: ['La registrazione termina tra {{s}} s', 168],
    ja: ['録音はあと {{s}} 秒で終了します', 144],
    ko: ['{{s}}초 후 녹음이 종료됩니다', 111],
    nl: ['Opname stopt over {{s}} s', 123],
    pl: ['Nagrywanie zakończy się za {{s}} s', 169],
    pt: ['A gravação termina em {{s}} s', 143],
    ru: ['Запись закончится через {{s}} с', 161],
    tr: ['Kayıt {{s}} sn içinde bitiyor', 127],
    uk: ['Запис завершиться через {{s}} с', 164],
    zh: ['录音将在 {{s}} 秒后结束', 102]
  },
  'listening.readdAccessibility': {
    ar: ['أعد إضافة Cliparla', 86],
    de: ['Cliparla erneut hinzufügen', 138],
    en: ['Re-add Cliparla in Accessibility', 162],
    es: ['Vuelve a añadir Cliparla', 123],
    fr: ['Rajouter Cliparla', 87],
    hi: ['Cliparla को फिर जोड़ें', 92],
    it: ['Aggiungi di nuovo Cliparla', 136],
    ja: ['Cliparla を再追加', 85],
    ko: ['Cliparla 다시 추가', 82],
    nl: ['Voeg Cliparla opnieuw toe', 135],
    pl: ['Dodaj Cliparla ponownie', 126],
    pt: ['Adicione o Cliparla de novo', 141],
    ru: ['Добавьте Cliparla снова', 128],
    tr: ["Cliparla'yı yeniden ekle", 121],
    uk: ['Додайте Cliparla знову', 123],
    zh: ['重新添加 Cliparla', 85]
  }
}

const locale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(`${__dirname}/../src/renderer/src/i18n/locales/${code}.json`, 'utf8'))

describe('indicator small text width', () => {
  for (const [key, entries] of Object.entries(MEASURED)) {
    it(`${key}: all 16 locales are the measured text and fit ${SLOT} px`, () => {
      assert.equal(Object.keys(entries).length, 16)
      for (const [code, [text, width]] of Object.entries(entries)) {
        assert.equal(locale(code)[key], text, `${code} ${key} changed: measure it again`)
        assert.ok(width <= SLOT, `${code} ${key} is ${width} px`)
      }
    })
  }
})
