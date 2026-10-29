import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { failureLine, signInFailureLine } from './signing-copy.ts'

/* Every English line a sign-in or a wallet request may end with has its Ukrainian (ST-2: «Sign-in needs the network»
   was said in English inside the Ukrainian interface). The lines are read from the two files that say them. */

const SOURCES = ['../session/session-client.ts', './use-wallet.ts']

function linesSaid() {
  const said = new Set()
  for (const file of SOURCES) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const match of text.matchAll(/'((?:The|No|Sign-in|Too many|You) [^']+\.)'/g)) said.add(match[1])
  }
  return [...said]
}

test('every failure line the phone says has its Ukrainian; English stays English', () => {
  const lines = linesSaid()
  assert.ok(lines.length >= 12, `read ${lines.length} lines`)
  for (const line of lines) {
    if (line.startsWith('The wallet did not sign the sign-in')) continue // the Ledger line has its own copy
    const uk = failureLine(line, 'uk')
    assert.notEqual(uk, line, `no Ukrainian for: ${line}`)
    assert.match(uk, /[а-яіїєґ]/i, line)
    assert.equal(failureLine(line, 'en'), line)
  }
})

test('the outdated line names the version in Ukrainian; a line not known is kept as it is', () => {
  assert.equal(
    failureLine('Update Ryntra to sign in — the server needs version 1.15.0 or later.', 'uk'),
    'Онови Ryntra, щоб увійти, — потрібна версія 1.15.0 або новіша.',
  )
  assert.equal(
    failureLine('Update Ryntra to sign in — the server needs a newer version.', 'uk'),
    'Онови Ryntra, щоб увійти, — потрібна новіша версія.',
  )
  assert.equal(failureLine('Something new.', 'uk'), 'Something new.')
  assert.equal(
    signInFailureLine(
      { kind: 'network', step: 'challenge', message: 'Sign-in needs the network. Try again when you are back online.' },
      'uk',
    ),
    'Немає з’єднання з інтернетом — вхід не відбувся. Спробуй ще раз.',
  )
})
