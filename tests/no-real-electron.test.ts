/**
 * Tests must never load the real `electron` package: on first use it downloads
 * its binary, and parallel test files race each other doing so.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(__dirname, '..')

function run(modules: string[]) {
  const script = `
    const Module = require('node:module')
    const load = Module._load
    Module._load = function (request, ...rest) {
      if (request === 'electron') throw new Error('REAL_ELECTRON_LOADED')
      return load.call(this, request, ...rest)
    }
    for (const m of ${JSON.stringify(modules.map((m) => join(root, m)))}) require(m)
  `
  return spawnSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), '-e', script], {
    cwd: root,
    encoding: 'utf8'
  })
}

describe('tests that use real modules do not need the electron binary', () => {
  it('logger, errors and the dictation state machine load without electron', () => {
    const result = run([
      './src/main/core/logger',
      './src/main/core/errors',
      './src/main/services/dictation/state-machine'
    ])
    assert.equal(result.status, 0, result.stderr)
  })

  it('no test file imports electron directly', () => {
    const { readdirSync, readFileSync } = require('node:fs')
    const offenders = readdirSync(join(root, 'tests'))
      .filter((f: string) => f.endsWith('.test.ts'))
      .filter((f: string) =>
        new RegExp("from 'elec" + "tron'|require\\('elec" + "tron'\\)").test(
          readFileSync(join(root, 'tests', f), 'utf8')
        )
      )
    assert.deepEqual(offenders, [])
  })
})
