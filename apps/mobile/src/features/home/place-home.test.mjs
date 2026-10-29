import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PLACE_HOME_COPY } from './place-copy.ts'

// The source without its comments, so a test reads what runs.
const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const HOME = code('screens/home/investor.tsx')
const BLOCKS = code('screens/home/place-blocks.tsx')
const ROW = code('screens/history/history-row.tsx')
const PICK = code('screens/home/buy-pick-sheet.tsx')
const ASSET = code('screens/asset/index.tsx')
const PORTFOLIO = code('screens/portfolio/index.tsx')

test('the eye hides every sum of Home: «Усього», the day’s change and the amounts of «Останнє»', () => {
  assert.match(HOME, /hidden \? HIDDEN_AMOUNT/)
  assert.match(BLOCKS, /const hidden = useAmountsHidden\(\)/)
  assert.match(BLOCKS, /hidden=\{hidden\}/)
  // The row's own words and what a screen reader hears both read the mask.
  assert.match(ROW, /const amounts = hidden \? HIDDEN_AMOUNT : historyAmounts\(item\)/)
  assert.equal(ROW.match(/historyAmounts\(item\)/g)?.length, 1)
})

test('Home’s four actions, in the new look’s order, open their places (NEW-LOOK §3)', () => {
  assert.match(HOME, /const ACTIONS: readonly HomeAction\[\] = \['buy', 'swap', 'send', 'receive'\]/)
  assert.match(HOME, /swap: SWAP_PATH,/)
  assert.match(HOME, /send: '\/money\/send'/)
  assert.match(HOME, /receive: '\/money\/receive'/)
  assert.deepEqual(Object.values(PLACE_HOME_COPY.uk.actions), ['Купити', 'Обмін', 'Надіслати', 'Отримати'])
  assert.deepEqual(Object.values(PLACE_HOME_COPY.en.actions), ['Buy', 'Swap', 'Send', 'Receive'])
})

test('one card of attention: a signature waiting first, else the newest unread note, else none', () => {
  assert.match(HOME, /if \(attempt && attempt\.state !== 'SETTLED'\) \{/)
  assert.match(HOME, /\} else if \(note\) \{/)
  assert.match(HOME, /surface\?\.recent\.find\(\(item\) => item\.unread\)/)
  // No orange on a note: orange is the one action, the brand and the current place.
  assert.doesNotMatch(HOME, /tone="brand"/)
})

test('both languages carry every word of the new Home, «ти» and neutral to gender', () => {
  const keys = Object.keys(PLACE_HOME_COPY.en)
  assert.deepEqual(Object.keys(PLACE_HOME_COPY.uk), keys)
  for (const locale of ['en', 'uk']) {
    for (const key of keys) {
      const value = PLACE_HOME_COPY[locale][key]
      if (typeof value === 'string') assert.ok(value.length > 0, `${locale}.${key}`)
    }
  }
  assert.equal(PLACE_HOME_COPY.uk.updated('о 18:42'), 'оновлено о 18:42')
  assert.doesNotMatch(JSON.stringify(PLACE_HOME_COPY.uk), /готовий|готова|увійшов|увійшла|Seed Vault/i)
})

test('«Купити» opens «Що купити» — the search, the popular coins and companies — and a pick opens its purchase', () => {
  // The operator’s word of 2026-10-17: the popular companies live in the «Купити» sheet, not as a grid of cards on Home.
  assert.match(HOME, /action === 'buy' \? setPicking\(true\)/)
  assert.match(HOME, /<BuyPickSheet visible=\{picking\} onClose=\{\(\) => setPicking\(false\)\} \/>/)
  assert.doesNotMatch(HOME, /usePopularCompanies|TileGrid|ShelfTile|RulesBlock/)
  assert.match(PICK, /useMarkets\('crypto', visible && needle\.length === 0\)/)
  assert.match(PICK, /usePopularCompanies\(visible \? 60_000 : 120_000\)/)
  assert.match(PICK, /params: \{ mint, symbol, \.\.\.\(category \? \{ category \} : \{\}\), buy: '1' \}/)
  // A coin’s page hands its purchase on at once; a company’s opens its own purchase through `buying`.
  assert.match(ASSET, /const openCoinBuy = openBuy && reminder === null && detail !== null && !isStock/)
  assert.match(ASSET, /pathname: '\/trade', params: \{ mint, symbol: coinSymbol, side: 'buy' \}/)
  // An empty Portfolio’s one way on is the same sheet.
  assert.match(PORTFOLIO, /<BuyPickSheet visible=\{picking\} onClose=\{\(\) => setPicking\(false\)\} \/>/)
  assert.equal(PLACE_HOME_COPY.uk.pickTitle, 'Що купити')
  assert.equal(PLACE_HOME_COPY.en.pickTitle, 'What to buy')
})

test('«Квитанцію збережено» and «Уся історія» open «Портфель · Історія»; an operation of «Останнє» opens its receipt', () => {
  assert.match(BLOCKS, /const openHistory = \(\) => router\.navigate\(PORTFOLIO_HISTORY_PATH as never\)/)
  assert.match(BLOCKS, /onPress=\{\(\) => setPicked\(row\)\}/)
  assert.match(BLOCKS, /<ReceiptSheet row=\{picked\}/)
  for (const path of [
    'screens/trade/index.tsx',
    'screens/money/send.tsx',
    'screens/invest/buy-sheet.tsx',
    'screens/invest/convert-sheet.tsx',
    'screens/invest/sell-sheet.tsx',
  ]) {
    const source = code(path)
    assert.match(source, /openPlace\(PORTFOLIO_HISTORY_PATH\)/, path)
    assert.doesNotMatch(source, /push\('\/history'/, path)
  }
})

test('an empty wallet’s Home offers «Поповнити» beside its one line', () => {
  assert.match(HOME, /title=\{copy\.topUp\}/)
  assert.match(HOME, /<TopUpSheet\s+visible=\{toppingUp\}/)
})

test('the holdings’ change is the venue’s 24 hours: «за добу» on Home and in Portfolio, never «за день» or «сьогодні» (ST-5)', () => {
  assert.match(HOME, /\$\{portfolioWords\.overDay\}/)
  assert.doesNotMatch(HOME, /copy\.today/)
  // Since C4f the wallet's own move says so under a value that holds Phoenix's collateral: «гаманця за добу».
  assert.match(PORTFOLIO, /\? copy\.walletOverDay : copy\.overDay/)
  assert.match(PORTFOLIO, /\$\{dayWord\}/)
})
