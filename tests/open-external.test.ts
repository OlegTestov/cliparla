import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { isSafeExternalUrl } = require('../src/main/ipc/app')

describe('open-external', () => {
  it('allows only https links', () => {
    assert.equal(isSafeExternalUrl('https://aistudio.google.com/app/apikey'), true)
    for (const bad of [
      'http://example.org',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'x',
      5,
      null
    ]) {
      assert.equal(isSafeExternalUrl(bad), false, String(bad))
    }
  })
})
