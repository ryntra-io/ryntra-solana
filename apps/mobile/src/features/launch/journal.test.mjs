import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LAUNCH_WORDS, launchWords } from './copy.ts'
import {
  JOURNAL_AT_ONCE,
  journalDetail,
  journalFigures,
  journalFloor,
  journalMark,
  journalName,
  journalNotes,
  journalRows,
  whyRules,
} from './journal-view.ts'
import { SAMPLE_HEALTH_CURVE, SAMPLE_HEALTH_DEX, SAMPLE_JOURNAL } from './market-samples.ts'

const uk = launchWords('uk')
const en = launchWords('en')
const KINDS = [
  'LAUNCHED',
  'CREATOR_LOCKED',
  'FEES_SHARED',
  'CREATOR_SOLD',
  'GRADUATED',
  'FLOOR_POOL',
  'FLOOR_PLACED',
  'FLOOR_WITHDRAWN',
  'FLOOR_RAISED',
  'FLOOR_ADDED',
]
const entry = (over) => ({
  kind: 'LAUNCHED',
  at: '2026-10-06T10:00:00.000Z',
  signature: 'sig',
  actor: 'creator',
  pairRaw: null,
  tokensRaw: null,
  priceLow: null,
  priceHigh: null,
  soldBps: null,
  soldOf: null,
  enforcement: 'rule',
  ...over,
})

test('the page shows three entries; every kind of 1.32.0 has its name in both languages', () => {
  assert.equal(JOURNAL_AT_ONCE, 3)
  for (const kind of KINDS) {
    assert.ok(LAUNCH_WORDS[`log_${kind}`], kind)
    assert.notEqual(journalName(entry({ kind }), uk), uk('log_unknown'))
  }
})

test('a kind a later contract adds is an entry on chain, never its code', () => {
  assert.equal(journalName(entry({ kind: 'SOMETHING_NEW' }), uk), 'Запис у ланцюгу')
  assert.equal(
    journalDetail(entry({ kind: 'SOMETHING_NEW' }), journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk'), uk, 'uk'),
    null,
  )
})

test("1.39.0 and 1.40.0 in the web's words: a purchase of the creator's, a fee collected for the market's budget", () => {
  const figures = journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk')
  const bought = entry({ kind: 'CREATOR_BOUGHT', pairRaw: '2000000', tokensRaw: '989076589761', enforcement: null })
  assert.equal(journalName(bought, uk), 'Творець купив')
  assert.equal(journalName(bought, en), 'The creator bought')
  assert.equal(journalMark(bought), 'observed')
  assert.match(journalDetail(bought, figures, uk, 'uk'), /^989[\s  ]076 \$EXOWL за \$2$/)
  assert.equal(journalDetail({ ...bought, pairRaw: null }, figures, uk, 'uk'), null)
  const claimed = entry({
    kind: 'FEE_CLAIMED',
    actor: 'ryntra',
    pairRaw: '273180',
    source: 'curve',
    budgetRaw: '68295',
    enforcement: 'policy',
  })
  assert.equal(journalName(claimed, uk), 'Ryntra зібрала комісію для бюджету ринку')
  assert.equal(journalMark(claimed), 'policy')
  assert.match(
    journalDetail(claimed, figures, uk, 'uk'),
    /^Партнерські комісії кривої: .+, з них .+ — у бюджет; решта — дохід Ryntra$/,
  )
  assert.match(
    journalDetail({ ...claimed, source: 'migration' }, figures, en, 'en'),
    /^The graduation fee: .+, all of it to the budget$/,
  )
  // A source the phone has no words for, or none, says no line — never a code.
  assert.equal(journalDetail({ ...claimed, source: 'elsewhere' }, figures, uk, 'uk'), null)
  // The budget's part not read: no line, never «$0 to the budget»; the graduation fee needs none.
  assert.equal(journalDetail({ ...claimed, budgetRaw: null }, figures, uk, 'uk'), null)
  assert.ok(journalDetail({ ...claimed, source: 'migration', budgetRaw: null }, figures, uk, 'uk'))
  assert.equal(journalDetail({ ...claimed, source: undefined }, figures, uk, 'uk'), null)
})

test('a move up of the ladder is one row with its emptying; the rest stay in order, the newest first', () => {
  const raised = entry({ kind: 'FLOOR_RAISED', signature: 'up' })
  const emptied = entry({ kind: 'FLOOR_WITHDRAWN', signature: 'out' })
  const rows = journalRows([raised, emptied, entry({ kind: 'GRADUATED', signature: 'g' })])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].entry, raised)
  assert.equal(rows[0].emptied, emptied)
  assert.equal(rows[1].entry.kind, 'GRADUATED')
  // An emptying with no move up after it stands alone.
  assert.equal(journalRows([emptied]).length, 1)
  assert.equal(journalRows(SAMPLE_JOURNAL.events).length, 5)
})

test('the mark: a rule, a policy, an observation for null — nothing for a log before 1.36.0', () => {
  assert.equal(journalMark(entry({ enforcement: 'rule' })), 'rule')
  assert.equal(journalMark(entry({ enforcement: 'policy' })), 'policy')
  assert.equal(journalMark(entry({ enforcement: null })), 'observed')
  assert.equal(journalMark(entry({ enforcement: undefined })), null)
  assert.equal(uk('enforce_observed'), 'Спостереження')
  const [placed, pool, graduated, locked, launched] = SAMPLE_JOURNAL.events
  assert.deepEqual([placed, pool, graduated, locked, launched].map(journalMark), [
    'policy',
    'policy',
    'rule',
    'rule',
    'rule',
  ])
})

test("the contract's example in words, with its amounts", () => {
  const figures = journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk')
  const lines = SAMPLE_JOURNAL.events.map((event) => journalDetail(event, figures, uk, 'uk'))
  assert.match(lines[0], /^\$90 на купівлю від \$0,00007104 до \$0,00007692$/)
  assert.match(lines[1], /^Пул вимагає, щоб його творець мав токен: Ryntra купила 1 \$EXOWL за \$0,01$/)
  assert.match(lines[2], /^Крива набрала \$15,5 тис\. · вихід запустила Meteora$/)
  assert.match(lines[3], /^19[\s ]600[\s ]000 \$EXOWL під замком із вестингом$/)
  assert.match(lines[4], /^Творець купив 19[\s ]600[\s ]000 \$EXOWL за \$200$/)
  const enFigures = journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'en')
  assert.equal(
    journalDetail(SAMPLE_JOURNAL.events[2], enFigures, en, 'en'),
    'The curve held $15.5K · migrated by Meteora',
  )
})

test("who sent the move to the DEX, and a sale of the creator's with the share sold", () => {
  const figures = journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk')
  const graduated = (actor) =>
    journalDetail(entry({ kind: 'GRADUATED', actor, pairRaw: '15454411163' }), figures, uk, 'uk')
  assert.match(graduated('ryntra'), /вихід запустила Ryntra$/)
  assert.match(graduated('other'), /вихід запустив інший гаманець$/)
  const sold = entry({
    kind: 'CREATOR_SOLD',
    pairRaw: '4851364',
    tokensRaw: '989076589761',
    soldBps: 10000,
    soldOf: 'bought',
    enforcement: null,
  })
  assert.match(
    journalDetail(sold, figures, uk, 'uk'),
    /^989[\s ]076 \$EXOWL за \$4,85 · 100 % купленого на той момент$/,
  )
  assert.match(
    journalDetail({ ...sold, soldBps: 1250, soldOf: 'supply' }, figures, uk, 'uk'),
    /12,5 % емісії на той момент$/,
  )
  // An amount the log did not read is not said — never a zero in its place.
  assert.equal(journalDetail({ ...sold, soldBps: null }, figures, uk, 'uk'), null)
  assert.equal(journalDetail(entry({ kind: 'GRADUATED' }), figures, uk, 'uk'), null)
  assert.equal(journalDetail(entry({ kind: 'LAUNCHED' }), figures, uk, 'uk'), null)
})

test('«Чому?» opens the rules an entry stands on, as the market lists them now', () => {
  const codes = (event, health = SAMPLE_HEALTH_DEX) => whyRules(event, health).map((rule) => rule.code)
  const [placed, pool, graduated, locked, launched] = SAMPLE_JOURNAL.events
  assert.deepEqual(codes(placed), ['FEE_FUNDED_LADDER'])
  assert.deepEqual(codes(pool), ['FEE_FUNDED_LADDER'])
  // After the DEX the threshold is no rule any more: the pool's locks are.
  assert.deepEqual(codes(graduated), ['LP_LOCKED_FOREVER', 'LP_LOCKED_FOREVER'])
  assert.deepEqual(codes(locked), ['CREATOR_LOCK'])
  assert.deepEqual(codes(launched), ['CONFIG_FIXED', 'CREATOR_FIRST_BUY_CAP'])
  assert.deepEqual(codes(entry({ kind: 'LAUNCHED' }), SAMPLE_HEALTH_CURVE), ['CONFIG_FIXED', 'CURVE_HOLDS_FUNDS'])
  assert.deepEqual(codes(entry({ kind: 'CREATOR_SOLD', enforcement: null })), ['CREATOR_SALE_MARK'])
  assert.deepEqual(codes(entry({ kind: 'GRADUATED' }), SAMPLE_HEALTH_CURVE), ['GRADUATION_AT_THRESHOLD'])
  // No health read, a rule the market does not list, a kind the phone does not know: no «Чому?».
  assert.deepEqual(whyRules(launched, null), [])
  assert.deepEqual(codes(entry({ kind: 'FEES_SHARED' })), [])
  assert.deepEqual(codes(entry({ kind: 'SOMETHING_NEW' })), [])
})

test("Ryntra's ladder only while it stands, as liquidity from its fees — never a price held", () => {
  const figures = journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk')
  const floor = journalFloor(SAMPLE_JOURNAL, figures, uk)
  assert.equal(floor.kind, 'stands')
  assert.match(floor.line, /^\$90 з комісій Ryntra на цьому токені — на купівлю від \$0,00007104 до \$0,00007692$/)
  // It bought nothing yet: nothing said of it.
  assert.equal(floor.bought, null)
  assert.match(
    journalFloor({ ...SAMPLE_JOURNAL, floor: { ...SAMPLE_JOURNAL.floor, tokensRaw: '1200000' } }, figures, uk).bought,
    /^Уже купила 1 \$EXOWL і тримає їх$/,
  )
  assert.equal(journalFloor({ ...SAMPLE_JOURNAL, floor: null }, figures, uk), null)
  assert.deepEqual(journalFloor({ ...SAMPLE_JOURNAL, floor: null, floorUnread: true }, figures, uk), { kind: 'unread' })
  assert.equal(uk('floorTitle'), 'Драбина ліквідності з комісій')
  const said = Object.entries(LAUNCH_WORDS)
    .filter(([key]) => key.startsWith('log') || key.startsWith('floor'))
    .flatMap(([, value]) => [value.uk, value.en])
  for (const text of said) {
    assert.doesNotMatch(text, /підлог|ціна тримається|тримає ціну|price floor|holds the price|price is held/i, text)
  }
})

test('read in part, and holding more than it gives, the log says so', () => {
  // Under the page's three entries «показано N з M» would not be what is seen: it is said only where the whole answer is.
  assert.deepEqual(journalNotes({ ...SAMPLE_JOURNAL, total: 412, complete: false }, uk, false), [
    { text: 'Прочитано частково: частини записів може бракувати.', warn: true },
  ])
  // Nearly all is never «100 %»; less than a token is never «0».
  assert.match(
    journalDetail(
      { ...entry({ kind: 'CREATOR_SOLD', pairRaw: '1', tokensRaw: '400000', soldBps: 9996, soldOf: 'bought' }) },
      journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk'),
      uk,
      'uk',
    ),
    /^< 1 \$EXOWL за .* · > 99,9 % купленого/,
  )
  assert.deepEqual(whyRules(entry({ kind: 'constructor' }), SAMPLE_HEALTH_DEX), [])
  // A crumb of a sale is never «0 %».
  const sold = entry({
    kind: 'CREATOR_SOLD',
    pairRaw: '1',
    tokensRaw: '1000000',
    soldBps: 4,
    soldOf: 'bought',
    enforcement: null,
  })
  assert.match(journalDetail(sold, journalFigures(SAMPLE_JOURNAL, 'EXOWL', 'uk'), uk, 'uk'), /< 0,1 % купленого/)
  assert.deepEqual(journalNotes(SAMPLE_JOURNAL, uk, true), [])
  assert.deepEqual(
    journalNotes({ ...SAMPLE_JOURNAL, total: 412 }, uk, true).map((note) => note.text),
    ['Показано 5 з 412 — найновіші.'],
  )
  assert.deepEqual(
    journalNotes({ ...SAMPLE_JOURNAL, complete: false }, uk, true).map((note) => note.text),
    ['Прочитано частково: частини записів може бракувати.'],
  )
  assert.deepEqual(journalNotes({ ...SAMPLE_JOURNAL, total: undefined }, en, true), [])
  assert.deepEqual(
    journalNotes({ ...SAMPLE_JOURNAL, total: 412, complete: false }, en, true).map((note) => note.text),
    ['Showing 5 of 412: the newest.', 'Read in part: some entries may be missing.'],
  )
})
