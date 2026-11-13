/**
 * Every locale is complete, keeps its placeholders, and provider errors are
 * shown in the user's language.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* eslint-disable @typescript-eslint/no-require-imports */
const { TRANSLATION_ERROR_CODES } = require('../src/shared/types')
const { messageFor } = require('../src/main/services/translation/errors')
const {
  localizeResult,
  resolveSystemLanguage,
  resolveSystemLanguages
} = require('../src/main/core/localize')

const root = join(__dirname, '..')
const localeDir = join(root, 'src/renderer/src/i18n/locales')
const locales: Record<string, Record<string, string>> = {}
for (const file of readdirSync(localeDir)) {
  locales[file.replace('.json', '')] = JSON.parse(readFileSync(join(localeDir, file), 'utf8'))
}
const en = locales.en
// Error texts moved from dialogs into the indicator card; their titles are gone
const DEAD_KEYS = [
  'dictation.noAudio.title',
  'dictation.tooLarge.title',
  'dictation.error.title',
  'error.dialogTitle'
]
const others = Object.keys(locales).filter((l) => l !== 'en')

const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort().join(',')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : [full]
  })
}

describe('locale completeness', () => {
  it('there are 16 locales', () => {
    assert.equal(Object.keys(locales).length, 16)
  })

  for (const lang of others) {
    it(`${lang} has exactly the keys of en`, () => {
      const missing = Object.keys(en).filter((k) => !(k in locales[lang]))
      const extra = Object.keys(locales[lang]).filter((k) => !(k in en))
      assert.deepEqual({ missing, extra }, { missing: [], extra: [] })
    })

    it(`${lang} keeps every placeholder and has no empty text`, () => {
      for (const [key, value] of Object.entries(locales[lang])) {
        assert.ok(value.trim().length > 0, `${lang}:${key} is empty`)
        assert.equal(placeholders(value), placeholders(en[key]), `${lang}:${key}`)
      }
    })

    it(`${lang} is actually translated, not copied`, () => {
      const copied = Object.keys(en).filter((k) => en[k].length > 25 && locales[lang][k] === en[k])
      assert.ok(copied.length < 5, `${lang} copies English: ${copied.join(', ')}`)
    })
  }

  it('every literal translation key used in src exists in en', () => {
    const used = new Set<string>()
    for (const file of sourceFiles(join(root, 'src/renderer')).filter((f) => /\.tsx?$/.test(f))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1])
      for (const m of text.matchAll(/(?:labelKey|descriptionKey):\s*'([\w.]+)'/g)) used.add(m[1])
    }
    const missing = [...used].filter((k) => !(k in en))
    assert.deepEqual(missing, [])
  })

  it('there is a message for every provider error code', () => {
    for (const code of TRANSLATION_ERROR_CODES) {
      for (const lang of Object.keys(locales)) {
        assert.ok(locales[lang][`error.${code}`], `${lang}:error.${code}`)
      }
    }
    for (const lang of Object.keys(locales))
      for (const key of DEAD_KEYS)
        assert.equal(locales[lang][key], undefined, `${lang}:${key} is unused`)
  })
})

describe('localized provider errors', () => {
  const canned = (code: string) => ({
    success: false,
    errorCode: code,
    error: messageFor(code)
  })

  it('English messages match the service messages exactly', () => {
    for (const code of TRANSLATION_ERROR_CODES) {
      assert.equal(en[`error.${code}`], messageFor(code), code)
    }
  })

  it('canned errors are shown in the interface language', () => {
    const result = localizeResult(canned('QUOTA_EXHAUSTED'), 'es')
    assert.equal(result.error, locales.es['error.QUOTA_EXHAUSTED'])
    assert.notEqual(result.error, messageFor('QUOTA_EXHAUSTED'))
    assert.equal(result.errorCode, 'QUOTA_EXHAUSTED')
  })

  it('specific messages and successes are left alone', () => {
    const custom = {
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'Something very specific.'
    }
    assert.equal(localizeResult(custom, 'ru').error, 'Something very specific.')
    const ok = { success: true, text: 'hi' }
    assert.deepEqual(localizeResult(ok, 'ru'), ok)
  })

  it('unknown languages fall back to English', () => {
    assert.equal(localizeResult(canned('NETWORK'), 'xx').error, messageFor('NETWORK'))
  })

  it('key test results are localized too', () => {
    const test = localizeResult(
      { ok: false, errorCode: 'INVALID_KEY', error: messageFor('INVALID_KEY') },
      'de'
    )
    assert.equal(test.error, locales.de['error.INVALID_KEY'])
  })
})

describe('first-run language', () => {
  it('picks the first supported language from the preference list', () => {
    assert.equal(resolveSystemLanguages(['sv-SE', 'es-ES', 'fr']), 'es')
    assert.equal(resolveSystemLanguages(['sv-SE']), 'en')
    assert.equal(resolveSystemLanguages([]), 'en')
  })

  it('follows the system language when it is supported, else English', () => {
    assert.equal(resolveSystemLanguage('es-ES'), 'es')
    assert.equal(resolveSystemLanguage('pt_BR'), 'pt')
    assert.equal(resolveSystemLanguage('zh-Hans-CN'), 'zh')
    assert.equal(resolveSystemLanguage('ru'), 'ru')
    assert.equal(resolveSystemLanguage('sv-SE'), 'en')
    assert.equal(resolveSystemLanguage(''), 'en')
  })
})

describe('main-process texts', () => {
  const { t } = require('../src/main/core/localize')
  const { CANNED } = require('../src/main/services/translation/errors')

  it('every key used with t() or translate() in src/main exists in every locale', () => {
    const used = new Set<string>()
    for (const file of sourceFiles(join(root, 'src/main')).filter((f) => /\.ts$/.test(f))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\b(?:t|translate)\(\s*'([\w.]+)'/g)) used.add(m[1])
    }
    assert.ok(used.size >= 20, `expected many keys, found ${used.size}`)
    for (const key of used) {
      for (const lang of Object.keys(locales)) {
        assert.ok(locales[lang][key], `${lang}:${key}`)
      }
    }
  })

  it('every canned service message is translated', () => {
    for (const [name, english] of Object.entries(CANNED)) {
      const result = localizeResult(
        { success: false, errorCode: 'INVALID_REQUEST', error: english },
        'es'
      )
      assert.equal(result.error, locales.es[`errormsg.${name}`], name)
      assert.notEqual(result.error, english, name)
      assert.equal(en[`errormsg.${name}`], english, `${name} must match the English locale`)
    }
  })

  it('t() fills in placeholders and falls back to English', () => {
    assert.match(t('dictation.tooLarge.message', 'es', { size: '7.5' }), /7\.5/)
    assert.equal(t('tray.quit', 'xx'), en['tray.quit'])
  })
})

describe('language names in pickers', () => {
  const { languageLabel } = require('../src/shared/language-label')

  it('shows target languages in the interface language', () => {
    assert.equal(languageLabel('Spanish', 'es'), 'español')
    assert.equal(languageLabel('Russian', 'de'), 'Russisch')
    assert.equal(languageLabel('Chinese (Simplified)', 'en'), 'Simplified Chinese')
  })

  it('unknown names are shown as they are', () => {
    assert.equal(languageLabel('Klingon', 'es'), 'Klingon')
  })
})

describe('first-run screens fit their buttons', () => {
  it('menu labels and the permissions title exist in every locale', () => {
    for (const lang of Object.keys(locales)) {
      for (const key of [
        'menu.edit',
        'menu.view',
        'menu.window',
        'menu.help',
        'permissions.macAlertNote'
      ]) {
        assert.ok(locales[lang][key], `${lang}:${key}`)
      }
    }
    assert.equal(en['permissions.title'], 'Turn on Screen Recording')
  })

  it('key-form button labels stay short in every locale', () => {
    for (const lang of Object.keys(locales)) {
      for (const key of ['key.test', 'key.retry', 'key.testing']) {
        assert.ok(
          locales[lang][key].length <= 16,
          `${lang}:${key} is ${locales[lang][key].length} chars`
        )
      }
    }
  })

  it('the key-form button never wraps and the permissions screen pins Continue', () => {
    const form = readFileSync(join(root, 'src/renderer/src/components/KeyForm.tsx'), 'utf8')
    assert.match(form, /whitespace-nowrap/)
    const perms = readFileSync(join(root, 'src/renderer/src/permissions/App.tsx'), 'utf8')
    assert.doesNotMatch(perms, /<details/, 'microphone and Accessibility are always visible')
    assert.match(perms, /permissions\.notYet/, 'each row shows a not-yet status')
    // Continue sits below the scroll area, so an opened section never slides under it
    assert.match(perms, /flex-1 overflow-y-auto/)
    assert.match(perms, /shrink-0 border-t/)
    assert.doesNotMatch(perms, /sticky bottom-0/)
  })
})

describe('Portuguese uses one variant', () => {
  it('pt.json is Brazilian: no European forms like "prima" or "por si"', () => {
    const pt = readFileSync(join(root, 'src/renderer/src/i18n/locales/pt.json'), 'utf8')
    assert.doesNotMatch(pt, /\bprima\b|\bpor si\b/)
  })
})

describe('wording of the re-add notice', () => {
  const read = (code: string): Record<string, string> =>
    JSON.parse(readFileSync(join(root, `src/renderer/src/i18n/locales/${code}.json`), 'utf8'))

  it('ru names the pane without quotes, like accessibility.copied', () => {
    const ru = read('ru')
    assert.doesNotMatch(ru['accessibility.copied'], /[«»]/)
    assert.doesNotMatch(ru['accessibility.copiedNotTrusted'], /[«»]/)
  })

  it('pt says "da Acessibilidade"', () => {
    assert.match(read('pt')['accessibility.copiedNotTrusted'], /da Acessibilidade/)
  })
})
