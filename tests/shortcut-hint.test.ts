/** The recording hint on a Mac names every modifier a shortcut may use, including Control (the new defaults use it). */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(__dirname, '../src/renderer/src/i18n/locales')

describe('shortcut recording hint (macOS)', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(`${file} mentions Command, Control and Option`, () => {
      const hint: string = JSON.parse(readFileSync(join(dir, file), 'utf8'))[
        'settings.shortcut.recordingHintMac'
      ]
      for (const key of ['Command', 'Control', 'Option']) assert.ok(hint.includes(key), hint)
    })
  }
})
