/**
 * Hosted-service code is gone: modules cannot be imported and dependencies are not installed.
 */

import './helpers/electron-stub'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appState } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('no hosted modules', () => {
  it('the only runtime dependencies are the ones the app uses', () => {
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@google/genai',
      'electron-store',
      'i18next',
      'react',
      'react-dom',
      'react-i18next'
    ])
  })

  it('hosted-era helpers are gone', () => {
    const errors = require('../src/main/core/errors')
    for (const name of ['createAuthError', 'createValidationError', 'fetchWithTimeout']) {
      assert.equal(name in errors, false, name)
    }
    assert.ok(!('AUTH_EXPIRED' in errors.ERROR_CODES))
    assert.equal('getSetupWindow' in require('../src/main/core/window-manager'), false)
  })

  it('has no backend folder, env files or release feed', () => {
    assert.ok(!existsSync(join(root, 'backend')))
    assert.ok(!existsSync(join(root, '.env')))
    assert.equal(pkg.build.publish, undefined)
    assert.equal(pkg.build.protocols, undefined)
  })

  it('the preload bridge exposes no account, credit or update calls', () => {
    const preload = readFileSync(join(root, 'src', 'preload', 'index.ts'), 'utf8')
    assert.ok(!/signOut|SignIn|Credit|Checkout|Feedback|UpdateStatus|installUpdate/i.test(preload))
  })
})

describe('app identity', () => {
  it('uses its own name, bundle id and data directory', () => {
    assert.equal(pkg.build.appId, 'dev.cliparla.app')
    assert.equal(pkg.build.productName, 'Cliparla')
    require('../src/main/core/identity')
    assert.equal(appState.name, 'Cliparla')
    assert.ok(String(appState.paths.get('userData')).endsWith('/Cliparla'))
  })

  it('keeps an explicit --user-data-dir and only defaults to its own folder otherwise', () => {
    const identity = require.resolve('../src/main/core/identity')

    appState.switches.add('user-data-dir')
    appState.paths.set('userData', '/tmp/explicit-profile')
    delete require.cache[identity]
    require('../src/main/core/identity')
    assert.equal(appState.paths.get('userData'), '/tmp/explicit-profile')

    appState.switches.clear()
    delete require.cache[identity]
    require('../src/main/core/identity')
    assert.ok(String(appState.paths.get('userData')).endsWith('/Cliparla'))
  })

  it('stores the key under its own entry in its own config file', () => {
    const store = readFileSync(join(root, 'src/main/services/store.ts'), 'utf8')
    assert.match(store, /name: 'config'/)
    assert.ok(!/keychain|service:/i.test(store))
  })
})
