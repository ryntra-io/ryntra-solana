import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COMPONENT_COPY } from '../../components/copy.ts'
import { REFERENCE_WORDS, SESSION_WORDS } from '../../lib/stocks.ts'
import { COMPANY_COPY } from '../invest/company-copy.ts'
import { COMPANY_PATH_COPY } from '../invest/company-path-copy.ts'
import { DETAILS_COPY } from '../invest/details-copy.ts'
import { TRADE_COPY } from '../trade/copy.ts'
import { MARKETS_COPY } from './copy.ts'

/*
 * «Українська всюди» (M22): the screens that spoke English in Ukrainian —
 * Markets' four lists and the search, the asset's «Деталі», Trade — now say
 * every word in the person's language. These checks read every word of their
 * dictionaries, functions called with a placeholder: the Ukrainian carries no
 * English word, the English no Cyrillic one. The names the product keeps in
 * every language — Ryntra, the venue, the chain, the chart source, the tokens
 * the fees are paid in — are the only Latin words a Ukrainian line may hold;
 * since «Шлях компанії» (M24) also «IPO», the step the web's Ukrainian names so;
 * since M45 «Ledger» and its Solana app's own setting «Blind signing», named as the device names it.
 * Since AG-2 the wallets a person can switch to, by their own names: «Phantom», «Solflare», «Seeker».
 */

const KEPT_NAMES = ['Ryntra', 'Jupiter', 'GeckoTerminal', 'Solana', 'PreStocks', 'USDC', 'SOL', 'IPO', 'Ledger', 'Blind signing', 'Phantom', 'Solflare', 'Seeker']
const PLACEHOLDER = '⁂'

/** Every string a dictionary can say, its functions called with placeholders (and a boolean's other branch). */
function everyLine(value, path = '') {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') {
    const lines = [[path, value(PLACEHOLDER, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER, [])]]
    if (/earlier/.test(value.toString())) lines.push([`${path}(false)`, value(false)])
    return lines
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => everyLine(inner, path ? `${path}.${key}` : key))
  }
  return []
}

function englishWords(line) {
  let rest = line
  for (const name of KEPT_NAMES) rest = rest.split(name).join(' ')
  return rest.match(/[A-Za-z]{2,}/g) ?? []
}

const DICTIONARIES = {
  markets: MARKETS_COPY,
  trade: TRADE_COPY,
  details: DETAILS_COPY,
  company: COMPANY_COPY,
  companyPath: COMPANY_PATH_COPY,
  components: COMPONENT_COPY,
  sessions: SESSION_WORDS,
  references: REFERENCE_WORDS,
}

test('the Ukrainian of the lists, the search, the asset’s details, Trade and the shared components holds no English word', () => {
  for (const [name, copy] of Object.entries(DICTIONARIES)) {
    const found = everyLine(copy.uk)
      .map(([path, line]) => [path, englishWords(line)])
      .filter(([, words]) => words.length > 0)
    assert.deepEqual(found, [], `${name}: English words in the Ukrainian`)
  }
})

test('the English says it in English, every line of it', () => {
  for (const [name, copy] of Object.entries(DICTIONARIES)) {
    const cyrillic = everyLine(copy.en).filter(([, line]) => /[А-Яа-яІіЇїЄєҐґ]/.test(line))
    assert.deepEqual(cyrillic, [], `${name}: Cyrillic in the English`)
  }
})

test('both languages carry the same words, none of them left empty', () => {
  for (const [name, copy] of Object.entries(DICTIONARIES)) {
    const en = everyLine(copy.en).map(([path]) => path)
    const uk = everyLine(copy.uk).map(([path]) => path)
    assert.deepEqual(uk, en, `${name}: the same keys in the same order`)
    const empty = everyLine(copy.uk).filter(([, line]) => line.trim().length === 0)
    assert.deepEqual(empty, [], `${name}: an empty Ukrainian line`)
  }
})

test('the screener speaks the web’s words: Усі · Меми · Крипта · Акції · Приватні · Обране, «У тренді», the web’s sessions', () => {
  assert.deepEqual(Object.values(MARKETS_COPY.uk.tabs), ['Усі', 'Меми', 'Крипта', 'Акції', 'Приватні', 'Обране'])
  assert.deepEqual(Object.values(MARKETS_COPY.en.tabs), ['All', 'Memes', 'Crypto', 'Stocks', 'Private', 'Watchlist'])
  assert.equal(MARKETS_COPY.uk.notAShare, 'Це не акція')
  assert.equal(MARKETS_COPY.uk.search, 'Назва, тікер або адреса')
  assert.equal(SESSION_WORDS.uk.market, 'Сесія відкрита')
  assert.equal(SESSION_WORDS.uk.closed, 'Біржа зачинена')
  assert.equal(REFERENCE_WORDS.uk['last-available'], 'Останній доступний')
  assert.deepEqual(
    Object.values(MARKETS_COPY.uk.sorts).map((sort) => sort.label),
    ['У тренді', 'Зростають', 'Падають', 'Ліквідність', 'До біржі'],
  )
  assert.equal(COMPONENT_COPY.uk.searchPlaceholder, 'Назва, тікер або адреса')
})

test('a count says its noun in the Ukrainian plural: 1 результат, 3 результати, 5 і 11 результатів, 21 результат', () => {
  const results = MARKETS_COPY.uk.results
  assert.equal(results(1), '1 результат')
  assert.equal(results(3), '3 результати')
  assert.equal(results(5), '5 результатів')
  assert.equal(results(11), '11 результатів')
  assert.equal(results(21), '21 результат')
  assert.equal(results(24), '24 результати')
  assert.equal(MARKETS_COPY.en.results(1), '1 result')
  assert.equal(MARKETS_COPY.en.results(2), '2 results')
  assert.equal(MARKETS_COPY.uk.notListed(2), '2 активи зараз не торгуються')
})
