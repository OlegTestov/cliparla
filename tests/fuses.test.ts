/**
 * Release builds turn the risky Electron fuses off so another local process
 * cannot run the app as plain Node or attach a debugger to it.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

describe('Electron fuses', () => {
  it('release builds disable RunAsNode, NODE_OPTIONS and inspector arguments', () => {
    const fuses = pkg.build.electronFuses
    assert.equal(fuses.runAsNode, false)
    assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false)
    assert.equal(fuses.enableNodeCliInspectArguments, false)
  })

  it('release builds verify the ASAR and load code only from it', () => {
    const fuses = pkg.build.electronFuses
    assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true)
    assert.equal(fuses.onlyLoadAppFromAsar, true)
    assert.notEqual(pkg.build.asar, false)
  })

  it('cookie encryption stays off: the app keeps no cookies, and it cost a second keychain prompt at launch', () => {
    assert.equal(pkg.build.electronFuses.enableCookieEncryption, false)
  })

  it('there is a separate review build that keeps the inspector available', () => {
    const script: string = pkg.scripts['package:review']
    assert.match(script, /enableNodeCliInspectArguments=true/)
    assert.ok(!/package:review/.test(pkg.scripts.package), 'the default build stays locked down')
    assert.ok(!/enableNodeCliInspectArguments=true/.test(pkg.scripts.package))
  })
})
