/**
 * Proves the leak gate works: every kind of leak is caught in a temporary copy
 * of the repo, and the real repo passes. Canaries are assembled at run time so
 * this file itself stays clean.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(__dirname, '..')
const gate: {
  scan(dir: string): Array<{ file: string; rule: string }>
} = require('../tools/leak-gate.mjs')

const j = (...parts: string[]) => parts.join('')

const CANARIES: Array<{ rule: string; line: string }> = [
  {
    rule: 'jwt',
    line: j(
      't = ',
      'eyJ',
      'hbGciOiJIUzI1NiJ9.',
      'eyJ',
      'zdWIiOiIxMjM0NTY3ODkwIn0.',
      'abcdefghij_klmnop'
    )
  },
  { rule: 'payment-style-key', line: j('key = ', 'sk_', 'live_', 'a'.repeat(24)) },
  { rule: 'payment-style-key', line: j('key = ', 'pk_', 'test_', 'b'.repeat(24)) },
  { rule: 'webhook-secret', line: j('secret = ', 'wh', 'sec_', 'c'.repeat(20)) },
  { rule: 'google-api-key', line: j('k = "', 'AI', 'za', 'D'.repeat(35), '"') },
  { rule: 'private-key-block', line: j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----') },
  { rule: 'email-address', line: j('mail = jane.doe', '@mailhost.dev') },
  { rule: 'email-address', line: j('cc: a.b+c', '@sub.mailhost.co.uk;') },
  { rule: 'home-path', line: j('path = /Users', '/someone/Code') }
]

describe('leak gate', () => {
  let copy: string

  before(() => {
    copy = mkdtempSync(join(tmpdir(), 'leak-gate-'))
    cpSync(root, copy, {
      recursive: true,
      filter: (src) => !/\/(node_modules|\.git|out|dist)(\/|$)/.test(src)
    })
  })

  after(() => rmSync(copy, { recursive: true, force: true }))

  it('the real repository passes', () => {
    assert.deepEqual(gate.scan(root), [])
  })

  it('catches every canary content rule', () => {
    CANARIES.forEach((canary, index) => {
      writeFileSync(join(copy, `canary-${index}.txt`), `${canary.line}\n`)
    })
    const findings = gate.scan(copy)
    CANARIES.forEach((canary, index) => {
      assert.ok(
        findings.some((f) => f.file === `canary-${index}.txt` && f.rule === canary.rule),
        `rule ${canary.rule} missed canary ${index}`
      )
    })
  })

  it('catches forbidden files and folders', () => {
    writeFileSync(join(copy, '.env'), 'A=1\n')
    writeFileSync(join(copy, '.env.local'), 'A=1\n')
    writeFileSync(join(copy, 'cert.p12'), 'x')
    const rules = new Map(gate.scan(copy).map((f) => [f.file, f.rule]))
    assert.equal(rules.get('.env'), 'env-file')
    assert.equal(rules.get('.env.local'), 'env-file')
    assert.equal(rules.get('cert.p12'), 'signing-material')
  })

  it('addresses in the generated notices pass, private patterns still apply there', () => {
    const notices = join(copy, 'THIRD_PARTY_NOTICES.md')
    writeFileSync(notices, j('Copyright (c) Someone <someone', '@mailhost.dev>\n'))
    assert.ok(!gate.scan(copy).some((f) => f.file === 'THIRD_PARTY_NOTICES.md'))
    const local = join(copy, '.leak-gate.local')
    writeFileSync(local, 'someone@mailhost\n')
    assert.ok(
      gate.scan(copy).some((f) => f.file === 'THIRD_PARTY_NOTICES.md' && f.rule === 'local-pattern')
    )
    rmSync(local)
    writeFileSync(join(copy, 'plain.md'), j('Copyright (c) Someone <someone', '@mailhost.dev>\n'))
    assert.ok(gate.scan(copy).some((f) => f.file === 'plain.md' && f.rule === 'email-address'))
    rmSync(join(copy, 'plain.md'))
    rmSync(notices)
  })

  it('file names and ssh remotes that only look like addresses are not flagged', () => {
    writeFileSync(
      join(copy, 'look.md'),
      'icon@2x.png, banner@3x.jpg, git@github.com:org/repo.git, pack@next.tar, host: a@b.test\n'
    )
    assert.ok(!gate.scan(copy).some((f) => f.file === 'look.md'))
    rmSync(join(copy, 'look.md'))
  })

  it('internal ssh remotes and real-looking domains that end like file names are still flagged', () => {
    for (const line of [
      j('git', '@gitlab.bigcorp.com:team/secret.git'),
      j('jane', '@bigcorp.md'),
      j('jane', '@bigcorp.zip'),
      j('jane', '@bigcorp.com.png')
    ]) {
      writeFileSync(join(copy, 'real.md'), `${line}\n`)
      assert.ok(
        gate.scan(copy).some((f) => f.file === 'real.md' && f.rule === 'email-address'),
        line
      )
    }
    rmSync(join(copy, 'real.md'))
  })

  it('GitHub noreply and example addresses are allowed', () => {
    writeFileSync(
      join(copy, 'ok.md'),
      '1+user@users.noreply.github.com, me@example.com, you@example.org, x@example.net\n'
    )
    assert.ok(!gate.scan(copy).some((f) => f.file === 'ok.md'))
    rmSync(join(copy, 'ok.md'))
  })

  it('reads private patterns from the git-ignored local file, and skips the check without it', () => {
    const local = join(copy, '.leak-gate.local')
    writeFileSync(join(copy, 'note.txt'), ['this mentions secret', 'codename once\n'].join('-'))
    assert.ok(!gate.scan(copy).some((f) => f.file === 'note.txt'), 'no local file: no check')
    writeFileSync(
      local,
      ['# the word secret', 'codename is here\n\nSECRET[- ]?CODENAME\n'].join('-')
    )
    const hits = gate.scan(copy).filter((f) => f.rule === 'local-pattern')
    assert.deepEqual(
      hits.map((f) => f.file),
      ['note.txt'],
      'the local file itself is not scanned'
    )
    rmSync(local)
    rmSync(join(copy, 'note.txt'))
  })

  it('warns when the private patterns file is missing, and --require-local makes that fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leak-gate-local-'))
    try {
      writeFileSync(join(dir, 'README.md'), 'clean\n')
      const run = (...args: string[]) =>
        spawnSync('node', [join(root, 'tools/leak-gate.mjs'), ...args, dir], { encoding: 'utf8' })
      const plain = run()
      assert.equal(plain.status, 0)
      assert.match(plain.stderr, /not checked/)
      assert.equal(run('--require-local').status, 1)
      writeFileSync(join(dir, '.leak-gate.local'), 'nothing-here-zzz\n')
      assert.equal(run('--require-local').status, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--require-local also fails when the file holds no real rule (empty or comments only)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leak-gate-empty-'))
    try {
      writeFileSync(join(dir, 'README.md'), 'clean\n')
      const run = () =>
        spawnSync('node', [join(root, 'tools/leak-gate.mjs'), '--require-local', dir], {
          encoding: 'utf8'
        })
      writeFileSync(join(dir, '.leak-gate.local'), '')
      assert.equal(run().status, 1)
      writeFileSync(join(dir, '.leak-gate.local'), '# only a comment\n\n   \n')
      assert.equal(run().status, 1)
      assert.match(run().stderr, /no rules/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs and reports when started through a symlinked path (as /tmp is on macOS)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leak-gate-link-'))
    try {
      writeFileSync(join(dir, 'bad.txt'), j('mail = jane.doe', '@mailhost.dev\n'))
      const link = join(dir, 'link-to-tools')
      symlinkSync(join(root, 'tools'), link)
      const result = spawnSync('node', [join(link, 'leak-gate.mjs'), dir], { encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /email-address/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits non-zero from the command line when something leaks', () => {
    const { spawnSync } = require('node:child_process')
    writeFileSync(join(copy, 'README.md'), 'clean\n')
    const result = spawnSync('node', [join(root, 'tools/leak-gate.mjs'), copy], {
      encoding: 'utf8'
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /finding/)
    assert.ok(
      !result.stderr.includes(j('AI', 'za', 'D'.repeat(35))),
      'matched secrets are redacted'
    )
  })
})

describe('leak gate in a git repository', () => {
  let repo: string
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], {
      cwd: repo,
      encoding: 'utf8'
    })
  const canary = j('mail = jane.doe', '@mailhost.dev')

  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'leak-gate-git-'))
    git('init', '-q', '-b', 'master')
    writeFileSync(join(repo, '.gitignore'), 'local-tool/\n.env\n')
    writeFileSync(join(repo, 'a.txt'), 'clean\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
  })

  after(() => rmSync(repo, { recursive: true, force: true }))

  it('ignored local folders do not fail the scan', () => {
    mkdirSync(join(repo, 'local-tool'))
    writeFileSync(join(repo, 'local-tool', 'meta.json'), `${canary}\n`)
    writeFileSync(join(repo, '.env'), 'A=1\n')
    assert.deepEqual(gate.scan(repo), [])
  })

  it('untracked files that are not ignored are still scanned', () => {
    writeFileSync(join(repo, 'new.txt'), `${canary}\n`)
    assert.ok(gate.scan(repo).some((f) => f.file === 'new.txt' && f.rule === 'email-address'))
    rmSync(join(repo, 'new.txt'))
  })

  it('the staged check passes when nothing sensitive is staged', () => {
    writeFileSync(join(repo, 'b.txt'), 'fine\n')
    git('add', 'b.txt')
    assert.deepEqual(gate.scanStaged(repo), [])
  })

  it('the staged check fails for sensitive content and for force-added ignored files', () => {
    writeFileSync(join(repo, 'c.txt'), `${canary}\n`)
    git('add', 'c.txt')
    git('add', '-f', '.env')
    const findings = gate.scanStaged(repo)
    assert.ok(findings.some((f) => f.file === 'c.txt' && f.rule === 'email-address'))
    assert.ok(findings.some((f) => f.file === '.env' && f.rule === 'env-file'))
  })

  it('--staged exits 1 from the command line while something sensitive is staged', () => {
    const result = spawnSync('node', [join(root, 'tools/leak-gate.mjs'), '--staged', repo], {
      encoding: 'utf8'
    })
    assert.equal(result.status, 1)
    git('reset', '-q')
    const clean = spawnSync('node', [join(root, 'tools/leak-gate.mjs'), '--staged', repo], {
      encoding: 'utf8'
    })
    assert.equal(clean.status, 0)
  })
})
