import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PREDICTIONS_LIVE } from '../shell/places.ts'
import { segmentOf, TRADE_SEGMENTS, tradeSegments } from '../shell/trade-place.ts'
import { kindsOfChip, PLACE_CHIPS, placeChipOf } from '../markets/screener.ts'
import { DOLLAR_PLACES, PAD_KEYS, pressKey, typedField, withMark } from './keypad-model.ts'
import { clockOf, SHEET_COPY } from './sheet-copy.ts'
import { checkSummary, groupedField, priceLossPct, PRICE_LOSS_SHOWN_PCT, reviewBelongsHere } from './trade-model.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

test('the keypad: digits, one decimal mark in the language’s shape, the asset’s places, delete', () => {
  assert.deepEqual(PAD_KEYS, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'mark', '0', 'delete'])
  const type = (keys, mark = ',', places = 6) => keys.reduce((text, key) => pressKey(text, key, mark, places), '')
  assert.equal(type(['2', '5']), '25')
  assert.equal(type(['mark', '5']), '0,5')
  assert.equal(type(['1', 'mark', '5', 'mark', '0']), '1,50')
  assert.equal(type(['1', 'mark', '5'], '.'), '1.5')
  assert.equal(type(['0', '0', '7']), '7')
  assert.equal(type(['1', 'mark', '1', '2', '3'], ',', 2), '1,12')
  assert.equal(type(['5', 'mark'], ',', 0), '5')
  assert.equal(type(['1', '2', 'delete']), '1')
  assert.equal(type(['delete']), '')
  assert.equal(type(Array(12).fill('9')), '999999999')
})

test('the short «Перевірка»: Спишеться · Отримаєш with the minimum · each cost as the server stated it; the rest deeper', () => {
  const view = {
    pay: '25 USDC',
    receive: '0.239 SOL',
    rows: [
      { key: 'receive', label: 'You receive', value: '0.239 SOL' },
      { key: 'minimum', label: 'Minimum received', value: '0.238 SOL', emphasis: true },
      { key: 'price', label: 'Price', value: '1 SOL ≈ 104.3 USDC' },
      { key: 'impact', label: 'Price impact', value: '0.02%' },
      { key: 'slippage', label: 'Max price move', value: '0.50%' },
      { key: 'networkFee', label: 'Network fee', value: '0.00002 SOL' },
      { key: 'serviceFee', label: 'Ryntra service fee', value: '0.50% · 0.125 USDC' },
    ],
    warnings: [],
  }
  const summary = checkSummary(view)
  assert.equal(summary.spend, '25 USDC')
  assert.equal(summary.receive, '0.239 SOL')
  assert.equal(summary.minimum, '0.238 SOL')
  // Ryntra's own fee first among the costs, never a total worked out on the phone.
  assert.deepEqual(
    summary.costs.map((cost) => cost.key),
    ['serviceFee', 'networkFee'],
  )
  assert.deepEqual(
    summary.details.map((row) => row.key),
    ['price', 'impact', 'slippage'],
  )
  // An estimate has no minimum.
  assert.equal(checkSummary({ ...view, rows: view.rows.filter((row) => row.key !== 'minimum') }).minimum, null)
})

test('«Торгівля»: Ринки · Обмін · Ф’ючерси · Прогнози — Solana only, no segment for a terminal on another network', () => {
  // 1.17.0 carries the assistant and Phoenix's trades; Прогнози come in the second release — one flag, the code whole.
  assert.equal(PREDICTIONS_LIVE, false, '1.17.0 hides Прогнози; the second release turns this on')
  assert.deepEqual(tradeSegments(false), ['markets', 'swap', 'futures'])
  assert.deepEqual(TRADE_SEGMENTS, tradeSegments(PREDICTIONS_LIVE))
  assert.equal(segmentOf('predictions', tradeSegments(false)), null)
  const all = tradeSegments(true)
  assert.deepEqual(all, ['markets', 'swap', 'futures', 'predictions'])
  assert.deepEqual(
    all.map((value) => SHEET_COPY.uk.segments[value]),
    ['Ринки', 'Обмін', 'Perps', 'Прогнози'],
  )
  assert.deepEqual(
    all.map((value) => SHEET_COPY.en.segments[value]),
    ['Markets', 'Swap', 'Perps', 'Predictions'],
  )
  // Прогнози are a section of Ryntra on Solana (decisions 57, 58, M12), never a door to predict.ryntra.io.
  assert.equal(segmentOf('predictions', all), 'predictions')
  assert.equal(segmentOf('swap'), 'swap')
  // Ф'ючерси are Phoenix's on Solana (decision 56, C4); no other word opens a segment.
  assert.equal(segmentOf(['futures']), 'futures')
  assert.equal(segmentOf('perps'), null)
  const place = code('screens/trade-place/index.tsx')
  assert.doesNotMatch(place, /trade\.ryntra\.io|predict\.ryntra\.io|openLink/)
  // Nothing of another network's own is in the phone.
  assert.doesNotMatch(
    JSON.stringify(
      Object.keys(JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).dependencies),
    ),
    /hyperliqui[d]/i,
  )
})

test('Ринки’s chips: Усі · Акції · Крипто · Меми · Лаунчі · Обране — Обране last, each chip the kinds it names', () => {
  assert.deepEqual(PLACE_CHIPS, ['all', 'stocks', 'crypto', 'memes', 'launches', 'watchlist'])
  assert.deepEqual(
    PLACE_CHIPS.map((chip) => SHEET_COPY.uk.chips[chip]),
    ['Усі', 'Акції', 'Крипто', 'Меми', 'Лаунчі', 'Обране'],
  )
  assert.deepEqual(
    PLACE_CHIPS.map((chip) => SHEET_COPY.en.chips[chip]),
    ['All', 'Stocks', 'Crypto', 'Memes', 'Launches', 'Favourites'],
  )
  assert.equal(placeChipOf('all'), 'all')
  assert.equal(placeChipOf('memes'), 'memes')
  assert.equal(placeChipOf('crypto'), 'crypto')
  assert.equal(placeChipOf('private'), 'stocks')
  assert.equal(placeChipOf('watchlist'), 'watchlist')
  assert.deepEqual(kindsOfChip('all'), ['crypto', 'meme', 'stock', 'private'])
  assert.deepEqual(kindsOfChip('crypto'), ['crypto'])
  assert.deepEqual(kindsOfChip('memes'), ['meme'])
  assert.deepEqual(kindsOfChip('stocks'), ['stock', 'private'])
  assert.deepEqual(kindsOfChip('launches'), [])
  assert.deepEqual(kindsOfChip('watchlist'), [])
})

test('the one sheet: sum → «Тип» → «Перевірка» → the wallet → «Готово», never a sheet over a sheet', () => {
  const trade = code('screens/trade/index.tsx')
  assert.match(trade, /<AssetPickerSheet\s+inline/)
  // The limit inside the sheet, with its props in any order (it may carry the ticket's typed sum too).
  const limitPanel = trade.match(/<LimitPanel\b[\s\S]*?\/>/)?.[0] ?? ''
  assert.match(limitPanel, /asset=\{asset\}/)
  assert.match(limitPanel, /side=\{mode === 'sell' \? 'sell' : 'buy'\}/)
  assert.match(limitPanel, /\binline\b/)
  assert.match(limitPanel, /onLocked=\{setLimitLocked\}/)
  assert.match(trade, /<WaitBody sending=\{trade\.sending\} onCancel=\{trade\.cancelSigning\} \/>/)
  assert.match(trade, /<DoneBody/)
  // No Review sheet of its own: «Перевірка» is a step of the sheet; the swap's page opens one sheet for it.
  assert.doesNotMatch(trade, /<Sheet\b/)
  // While the wallet is asked the sheet holds still.
  assert.match(trade, /locked=\{signing \|\| trade\.phase === 'preparing' \|\| limitLocked\}/)
  // The figures stay the server's: the same Review, the same sign.
  assert.match(trade, /onPress=\{\(\) => void trade\.sign\(\)\}/)
  assert.match(trade, /onPress: \(\) => void trade\.review\(\)/)
})

test('the asset’s page pins «Продати» (with a position) and «Купити» at its foot', () => {
  const asset = code('screens/asset/index.tsx')
  assert.match(asset, /\{pinned\.sell \? \(\s*<Button title=\{saleWords\.sell\} variant="secondary"/)
  assert.match(
    asset,
    /<Button title=\{words\.buy\} size="lg" className="flex-1" loading=\{pinned\.buying\} onPress=\{pinned\.buy\} \/>/,
  )
  assert.match(asset, /accessibilityLabel=\{starred \? places\.watchRemove : places\.watchAdd\}/)
})

test('the sheet’s words in both languages, «ти» and neutral to gender', () => {
  const keys = Object.keys(SHEET_COPY.en)
  assert.deepEqual(Object.keys(SHEET_COPY.uk), keys)
  assert.equal(SHEET_COPY.uk.buyTitle('SOL'), 'Купити SOL')
  assert.equal(SHEET_COPY.uk.validFor(clockOf(30)), 'Ціна дійсна ще 0:30')
  assert.equal(clockOf(75), '1:15')
  assert.equal(clockOf(-3), '0:00')
  assert.doesNotMatch(JSON.stringify(SHEET_COPY.uk), /готовий|готова|Seed Vault/)
})

test('a kept Review comes back only onto the same ticket: its kind and both of its legs', () => {
  const buyBonk = { mode: 'buy', pay: { mint: 'Usdc' }, receive: { mint: 'Bonk' } }
  assert.equal(reviewBelongsHere(buyBonk, { mode: 'buy', pay: 'Usdc', receive: 'Bonk' }), true)
  // Another asset, another side, or the same asset paid with another token: never under this ticket's names.
  assert.equal(reviewBelongsHere(buyBonk, { mode: 'buy', pay: 'Usdc', receive: 'Wif' }), false)
  assert.equal(reviewBelongsHere(buyBonk, { mode: 'buy', pay: 'Sol', receive: 'Bonk' }), false)
  assert.equal(reviewBelongsHere(buyBonk, { mode: 'sell', pay: 'Bonk', receive: 'Usdc' }), false)
  assert.equal(reviewBelongsHere(buyBonk, { mode: 'buy', pay: null, receive: null }), false)
  const swap = { mode: 'swap', pay: { mint: 'Wif' }, receive: { mint: 'Bonk' } }
  assert.equal(reviewBelongsHere(swap, { mode: 'swap', pay: 'Sol', receive: 'Usdc' }), false)
  assert.equal(reviewBelongsHere(swap, { mode: 'swap', pay: 'Wif', receive: 'Bonk' }), true)
  // Closing the sheet over a Review lets it go; a limit's signature holds the sheet like the market's.
  const trade = code('screens/trade/index.tsx')
  assert.match(trade, /if \(trade\.phase === 'review'\) trade\.closeReview\(\)/)
  assert.match(trade, /locked=\{signing \|\| trade\.phase === 'preparing' \|\| limitLocked\}/)
  assert.match(code('screens/trade/limit-panel.tsx'), /onLocked\?\.\(signingNow\)/)
})

test('ST-5: an estimate says a dollar to the cent and any other token to six significant digits', async () => {
  const { shortUnits, USDC_ASSET, SOL_ASSET } = await import('./trade-model.ts')
  assert.equal(shortUnits('2079061', 6, USDC_ASSET.mint, 'en'), '2.07')
  assert.equal(shortUnits('2810072', 6, USDC_ASSET.mint, 'uk'), '2,81')
  assert.equal(shortUnits('27026691', 9, SOL_ASSET.mint, 'uk'), '0,0270266')
  assert.equal(shortUnits('1234567891', 9, SOL_ASSET.mint, 'en'), '1.23456')
  assert.equal(shortUnits('123456789000000', 9, SOL_ASSET.mint, 'en'), '123,456')
  assert.equal(shortUnits('x', 9, SOL_ASSET.mint, 'en'), '—')
})

test('ST-5: a non-zero dollar estimate under a cent is «< 0,01», never «≈ 0» nor «≈ < 0,01»', async () => {
  const { approxFigure, shortUnits, USDC_ASSET } = await import('./trade-model.ts')
  // 0,042682418 PUMP at 0,004475 USDC ≈ 0,00019 USDC.
  assert.equal(shortUnits('191', 6, USDC_ASSET.mint, 'uk'), '< 0,01')
  assert.equal(shortUnits('191', 6, USDC_ASSET.mint, 'en'), '< 0.01')
  assert.equal(shortUnits('0', 6, USDC_ASSET.mint, 'en'), '0')
  assert.equal(shortUnits('10000', 6, USDC_ASSET.mint, 'en'), '0.01')
  assert.equal(approxFigure('< 0,01'), '< 0,01')
  assert.equal(approxFigure('2,81'), '≈ 2,81')
})

test('ST-5: a price that could not be had never says «Nothing was sent», in either language', async () => {
  const { quoteFailureLine, TRADE_COPY } = await import('./copy.ts')
  for (const words of [TRADE_COPY.en, TRADE_COPY.uk]) {
    for (const key of ['offline', 'tooLong', 'providerDown', 'providerRefused']) {
      assert.doesNotMatch(quoteFailureLine(words, key), /Nothing was sent|Нічого не надіслано/)
    }
    assert.equal(quoteFailureLine(words, 'noRoute'), words.failures.noRoute)
  }
  assert.equal(quoteFailureLine(TRADE_COPY.en, 'offline'), 'Couldn’t get a price — check the connection.')
  assert.equal(quoteFailureLine(TRADE_COPY.uk, 'offline'), 'Не вдалося отримати ціну — перевір з’єднання.')
})

test('ST-5: a disabled primary is no dimmed orange — its own quiet surface with muted words', () => {
  const button = code('components/button.tsx')
  assert.match(button, /DISABLED_PRIMARY[^=]*=\s*\{\s*classes: 'bg-hover border border-line', tone: 'muted' \}/)
  assert.match(button, /inactive && !refused && 'opacity-50'/)
})

test('a sum typed in one language reads in the other’s shape after the switch, the same amount (ST-5 r8)', () => {
  assert.equal(withMark('0,00001', '.'), '0.00001')
  assert.equal(withMark('0.5', ','), '0,5')
  assert.equal(withMark('25', '.'), '25')
  assert.equal(withMark('', ','), '')
  assert.equal(withMark('0,', '.'), '0.')
  // After the switch the keypad's own mark is the field's: a second «.» is not taken, digits go on after the fraction.
  const switched = withMark('0,00001', '.')
  assert.equal(pressKey(switched, 'mark', '.', 9), '0.00001')
  assert.equal(pressKey(pressKey(switched, '8', '.', 9), '8', '.', 9), '0.0000188')
  const screen = code('screens/trade/index.tsx')
  assert.match(screen, /if \(markSeen !== fieldMark\)/)
  assert.match(screen, /setAmountText\(\(text\) => withMark\(text, fieldMark\)\)/)
})

test('ST-5 r9: a dollar sum takes cents only and reads grouped; a swap names a price loss over 1 %', () => {
  const type = (keys, places) => keys.reduce((text, key) => pressKey(text, key, ',', places), '')
  // «$5,222» is not taken: the third decimal of a dollar sum is refused.
  assert.equal(DOLLAR_PLACES, 2)
  assert.equal(type(['5', 'mark', '2', '2', '2'], DOLLAR_PLACES), '5,22')
  // The sheet's big figure groups as «Обмін»'s does: «1 250», never «1250».
  assert.equal(groupedField('1250', 'uk'), '1 250')
  assert.equal(groupedField('1250', 'en'), '1,250')
  const screen = code('screens/trade/index.tsx')
  assert.match(screen, /const amountDrawn = groupedField\(amountShown, locale\)/)
  assert.match(screen, /\{dollarPay \? amountDrawn : /)
  assert.match(screen, /variant === 'sheet' && dollarPay/)
  // 1.25 SOL ≈ $130.83 → ≈ $122.95: about 6 % lost on the price, said; within 1 %, or a gain, or a figure unknown: not.
  assert.equal(PRICE_LOSS_SHOWN_PCT, 1)
  assert.equal(Math.round(priceLossPct(130.83, 122.95)), 6)
  assert.equal(priceLossPct(100, 99.5), null)
  assert.equal(priceLossPct(100, 101), null)
  assert.equal(priceLossPct(null, 90), null)
  assert.equal(priceLossPct(100, null), null)
  assert.equal(priceLossPct(0, 0), null)
})

test('ST-5 r10: the Limit’s spend field keeps the Market keypad’s rules — no «007», grouped, a dollar to the cent', () => {
  // A zero before a whole number is not kept; one mark, the language's; no digit past the places.
  assert.equal(typedField('007', ',', 2), '7')
  assert.equal(typedField('00', ',', 2), '0')
  assert.equal(typedField('0,5', ',', 2), '0,5')
  assert.equal(typedField(',5', ',', 2), '0,5')
  assert.equal(typedField('5,222', ',', DOLLAR_PLACES), '5,22')
  assert.equal(typedField('5.25', ',', 2), '5,25')
  assert.equal(typedField('5,2,5', ',', 6), '5,25')
  // The grouping it was drawn with is taken off as it is typed on: «1 250» and a digit is «12 505».
  assert.equal(typedField('1 2505', ',', 2), '12505')
  assert.equal(typedField('1 250,5', ',', 2), '1250,5')
  assert.equal(groupedField(typedField('1 2505', ',', 2), 'uk'), '12 505')
  // In English a comma is the grouping — but one typed at the end on a keyboard with a decimal comma is the mark.
  assert.equal(typedField('1,2505', '.', 2), '12505')
  assert.equal(typedField('1,250.5', '.', 2), '1250.5')
  assert.equal(typedField('1250,', '.', 2), '1250.')
  assert.equal(groupedField(typedField('1,2505', '.', 2), 'en'), '12,505')
  // Nine whole digits at most, anything else dropped.
  assert.equal(typedField('1234567890', ',', 2), '123456789')
  assert.equal(typedField('12a$3', ',', 2), '123')
  const panel = code('screens/trade/limit-panel.tsx')
  assert.match(panel, /value=\{groupedField\(amount, locale\)\}/)
  assert.match(panel, /setAmount\(typedField\(text, amountMark, amountPlaces\)\)/)
})

test('C4e: the sheet rises by a transform, never a layout animation that keeps a short frame', () => {
  // `entering={SlideInDown}` kept the frame of the sheet's first layout pass on Android: the footer fell outside the
  // sheet's edge and a press on «Перевірити» reached the scrim, which closed the sheet (the operator's Seeker, 1.17.0 (19)).
  const frame = readFileSync(new URL('../../screens/trade/sheet-parts.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(frame, /^\s*entering=\{/m)
  assert.doesNotMatch(frame, /^import[^\n]*\bSlideIn/m)
  assert.match(frame, /translateY/)
})
