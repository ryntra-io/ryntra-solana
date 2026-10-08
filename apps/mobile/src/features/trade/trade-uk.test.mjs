import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failureFrom } from './trade-flow.ts'
import {
  assessReview,
  formatUnits,
  REQUIRED_RULES,
  reviewView,
  reviewWarnings,
  serviceFeeText,
  settledView,
  SOL_ASSET,
  TRADE_FAILURE_KEYS,
  tradeFailureCopy,
  unitsForField,
  USDC_ASSET,
} from './trade-model.ts'
import { TRADE_COPY } from './copy.ts'
import { ApiError } from '../../lib/api.ts'

/* Trade in Ukrainian (M22): the Review's rows, its figures and notes, the
   receipt and every refusal in the person's language — the web's Spot words —
   while the English stays word for word what it was. */

const NBSP = ' '
const NVDA = {
  mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  symbol: 'NVDAx',
  name: 'NVIDIA xStock',
  icon: null,
  decimals: 8,
}

const order = (over = {}) => ({
  requestId: 'req-1',
  inputMint: USDC_ASSET.mint,
  outputMint: NVDA.mint,
  inAmountRaw: '100000000',
  outAmountRaw: '46800000',
  minReceivedRaw: '46500000',
  slippageBps: 50,
  priceImpactPct: '0.0123',
  router: 'jupiter',
  platformFee: { basisPoints: 10, mint: USDC_ASSET.mint },
  totalFeeBasisPoints: 10,
  ryntraFee: {
    mechanism: 'JUPITER_REFERRAL',
    state: 'APPLIED',
    basisPoints: 10,
    requestedBasisPoints: 10,
    asset: USDC_ASSET.mint,
    symbol: 'USDC',
    decimals: 6,
    amountRaw: '100000',
    usd: null,
  },
  signatureFeeLamports: '5000',
  priorityFeeLamports: '15000',
  rentFeeLamports: '2039280',
  inUsdValue: '100',
  outUsdValue: '99.9',
  swapUsdValue: '100',
  route: [],
  taker: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  observedAt: '2026-09-26T10:00:00.000Z',
  reviewExpiresAt: '2026-09-26T10:01:30.000Z',
  ...over,
})

test('a raw amount in each language’s shape, and in a field’s without its grouping', () => {
  assert.equal(formatUnits('123456789', 2, 6, 'en'), '1,234,567.89')
  assert.equal(formatUnits('123456789', 2, 6, 'uk'), `1${NBSP}234${NBSP}567,89`)
  assert.equal(formatUnits('5000', 9, 6, 'uk'), '0,000005')
  assert.equal(unitsForField('123456789', 2, 'en'), '1234567.89')
  assert.equal(unitsForField('123456789', 2, 'uk'), '1234567,89')
  assert.equal(unitsForField('100000000', 6, 'uk'), '100')
})

test('the Review’s rows in Ukrainian: the web’s labels, the figures with a comma, the notes by the rule', () => {
  const view = reviewView(
    {
      order: order(),
      mode: 'buy',
      pay: USDC_ASSET,
      receive: NVDA,
      decimals: { [USDC_ASSET.mint]: 6, [NVDA.mint]: 8 },
      exact: true,
      findings: [{ rule: 'SLIPPAGE_BOUNDED', outcome: 'REVIEW', detail: 'Slippage is wider than usual.' }],
    },
    'uk',
  )
  assert.ok(view)
  assert.deepEqual(
    view.rows.map((row) => row.label),
    [
      'Ти отримуєш',
      'Мінімум отримання',
      'Ціна',
      'Вплив на ціну',
      'Сліпедж',
      'Комісія мережі',
      'Резерв для рахунку',
      'Комісія Ryntra',
    ],
  )
  assert.equal(view.pay, '100 USDC')
  assert.equal(view.receive, '0,468 NVDAx')
  assert.equal(view.rows[1].value, '0,465 NVDAx')
  assert.match(view.rows[2].value, /^1 NVDAx ≈ 213,67\d* USDC$/)
  assert.equal(view.rows[3].value, '0,01%')
  assert.equal(view.rows[4].value, '0,50%')
  assert.equal(view.rows[5].value, '0,00002 SOL')
  assert.equal(view.rows[6].value, '0,002039 SOL')
  assert.equal(view.rows[7].value, '0,10% · 0,1 USDC')
  assert.deepEqual(view.warnings, ['Котирування й мінімум отримання рахують різний сліпедж.'])
  const estimate = reviewView(
    { order: order(), mode: 'sell', pay: NVDA, receive: USDC_ASSET, decimals: {}, exact: false },
    'uk',
  )
  assert.equal(estimate.rows[0].label, 'Ти отримуєш · оцінка')
  assert.equal(serviceFeeText({ ...order().ryntraFee, basisPoints: 0 }, 'uk'), 'Немає')
  assert.equal(serviceFeeText({ ...order().ryntraFee, amountRaw: null, usd: 0.004 }, 'uk'), '0,10% · < $0,01')
  assert.equal(serviceFeeText({ ...order().ryntraFee, amountRaw: null, usd: 1.5 }, 'uk'), '0,10% · ≈ $1,50')
})

test('a finding left for the person to judge says the web’s words by its rule, never the server’s sentence', () => {
  const figures = { outAmountRaw: '1000000', minReceivedRaw: '995000', slippageBps: 50 }
  const review = (rule) => ({ rule, outcome: 'REVIEW', detail: 'anything the server says' })
  assert.deepEqual(reviewWarnings([review('OUTPUT_ASSET_REVIEWED')], figures), ['assetReview'])
  assert.deepEqual(
    reviewWarnings([review('SLIPPAGE_BOUNDED')], figures),
    ['reviewCarefully'],
    'minimum agrees, bound modest',
  )
  assert.deepEqual(
    reviewWarnings([review('SLIPPAGE_BOUNDED')], {
      outAmountRaw: '1000000',
      minReceivedRaw: '960000',
      slippageBps: 400,
    }),
    ['slippageWide'],
  )
  assert.deepEqual(
    reviewWarnings([review('SLIPPAGE_BOUNDED')], {
      outAmountRaw: '1000000',
      minReceivedRaw: '960000',
      slippageBps: 50,
    }),
    ['slippageDiffers', 'slippageWide'],
  )
  assert.deepEqual(reviewWarnings([review('PRICE_IMPACT_DISCLOSED')], figures), ['priceImpact'])
  assert.deepEqual(reviewWarnings([review('VALUE_DISCLOSED')], figures), ['usdUnknown'])
  assert.deepEqual(reviewWarnings([review('NETWORK_MAINNET')], figures), ['reviewCarefully'])
  assert.deepEqual(reviewWarnings([{ rule: 'SLIPPAGE_BOUNDED', outcome: 'PASS' }], figures), [], 'a pass says nothing')
  assert.equal(TRADE_COPY.uk.warnings.usdUnknown, 'Оцінка в доларах недоступна.')
  assert.equal(TRADE_COPY.en.warnings.usdUnknown, 'USD value is unavailable.')
})

test('every refusal has its words in both languages and the same answer to whether pressing again helps', () => {
  for (const key of TRADE_FAILURE_KEYS) {
    assert.ok(TRADE_COPY.en.failures[key].length > 0, key)
    assert.ok(TRADE_COPY.uk.failures[key].length > 0, key)
  }
  assert.deepEqual(tradeFailureCopy('QUOTE_NO_ROUTE', 'uk'), {
    key: 'noRoute',
    message: 'Для цієї пари зараз немає маршруту.',
    retryable: true,
  })
  assert.equal(tradeFailureCopy('WALLET_REFUSED', 'uk').message, 'Підтвердження в гаманці скасовано.')
  assert.equal(tradeFailureCopy('UNAUTHORIZED', 'uk').message, 'Увійди гаманцем, щоб торгувати.')
  assert.equal(tradeFailureCopy('SWAP_PRE_SIGN_REFUSED', 'uk').retryable, false)
  assert.equal(tradeFailureCopy('SOMETHING_ELSE', 'uk').message, 'Операція не вдалася. Спробуй ще раз.')
  const failure = failureFrom(new ApiError('ORDER_BUILD_FAILED', 'no build', 409, null, {}))
  assert.equal(failure.key, 'buildFailed')
  assert.match(TRADE_COPY.uk.failures[failure.key], /бракує суми разом із комісією/)
})

test('the readiness rule names its refusal by a key the screen says in either language', () => {
  const findings = REQUIRED_RULES.map((rule) => ({ rule, outcome: 'PASS' }))
  const base = {
    verdict: { decision: 'ALLOW', findings },
    proofStatus: 'SIGNED',
    simulationStatus: 'OK',
    ownerEffectsStatus: 'VERIFIED',
    expiresAt: '2026-09-26T10:01:00.000Z',
    now: Date.parse('2026-09-26T10:00:00.000Z'),
  }
  const refused = assessReview({ ...base, proofStatus: 'UNSIGNED' })
  assert.equal(refused.key, 'proofNotSigned')
  assert.equal(refused.reason, 'The exact Review has no trusted issuer signature.')
  assert.equal(TRADE_COPY.uk.failures[refused.key], 'У точної Перевірки немає довіреного підпису Ryntra.')
  assert.equal(
    assessReview({ ...base, verdict: { decision: 'ALLOW', findings: findings.slice(1) } }).key,
    'policyIncomplete',
  )
  assert.equal(
    assessReview({ ...base, verdict: { decision: 'BLOCK', findings } }).key,
    'notPassed',
    'a complete verdict that blocks is Ryntra’s checks, said as such',
  )
})

test('the receipt in Ukrainian: what was bought, the chain’s figures with a comma, the note against the quote', () => {
  const context = {
    mode: 'buy',
    pay: USDC_ASSET,
    receive: SOL_ASSET,
    payDecimals: 6,
    receiveDecimals: 9,
    inAmountRaw: '4836823',
    outAmountRaw: '49799705',
    minReceivedRaw: '49645325',
  }
  const filled = settledView(
    {
      state: 'MATCHED',
      signature: 'sig',
      observation: { actualInputRaw: '4836823', actualOutputRaw: '49796121' },
      facts: { reconciliation: { state: 'MATCHED', minimumMet: true, deviations: [] } },
      receipt: {},
    },
    context,
    'uk',
  )
  assert.equal(filled.title, 'Куплено SOL')
  assert.equal(filled.paid, '4,836823 USDC')
  assert.equal(filled.received, '0,049796 SOL')
  assert.equal(filled.note, 'Виконано нижче котирування, але вище мінімуму: −0,000003 SOL.')
  const swapped = settledView(
    { state: 'MATCHED', signature: 'sig', observation: null, facts: null, receipt: {} },
    { ...context, mode: 'swap' },
    'uk',
  )
  assert.equal(swapped.title, 'Обміняно USDC на SOL')
  assert.equal(swapped.note, 'Цифри з Перевірки — квитанція зберігає цифри мережі.')
  const nothing = settledView(
    { state: 'UNKNOWN_TO_CHAIN', signature: 'sig', observation: null, facts: null, receipt: null },
    null,
    'uk',
  )
  assert.equal(nothing.title, 'Попередня спроба · нічого не сталося')
  assert.match(nothing.note, /^Транзакцію, підписану раніше для цього гаманця, не надіслано/)
  // The server's English sentence has no Ukrainian: the state's own words stand in; in English it is said as it came.
  const pending = {
    state: 'PENDING',
    signature: 'sig',
    observation: null,
    facts: null,
    receipt: null,
    reason: 'not yet',
  }
  assert.equal(settledView(pending, context, 'uk').note, TRADE_COPY.uk.outcomeUnknown)
  assert.equal(settledView(pending, context).note, 'not yet')
  const seen = { ...pending, state: 'SEEN_WITHOUT_RECORD', recovery: TRADE_COPY.en.seenWithoutReceipt }
  assert.equal(
    settledView(seen, context, 'uk').note,
    'Мережа побачила транзакцію, але квитанція недоступна. Перевір її в експлорері.',
  )
  const refused = {
    state: 'FAILED',
    signature: 'sig',
    observation: null,
    facts: null,
    receipt: null,
    reason: 'the program refused',
  }
  assert.equal(settledView(refused, context, 'uk').note, 'Мережа не виконала цю операцію.')
  assert.equal(settledView(refused, context).note, 'the program refused')
})
