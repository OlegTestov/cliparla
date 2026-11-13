#!/usr/bin/env node
/**
 * Leak gate: scans the whole repository for anything that must never be published.
 *
 *   node tools/leak-gate.mjs [rootDir]            whole project (tracked and unignored files)
 *   node tools/leak-gate.mjs --staged [rootDir]   only what is staged for the next commit
 *   --require-local                               fail when .leak-gate.local (private patterns) is missing; use before publishing
 *
 * Exits 1 and lists file:line plus the rule for every hit. Matched text is not
 * printed in full, so a leaked secret does not end up in CI logs.
 *
 * Patterns are built so that this file does not match its own rules.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'release'])
const MAX_FILE_BYTES = 5 * 1024 * 1024

// Private patterns (names that must never be published) live in a git-ignored file, one regular
// expression per line, case-insensitive, '#' starts a comment. Without the file this check is skipped.
export const LOCAL_RULES_FILE = '.leak-gate.local'

const EMAIL = /[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const ALLOWED_EMAIL = new RegExp(
  [
    '^git@(?:github\\.com|gitlab\\.com|bitbucket\\.org)$',
    '@users\\.noreply\\.github\\.com$',
    '@example\\.(?:com|org|net)$',
    '@[^@]*\\.(?:test|invalid|localhost|example)$',
    '@\\d+x\\.(?:png|jpe?g|gif|svg|webp|ico)$', // retina image names: icon@2x.png
    '@[\\w-]+\\.(?:tar|tgz)$' // package archives: foo@next.tar
  ].join('|'),
  'i'
)

function findMatch(rule, regex, text) {
  if (rule !== 'email-address') return regex.exec(text)
  for (const m of text.matchAll(regex)) if (!ALLOWED_EMAIL.test(m[0])) return m
  return null
}

/** Content rules: [name, regex]. */
const CONTENT_RULES = [
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}[.]eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}/],
  ['payment-style-key', /\b(?:sk|pk|rk)_[A-Za-z0-9_]{10,}/],
  ['webhook-secret', /whsec_[A-Za-z0-9]{8,}/],
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/],
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // Any address except GitHub's noreply form and the reserved example domains
  ['email-address', EMAIL],
  [
    'home-path',
    /\/Users\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+|\/home\/[a-z][a-z0-9._-]*\//
  ]
]

/** The generated notices quote third-party authors' addresses; the private patterns still apply there. */
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md'
const THIRD_PARTY_TEXT = new Set([NOTICES_FILE, 'package-lock.json'])

/** Path rules: file or directory names that must not exist. */
const PATH_RULES = [
  ['env-file', (name) => name === '.env' || (name.startsWith('.env.') && name !== '.env.example')],
  ['signing-material', (name) => /[.](?:p12|pfx|pem|cer|provisionprofile|keystore)$/i.test(name)]
]

function* walk(root, dir = root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) && entry.isDirectory()) continue
    const full = join(dir, entry.name)
    const rel = relative(root, full).split(sep).join('/')
    if (entry.isDirectory()) {
      yield rel // folder names are checked too, even when empty
      yield* walk(root, full)
    } else if (entry.isFile() && entry.name !== LOCAL_RULES_FILE) {
      yield rel
    }
  }
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 })
}

/**
 * Files to scan. In a git repository: tracked files plus untracked files that
 * are not ignored (what a commit could pick up). Ignored local folders are
 * not part of the project and are skipped. Without git: every file.
 */
function listFiles(root) {
  if (!existsSync(join(root, '.git'))) return [...walk(root)]
  const out = git(root, ['ls-files', '-co', '--exclude-standard', '-z']).toString('utf8')
  return out.split('\0').filter(Boolean)
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0)
}

function redact(text) {
  return text.length <= 6 ? '***' : `${text.slice(0, 3)}...(${text.length} chars)`
}

/** Names of every path segment: a forbidden folder anywhere in the path counts. */
function pathFindings(rel) {
  const findings = []
  for (const name of rel.split('/')) {
    for (const [rule, test] of PATH_RULES) {
      if (test(name)) findings.push({ file: rel, line: 0, rule, sample: name })
    }
  }
  return findings
}

function localRules(root) {
  const file = join(root, LOCAL_RULES_FILE)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ['local-pattern', new RegExp(line, 'i')])
}

function contentFindings(rel, buffer, extraRules) {
  if (buffer.length > MAX_FILE_BYTES || isBinary(buffer)) return []
  const findings = []
  buffer
    .toString('utf8')
    .split('\n')
    .forEach((text, index) => {
      for (const [rule, regex] of [...CONTENT_RULES, ...extraRules]) {
        if (THIRD_PARTY_TEXT.has(rel) && rule === 'email-address') continue
        const match = findMatch(rule, regex, text)
        if (!match) continue
        findings.push({ file: rel, line: index + 1, rule, sample: redact(match[0]) })
      }
    })
  return findings
}

/** Scan the whole project (see listFiles). */
export function scan(root) {
  const findings = []
  const extraRules = localRules(root)
  for (const rel of listFiles(root)) {
    findings.push(...pathFindings(rel))
    const full = join(root, rel)
    if (!existsSync(full) || !statSync(full).isFile()) continue
    findings.push(...contentFindings(rel, readFileSync(full), extraRules))
  }
  return findings
}

/** Scan exactly what is staged for the next commit, including force-added ignored files. */
export function scanStaged(root) {
  const findings = []
  const extraRules = localRules(root)
  const names = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  for (const rel of names) {
    findings.push(...pathFindings(rel))
    findings.push(...contentFindings(rel, git(root, ['show', `:${rel}`]), extraRules))
  }
  return findings
}

function main() {
  const args = process.argv.slice(2)
  const staged = args.includes('--staged')
  const rootArg = args.find((a) => !a.startsWith('--'))
  const root = rootArg ?? join(fileURLToPath(import.meta.url), '..', '..')
  if (!existsSync(join(root, LOCAL_RULES_FILE))) {
    console.error(
      `leak-gate: note: ${LOCAL_RULES_FILE} not found, private patterns are not checked`
    )
    if (args.includes('--require-local')) return 1
  } else if (args.includes('--require-local') && localRules(root).length === 0) {
    console.error(`leak-gate: ${LOCAL_RULES_FILE} has no rules, so nothing private is checked`)
    return 1
  }
  const findings = staged ? scanStaged(root) : scan(root)
  if (findings.length === 0) {
    console.log(`leak-gate${staged ? ' (staged)' : ''}: clean`)
    return 0
  }
  console.error(`leak-gate: ${findings.length} finding(s)`)
  for (const f of findings) {
    console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}]  ${f.sample}`)
  }
  return 1
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  process.exit(main())
}
