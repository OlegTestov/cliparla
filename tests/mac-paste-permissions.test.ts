/** Paste uses only the signed CGEvent helper: no Automation entitlement or usage text. */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const entitlements = readFileSync('build/entitlements.mac.plist', 'utf8')

describe('packaged macOS paste permissions', () => {
  it('declares no Automation entitlement and no Apple Events usage text', () => {
    assert.equal(pkg.build.mac.extendInfo.NSAppleEventsUsageDescription, undefined)
    assert.doesNotMatch(entitlements, /apple-events/)
  })

  it('ships the helper in Contents/Resources/bin and signs it', () => {
    assert.equal(pkg.build.hardenedRuntime ?? pkg.build.mac.hardenedRuntime, true)
    const copied = pkg.build.mac.extraResources.find((r: { to: string }) => r.to === 'bin') as {
      from: string
    }
    assert.equal(copied.from, 'native/build')
    assert.ok(pkg.build.mac.binaries.includes('Contents/Resources/bin/cliparla-paste'))
  })

  it('npm run dev builds the helper first and does not stop if that fails', () => {
    assert.match(pkg.scripts.predev, /build-paste-helper\.sh \|\|/)
  })

  it('the up-to-date check compares the binary with the source and with the script itself', () => {
    const script = readFileSync('tools/build-paste-helper.sh', 'utf8')
    assert.match(script, /-nt "\$source"/)
    assert.match(script, /build_helper cliparla-paste native\/paste-helper\/main\.swift/)
    assert.match(script, /-nt tools\/build-paste-helper\.sh/)
  })

  it('builds the helper before every macOS package', () => {
    for (const name of ['package', 'package:signed', 'build:mac', 'package:review']) {
      assert.match(pkg.scripts[name], /build:native/, name)
    }
    assert.ok(existsSync('native/paste-helper/main.swift'))
    assert.match(readFileSync('native/paste-helper/main.swift', 'utf8'), /AXIsProcessTrusted/)
  })
})
