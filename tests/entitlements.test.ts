/**
 * The signed app and its helpers must not let other local programs inject code into them:
 * no DYLD environment variables, no library-validation opt-out.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
const keys = (file: string): string[] =>
  [...readFileSync(join(__dirname, '..', file), 'utf8').matchAll(/<key>([^<]+)<\/key>/g)].map(
    (m) => m[1]
  )

describe('entitlements', () => {
  for (const field of ['entitlements', 'entitlementsInherit'] as const) {
    it(`${field} has no injection-enabling keys`, () => {
      const list = keys(pkg.build.mac[field])
      assert.ok(list.length > 0)
      assert.ok(!list.includes('com.apple.security.cs.allow-dyld-environment-variables'))
      assert.ok(!list.includes('com.apple.security.cs.disable-library-validation'))
    })
  }

  it('the keys the app does need are still there', () => {
    const list = keys(pkg.build.mac.entitlements)
    for (const key of [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input'
    ]) {
      assert.ok(list.includes(key), key)
    }
  })

  it('has no Automation entitlement: paste needs only Accessibility', () => {
    for (const field of ['entitlements', 'entitlementsInherit'] as const) {
      assert.ok(!keys(pkg.build.mac[field]).includes('com.apple.security.automation.apple-events'))
    }
  })
})
