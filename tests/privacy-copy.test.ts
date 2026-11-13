/**
 * Onboarding, About and README must make the same privacy statement, and it
 * must not claim that data stays on the computer.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const en = JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales/en.json'), 'utf8'))
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const privacy = readFileSync(join(root, 'PRIVACY.md'), 'utf8')

const STATEMENT =
  'Your key is stored encrypted on this computer; screen images and voice go directly to Google with your key.'

describe('privacy statement', () => {
  it('onboarding, About and README say exactly the same thing', () => {
    assert.equal(en['setup.privacy'], STATEMENT)
    assert.equal(en['settings.about.privacy'], STATEMENT)
    assert.ok(readme.includes(STATEMENT), 'README must contain the statement verbatim')
    assert.ok(privacy.includes(STATEMENT), 'PRIVACY.md must contain the statement verbatim')
  })

  it('nothing claims that data stays on the computer', () => {
    const text = JSON.stringify(en) + readme + privacy
    assert.ok(!/data stay on your computer/i.test(text))
    assert.ok(!/stay on your computer/i.test(text))
  })

  it('About keeps the license line separate from the privacy line', () => {
    assert.match(en['settings.about.license'], /MIT/)
    assert.ok(!en['settings.about.license'].includes('data'))
  })
})
