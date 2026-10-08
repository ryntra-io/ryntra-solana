import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { AUTOINVEST_COPY } from '../autoinvest/copy.ts'
import {
  BUDGET_MIN_USD,
  BUDGET_PRESETS_USD,
  defaultSchedule,
  RULE_DEFAULT_USD,
  RULE_MIN_USD,
} from '../autoinvest/rule-model.ts'
import { USDC_ASSET } from '../trade/trade-model.ts'
import { BUY_COPY } from './buy-copy.ts'
import {
  amountFieldText,
  buyCheckRows,
  buyShares,
  DEFAULT_BUY_USD,
  dollarsRaw,
  isNoRoute,
  MIN_BUY_USD,
  ladderMinimum,
  pickedShare,
  reserveFirstOf,
  ROUTE_MINIMUM_LADDER_USD,
  ROUTE_MINIMUM_RETRY_MS,
  routeMinimumSteps,
  shareOfRaw,
} from './buy-model.ts'
import { INVEST_COPY } from './copy.ts'

/**
 * «Від $1» on the phone (M21, «Чому 10? …
 * Кожний день по долару»; the web's: a purchase, an
 * «Автоінвест» rule and the month's budget from one dollar; the sheets open on
 * $10 — a default, never advice; the purchase's quick choices are shares of
 * the wallet's dollars; a company without a route at the sum says its own
 * minimum from the live quote; the one-time reserve that opens a token's
 * account is its own line in «Перевірка», never a cost.
 */

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const BUY_SHEET = source('../../screens/invest/buy-sheet.tsx')
const RULE_SHEET = source('../../screens/autoinvest/autoinvest-sheet.tsx')
const BUDGET_SHEET = source('../../screens/autoinvest/budget-sheet.tsx')
const USE_BUY = source('./use-buy.ts')
const LADDER = source('./use-route-minimum.ts')

test('a purchase, a rule and the month’s budget start at one dollar; the sheets open on $10, a default and never advice', () => {
  assert.equal(MIN_BUY_USD, 1)
  assert.equal(RULE_MIN_USD, 1)
  assert.equal(BUDGET_MIN_USD, 1)
  assert.equal(DEFAULT_BUY_USD, 10)
  assert.equal(RULE_DEFAULT_USD, 10)
  // The purchase opens on $10 whatever the wallet holds; a rule on «Щотижня · $10».
  assert.match(USE_BUY, /useState\(\(\) => String\(DEFAULT_BUY_USD\)\)/)
  assert.match(RULE_SHEET, /: RULE_DEFAULT_USD\),/)
  const opening = defaultSchedule(Date.parse('2026-09-26T05:10:00.000Z'), 'Europe/Kyiv')
  assert.deepEqual([opening.cadence, opening.weekday, opening.time], ['weekly', 6, '09:00'])
  // The month's budget as on production: a dollar a day for the longest month first, opening on $50.
  assert.deepEqual([...BUDGET_PRESETS_USD], [31, 50, 100, 200])
  assert.match(BUDGET_SHEET, /String\(current \?\? BUDGET_PRESETS_USD\[1\]\)/)
})

test('the quick choices are shares of the wallet’s dollars, never rounded up; a share under a dollar is not offered, none without a wallet', () => {
  // 24.5 USDC: a quarter is $6.12, never rounded up; all of it exactly $24.50.
  assert.equal(shareOfRaw(24_500_000n, 6, 25), 6.12)
  assert.equal(shareOfRaw(24_500_000n, 6, 50), 12.25)
  assert.equal(shareOfRaw(24_500_000n, 6, 75), 18.37)
  assert.equal(shareOfRaw(24_500_000n, 6, 100), 24.5)
  assert.equal(shareOfRaw(0n, 6, 100), 0)
  assert.deepEqual(buyShares(null, 6), [], 'no wallet read — no shares')
  assert.deepEqual(buyShares(0n, 6), [], 'an empty wallet — no shares')
  const three = buyShares(3_000_000n, 6)
  assert.deepEqual(
    three.map((share) => [share.pct, share.usd, share.offered]),
    [
      [25, 0.75, false],
      [50, 1.5, true],
      [75, 2.25, true],
      [100, 3, true],
    ],
  )
  assert.equal(pickedShare(three, 1.5), 50)
  assert.equal(pickedShare(three, 0.75), null, 'a share not offered is never picked')
  assert.equal(pickedShare(three, 2), null)
  // A picked share lands in the field in the field's own language, and reads back as the same share.
  assert.equal(amountFieldText(2.46, 'uk'), '2,46')
  assert.equal(amountFieldText(2.46, 'en'), '2.46')
  assert.equal(amountFieldText(1.5, 'uk'), '1,50')
  assert.equal(amountFieldText(5, 'uk'), '5')
  assert.equal(pickedShare(three, 1.5), pickedShare(three, Number(amountFieldText(1.5, 'uk').replace(',', '.'))))
  // The sheet draws the shares, never fixed sums; a connected wallet's only.
  assert.match(USE_BUY, /rule \|\| !wallet\.address \? \[\] : buyShares\(payRaw/)
  assert.match(BUY_SHEET, /buy\.shares\.map\(\(share\) =>/)
  assert.match(BUY_SHEET, /disabled: !share\.offered/)
  assert.doesNotMatch(BUY_SHEET, /BUY_PRESETS_USD|quickAmounts/)
  assert.doesNotMatch(
    RULE_SHEET,
    /BUY_PRESETS_USD|quickAmounts|choices=\{sums\}/,
    'a rule’s sum is typed: no quick sums',
  )
})

test('no route for the sum: the ladder above it, in order, and only «no route» is answered by a larger sum', () => {
  assert.deepEqual([...ROUTE_MINIMUM_LADDER_USD], [2, 5, 10, 25, 50, 100])
  assert.deepEqual(routeMinimumSteps(1), [2, 5, 10, 25, 50, 100])
  assert.deepEqual(routeMinimumSteps(5), [10, 25, 50, 100], 'only sums above the one asked')
  assert.deepEqual(routeMinimumSteps(7.5), [10, 25, 50, 100])
  assert.deepEqual(routeMinimumSteps(100), [], 'nothing above the ladder is claimed')
  assert.deepEqual(routeMinimumSteps(Number.NaN), [])
  assert.equal(isNoRoute('QUOTE_NO_ROUTE'), true)
  assert.equal(isNoRoute('ORDER_NO_ROUTE'), true)
  assert.equal(isNoRoute('QUOTE_RATE_LIMITED'), false, 'a venue that does not answer says nothing about a minimum')
  assert.equal(isNoRoute('ASSET_NOT_OFFERED'), false)
  assert.equal(isNoRoute(null), false)
  assert.deepEqual([...ROUTE_MINIMUM_RETRY_MS], [1_500, 3_000, 6_000])
  assert.equal(dollarsRaw(1, 6), '1000000')
  assert.equal(dollarsRaw(25.5, 6), '25500000')
  // The same read-only quote the purchase uses, asked through the one ladder.
  assert.match(
    LADDER,
    /fetchSwapQuote\(\{ inputMint: payMint, outputMint: mint, amountRaw: dollarsRaw\(usd, DOLLAR_DECIMALS\) \}/,
  )
  assert.match(LADDER, /await ladderMinimum\(\{/)
  // The one action puts the minimum in — on the purchase and before a rule is turned on.
  assert.match(BUY_SHEET, /words\.setMinimum\(sum\(action\.usd\)\), onPress: \(\) => buy\.pickSum\(action\.usd\)/)
  // A «З оплат» rule asks whether a dollar routes — the least its reminders open at — the other kinds their sum.
  assert.match(RULE_SHEET, /const routedSum = paying \? RULE_MIN_USD : amount/)
  assert.match(RULE_SHEET, /useQuoteRoute\(USDC_MINT, company\.mint, routedSum, true\)/)
  assert.match(RULE_SHEET, /onPress: \(\) => setAmountText\(String\(least\)\)/)
})

/** A venue that routes from `from` dollars up, answering `held` times with a held-back refusal first. */
function venue({ from, held = 0, refusal = 'QUOTE_REFUSED' }) {
  const asked = []
  let holds = held
  return {
    asked,
    quote: async (usd) => {
      asked.push(usd)
      if (holds > 0) {
        holds -= 1
        return { ok: false, code: refusal }
      }
      return usd >= from ? { ok: true } : { ok: false, code: 'QUOTE_NO_ROUTE' }
    },
  }
}

test('the ladder reads the company’s own minimum from the quote: the first sum that routes, asked again when held back, none claimed otherwise', async () => {
  const waits = []
  const wait = async (ms) => {
    waits.push(ms)
  }
  const never = () => false
  // «IREN — від $5»: $2 has no route, $5 routes.
  const iren = venue({ from: 5 })
  assert.deepEqual(await ladderMinimum({ amountUsd: 1, quote: iren.quote, wait, aborted: never }), {
    state: 'found',
    minimumUsd: 5,
  })
  assert.deepEqual(iren.asked, [2, 5])
  assert.deepEqual(waits, [])
  // A rate limit twice, then the answer: the same sum is asked again after each pause.
  const limited = venue({ from: 2, held: 2, refusal: 'QUOTE_RATE_LIMITED' })
  assert.deepEqual(await ladderMinimum({ amountUsd: 1, quote: limited.quote, wait, aborted: never }), {
    state: 'found',
    minimumUsd: 2,
  })
  assert.deepEqual(limited.asked, [2, 2, 2])
  assert.deepEqual(waits, [1_500, 3_000])
  // A refusal that outlasts every pause claims no minimum — the ladder never climbs on it.
  waits.length = 0
  const refusing = venue({ from: 2, held: 99 })
  assert.deepEqual(await ladderMinimum({ amountUsd: 1, quote: refusing.quote, wait, aborted: never }), {
    state: 'none',
  })
  assert.deepEqual(refusing.asked, [2, 2, 2, 2])
  assert.deepEqual(waits, [1_500, 3_000, 6_000])
  // No route anywhere on the ladder: nothing is claimed.
  const nowhere = venue({ from: Number.POSITIVE_INFINITY })
  assert.deepEqual(await ladderMinimum({ amountUsd: 1, quote: nowhere.quote, wait, aborted: never }), {
    state: 'none',
  })
  assert.deepEqual(nowhere.asked, [2, 5, 10, 25, 50, 100])
  // A sum above the ladder asks nothing; a sheet closed on the way stops it.
  const above = venue({ from: 2 })
  assert.deepEqual(await ladderMinimum({ amountUsd: 100, quote: above.quote, wait, aborted: never }), {
    state: 'none',
  })
  assert.deepEqual(above.asked, [])
  let closed = false
  const closing = async () => {
    closed = true
    return { ok: false, code: 'QUOTE_NO_ROUTE' }
  }
  assert.deepEqual(await ladderMinimum({ amountUsd: 1, quote: closing, wait, aborted: () => closed }), {
    state: 'none',
  })
})

/** $1 of an xStock the wallet does not hold, as the server counts it: the chain-proven 179-byte Token-2022 account, 1,559,560 lamports. */
const ONE_DOLLAR_CHECK = {
  side: 'buy',
  basis: 'order',
  company: {
    mint: 'XsH7vuEDhQZcGzQnxfuGq3nEYp9dHqPzR2DxBG3kS1V',
    symbol: 'IRENx',
    name: 'IREN',
    issuer: 'xstocks',
    unit: 'share',
    privateCompany: false,
    decimals: 8,
    multiplier: 1,
  },
  spend: { mint: USDC_ASSET.mint, unit: 'usdc', amount: 1, usd: 1 },
  get: { mint: 'XsH7vuEDhQZcGzQnxfuGq3nEYp9dHqPzR2DxBG3kS1V', unit: 'share', amount: 0.000028, atLeast: 0.00002786, usd: 0.9905 },
  costs: { usd: 0.0103, issuerFee: null },
  reserve: { lamports: '1559560', usd: 0.311912, first: false },
  what: {
    truth: {
      en: 'A token that tracks the price of IREN · backed 1:1 · no vote',
      uk: 'Токен, що відстежує ціну IREN · забезпечений 1:1 · без голосу',
    },
    note: null,
    caution: false,
  },
  sol: { usd: 200, observedAt: null },
}

test('the one-time reserve is never a cost; «Перевірка» says it first only when the server judged it more than the purchase', () => {
  assert.equal(reserveFirstOf(ONE_DOLLAR_CHECK), null)
  assert.deepEqual(
    reserveFirstOf({ ...ONE_DOLLAR_CHECK, reserve: { lamports: '1559560', usd: 1.55956, first: true } }),
    { reserveUsd: 1.55956, spendUsd: 1 },
  )
  assert.equal(reserveFirstOf({ ...ONE_DOLLAR_CHECK, reserve: null }), null)
  // Four rows still: the reserve is a line of its own under «Усі витрати», never joined to them.
  const rows = buyCheckRows(ONE_DOLLAR_CHECK, { unit: 'share', company: 'IREN', locale: 'uk', words: BUY_COPY.uk })
  assert.equal(rows.length, 4)
  assert.equal(rows[2].key, 'costs')
  assert.equal(rows[2].value, '≈ $0,01')
  assert.equal(rows[2].sub, '≈ $0,31 у SOL разово лишаються в гаманці на рахунку токена')
  // Said before the rows, in the sheet.
  assert.ok(BUY_SHEET.indexOf('<ReserveFirstLine') < BUY_SHEET.indexOf('<BuyReviewTable rows={rows}'))
})

/** Every string a copy holds, its functions said with sample words. */
function texts(value) {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') return [value('$1', 'IREN', '$5')]
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts)
  return []
}

test('the words, in both languages: the reserve apart, the company’s own minimum, a dollar everywhere, no advice', () => {
  assert.equal(BUY_COPY.uk.reserve('≈ $0,24'), '≈ $0,24 у SOL разово лишаються в гаманці на рахунку токена')
  assert.equal(BUY_COPY.en.reserve('≈ $0.24'), '≈ $0.24 in SOL, once — it stays in your wallet, on the token’s account')
  assert.equal(
    BUY_COPY.uk.reserveFirst('≈ $1,20', '$1'),
    'Разовий резерв ≈ $1,20 у SOL більший за саму покупку ($1). Він лишиться в гаманці на рахунку токена — це не витрата.',
  )
  assert.match(
    BUY_COPY.en.reserveFirst('≈ $1.20', '$1'),
    /^The one-time reserve, ≈ \$1\.20 in SOL, is more than the purchase itself \(\$1\)\./,
  )
  assert.equal(BUY_COPY.uk.routeMinimum('$1', 'IREN', '$5'), 'На $1 маршруту зараз немає. IREN — від $5.')
  assert.equal(BUY_COPY.en.routeMinimum('$1', 'IREN', '$5'), 'No route for $1 right now. IREN from $5.')
  assert.equal(BUY_COPY.uk.setMinimum('$5'), 'Поставити $5')
  assert.equal(BUY_COPY.en.setMinimum('$5'), 'Use $5')
  assert.equal(BUY_COPY.uk.minimum, 'Мінімум — $1')
  assert.equal(BUY_COPY.en.minimum, 'The minimum is $1')
  assert.equal(INVEST_COPY.uk.guestHeadline, 'Запускай. Торгуй. Автоматизуй.')
  assert.equal(INVEST_COPY.en.guestHeadline, 'Launch. Trade. Automate.')
  // The web's words since a rule names any token (1.31.0): what a rule buys and that each buy is the person's signature.
  assert.equal(
    AUTOINVEST_COPY.uk.noRulesYet,
    'Правил ще немає. Правило купує токен щодня, щотижня, коли ціна впаде або з кожної оплати — кожну купівлю підписуєш ти.',
  )
  for (const copy of [BUY_COPY, INVEST_COPY, AUTOINVEST_COPY]) {
    for (const text of [...texts(copy.en), ...texts(copy.uk)]) {
      assert.doesNotMatch(text, /(from|від|Мінімум —|minimum is)[\s ]*\$10(?![\d,.])/i, `no old minimum: ${text}`)
      assert.doesNotMatch(text, /recommend|рекоменд/i, `no sum is advised — each buys on their own budget: ${text}`)
    }
  }
})
