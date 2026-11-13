/**
 * Removing the API key needs a second, explicit click.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createRemoveConfirm } = require('../src/renderer/src/settings/remove-confirm')

describe('remove key confirmation', () => {
  it('the first click only asks; nothing is removed', async () => {
    let removed = 0
    const c = createRemoveConfirm(async () => void removed++)
    c.ask()
    assert.equal(c.asking(), true)
    assert.equal(removed, 0)
  })

  it('confirming removes once; cancelling removes nothing', async () => {
    let removed = 0
    const c = createRemoveConfirm(async () => void removed++)
    c.ask()
    c.cancel()
    await c.confirm()
    assert.equal(removed, 0)

    c.ask()
    await c.confirm()
    await c.confirm()
    assert.equal(removed, 1)
    assert.equal(c.asking(), false)
  })

  it('the Remove button opens the question instead of removing', () => {
    const src = readFileSync(
      `${__dirname}/../src/renderer/src/settings/components/ApiKeySection.tsx`,
      'utf8'
    )
    assert.match(src, /onClick=\{remover\.ask\}/)
    assert.match(src, /remover\.confirm\(\)/)
    assert.doesNotMatch(src, /onClick=\{handleRemove\}/)
  })

  it('keyboard: Escape cancels the question only, focus returns, Replace closes it', () => {
    const src = readFileSync(
      `${__dirname}/../src/renderer/src/settings/components/ApiKeySection.tsx`,
      'utf8'
    )
    assert.match(
      src,
      /e\.key !== 'Escape'[\s\S]*stopImmediatePropagation\(\)[\s\S]*remover\.cancel\(\)/
    )
    assert.match(src, /ref=\{removeButton\}/)
    assert.match(src, /removeButton\.current\?\.focus\(\)/)
    assert.match(src, /onClick=\{cancelRemove\}/)
    assert.match(src, /remover\.cancel\(\)\s*setReplacing\(true\)/)
  })
})
