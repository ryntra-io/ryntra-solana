import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { MODES_COPY, RECEIPT_MODES } from './modes-copy.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

test('a receipt reads «Просто · Детально»; the JSON is folded a tap deeper, never in the main flow (NEW-LOOK §5)', () => {
  assert.deepEqual(RECEIPT_MODES, ['glance', 'full'])
  assert.deepEqual(Object.values(MODES_COPY.uk.modes), ['Просто', 'Детально'])
  assert.equal(MODES_COPY.uk.technical, 'Технічні дані (JSON)')
  const modes = code('screens/receipts/receipt-modes.tsx')
  // It opens on «Просто», and the record's JSON is drawn only once asked for.
  assert.match(modes, /useState<ReceiptMode>\('glance'\)/)
  assert.match(modes, /const \[raw, setRaw\] = useState\(false\)/)
  assert.match(modes, /\{raw \? \(\s*<View[^>]*>\s*<Txt[^>]*>\s*\{JSON\.stringify\(doc, null, 2\)\}/)
  // Both receipts the phone opens read the same way: History's and «Квитанції».
  assert.match(
    code('screens/history/receipt-sheet.tsx'),
    /<ReceiptModes doc=\{docFromHistory\(row, historyTitle\(row, copy\.words\)\)\} detailed=\{detailed\} \/>/,
  )
  assert.match(
    code('screens/receipts/doc-sheet.tsx'),
    /<ReceiptModes doc=\{doc\} detailed=\{<DocCard doc=\{doc\} share=\{false\} \/>\} \/>/,
  )
})

test('Portfolio holds Активи · Ордери · Історія: «Мої ордери» and History are its segments, an empty one a quiet line', () => {
  const portfolio = code('screens/portfolio/index.tsx')
  // Phoenix's resting orders stand over the limits since C4f.
  assert.match(portfolio, /<OrdersScreen\s+embedded\s+order=\{focusOrder\}/)
  // A position's «Історія» opens the same segment on its asset, keyed by it (the critic of 2026-10-17).
  assert.match(
    portfolio,
    /<HistoryScreen\s+embedded\s+key=\{historyAsset\?\.mint \?\? 'all'\}\s+asset=\{historyAsset\}/,
  )
  assert.match(portfolio, /\{copy\.emptyLine\}/)
  assert.doesNotMatch(portfolio, /icon="pie-chart-outline"/)
})

test('«Просто» says the title once (the sheet’s head) and gives each figure its word; History’s row never cuts the money (ST-5)', () => {
  const modes = code('screens/receipts/receipt-modes.tsx')
  assert.doesNotMatch(modes, /\{doc\.title\}/)
  assert.match(modes, /const mainWord = doc\.got\[0\] \? copy\.got : leftWord/)
  assert.match(modes, /\$\{leftWord\} \$\{legText\(other, true\)\}/)
  const row = code('screens/history/history-row.tsx')
  // The amounts take the row's whole width with no line limit; the time stands under them, not in a column beside.
  assert.match(row, /<Txt variant="data" tone="faint">\s*\{amounts\}/)
  assert.match(row, /numberOfLines=\{2\}/)
  // Both views of a History receipt say the state in the same case.
  assert.match(code('screens/history/receipt-sheet.tsx'), /tone=\{STATUS_TONE\[row\.status\]\} caps=\{false\}/)
})

test('ST-5: «Детально» of an operation that did not happen shows no paid or received leg, and the time once', () => {
  const sheet = code('screens/history/receipt-sheet.tsx')
  assert.match(sheet, /const moved = row\.status !== 'failed'/)
  assert.match(sheet, /if \(row\.out && moved\)/)
  assert.match(sheet, /if \(row\.in && moved\)/)
  // The status line holds the state alone; «Час» says the time.
  assert.match(sheet, /caps=\{false\} \/>\s*<\/View>/)
  assert.equal((sheet.match(/formatMoment\(row\.at, now, locale\)/g) ?? []).length, 2)
  assert.match(sheet, /facts\.push\(\{ label: copy\.time, value: formatMoment\(row\.at, now, locale\) \}\)/)
})

test('ST-5: «Тримати під’єднаним» says the end with its day, as Settings does — «до завтра 01:00»', () => {
  const profile = code('screens/home/profile-sheet.tsx')
  assert.match(profile, /words\.keepUntil\(formatMoment\(new Date\(until\)\.toISOString\(\), now, locale\)\)/)
  assert.doesNotMatch(profile, /formatClock/)
})
