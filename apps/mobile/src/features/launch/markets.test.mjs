import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LAUNCH_WORDS, launchWords } from './copy.ts'
import {
  addressRows,
  creatorFreeLine,
  ladderHelp,
  LADDER_STATES,
  lockBoundBps,
  lockedWhatLine,
  budgetRows,
  concentrationLines,
  creatorLockText,
  creatorSoldText,
  depthAllSame,
  engineLines,
  healthDepth5,
  healthDoorLine,
  holdersLine,
  holdersView,
  ladderLine,
  nextLine,
  oldestRead,
  pairMoney,
  pct,
  poolLocked,
  READING_MS,
  rowDepth,
  rowReading,
  rowTradeStatus,
  ruleText,
  rulesToShow,
  stateLine,
  stateTone,
  budgetInRows,
  poolLockState,
  depthBars,
  keeperWord,
  namesShared,
  reserveText,
  sinceText,
  marketKey,
  readsOnChange,
  sinceShort,
  pauseWord,
  knownState,
  knownRule,
  shortDate,
  onDexNow,
  curveFull,
  poolLine,
  poolAddressOf,
  headerSince,
  holdersFloor,
  rowHoldersView,
  healthTradeStatus,
  cabinetTradeStatus,
} from './market-view.ts'
import { SAMPLE_HEALTH_CURVE, SAMPLE_HEALTH_DEX, SAMPLE_MARKET_CARD, SAMPLE_MARKETS } from './market-samples.ts'

const uk = launchWords('uk')
const en = launchWords('en')
const NOW = Date.parse('2026-10-09T12:00:00.000Z')

const STATES = [
  'CREATED',
  'PRICE_DISCOVERY',
  'GRADUATION_READY',
  'MIGRATING',
  'CORE_MARKET_LIVE',
  'ENDOWMENT_FUNDED',
  'LADDER_ACTIVE',
  'MAINTAINING',
  'PAUSED_RISK',
  'MATURE',
  'MIGRATION_FAILED',
  'ENDOWMENT_EXHAUSTED',
]

/** The receipt's marks «Чесний лаунч» shows on a graduated launch's page. */
const MARKS = [
  'MINT_REVOKED',
  'NO_FREEZE',
  'METADATA_FIXED',
  'NO_TRANSFER_HOOK',
  'CURVE_HOLDS_FUNDS',
  'LP_LOCKED_FOREVER',
  'CREATOR_BUY_LOCKED',
]

const health = (patch) => ({ ...SAMPLE_HEALTH_DEX, ...patch })
const curve = (patch) => ({ ...SAMPLE_HEALTH_CURVE, ...patch })

test('every state of the cycle has its word, its sentence and its tone in both languages', () => {
  for (const code of STATES) {
    for (const word of [uk, en]) {
      assert.notEqual(word(`state_${code}`), `state_${code}`)
      assert.notEqual(word(`stateHint_${code}`), `stateHint_${code}`)
    }
    assert.ok(['curve', 'live', 'ladder', 'caution'].includes(stateTone(code)), code)
  }
  // Ryntra's ladder at work is a state, never «healthy»; a stop and the failures are worth a look.
  assert.equal(stateTone('LADDER_ACTIVE'), 'ladder')
  assert.equal(stateTone('PAUSED_RISK'), 'caution')
  assert.equal(stateTone('MIGRATION_FAILED'), 'caution')
  assert.equal(stateTone('CORE_MARKET_LIVE'), 'live')
})

test("the web's words for the markets are the phone's, both languages, nothing empty", () => {
  for (const [key, value] of Object.entries(LAUNCH_WORDS)) {
    assert.ok(value.en.trim() && value.uk.trim(), key)
  }
  assert.equal(uk('marketsTitle'), 'Лаунчі на Ryntra')
  assert.equal(en('marketsTitle'), 'Markets launched on Ryntra')
  assert.equal(uk('tabMarkets'), 'Лаунчі на Ryntra')
  assert.equal(uk('techChip'), 'Тестовий запуск Ryntra')
  assert.equal(uk('notRead'), 'Не прочитано')
  assert.equal(uk('notCounted'), 'Ще не рахуємо')
  assert.equal(uk('hRules'), 'Що тримає цей ринок')
  assert.equal(uk('enforce_rule'), 'Правило')
  assert.equal(uk('enforce_policy'), 'Від Ryntra')
})

test('the list from the contract: Ryntra’s own launch marked, the depth at −5 % as money, holders counted', () => {
  const [owl, cat] = SAMPLE_MARKETS.markets
  assert.equal(owl.technicalValidation, false)
  assert.equal(cat.technicalValidation, true)
  assert.deepEqual(rowDepth(owl), { kind: 'raw', raw: '373225136' })
  assert.equal(pairMoney('373225136', owl.pair, 'uk'), '$373')
  assert.equal(pairMoney('292730686', cat.pair, 'en'), '$293')
  assert.deepEqual(holdersView(owl.holders, owl.holdersAtLeast), { kind: 'count', count: 5, atLeast: false })
  assert.equal(oldestRead(SAMPLE_MARKETS.markets), '2026-10-09T12:00:00.000Z')
})

test('a figure not read is «Не прочитано», a floor of none «Не пораховано» — never a zero', () => {
  const [, cat] = SAMPLE_MARKETS.markets
  const unread = {
    ...cat,
    read: false,
    depth5Raw: null,
    holders: null,
    holdersAtLeast: false,
    state: null,
    progress: null,
  }
  assert.deepEqual(rowDepth(unread), { kind: 'notRead' })
  assert.deepEqual(holdersView(unread.holders, unread.holdersAtLeast), { kind: 'notRead' })
  // The node would not scan every account and none found holds over $1: a floor of none, not a count.
  assert.deepEqual(holdersView(null, true), { kind: 'uncounted' })
  assert.equal(
    holdersLine(curve({ holders: { count: null, atLeast: true, minUsd: 1 } }), uk, 'uk').text,
    'Не пораховано',
  )
  assert.equal(
    holdersLine(curve({ holders: { count: null, atLeast: false, minUsd: 1 } }), uk, 'uk').text,
    'Не прочитано',
  )
  assert.equal(holdersLine(curve({ holders: { count: 4, atLeast: true, minUsd: 1 } }), uk, 'uk').text, 'Щонайменше 4')
  // A real zero read from the chain stays a figure; only null is «not read».
  assert.deepEqual(holdersView(0, false), { kind: 'count', count: 0, atLeast: false })
  // A market not read is «reading» for a minute after the list opened, then its figures say «not read».
  assert.equal(rowReading(unread, NOW, NOW + 1_000), true)
  assert.equal(rowReading(unread, NOW, NOW + READING_MS), false)
  assert.equal(rowReading(cat, NOW, NOW), false)
})

test('a full curve takes no sale: its depth is «Крива повна», not a figure', () => {
  const [, cat] = SAMPLE_MARKETS.markets
  const full = { ...cat, state: { code: 'GRADUATION_READY', since: null } }
  assert.deepEqual(rowDepth(full), { kind: 'curveFull' })
  assert.deepEqual(healthDepth5(curve({ state: { code: 'GRADUATION_READY', since: null } })), { kind: 'curveFull' })
  assert.equal(
    healthDoorLine(curve({ state: { code: 'MIGRATING', since: null } }), false, uk, 'uk'),
    'Продаж до падіння на 5 %: Крива повна',
  )
})

test('the budget not accounted is «Ще не рахуємо» — earned and reserve never zero; deployed is the ladder', () => {
  const rows = budgetRows(SAMPLE_HEALTH_DEX, uk, 'uk')
  assert.deepEqual(
    rows.map((row) => [row.label, row.value, row.counted]),
    [
      ['Зароблено', 'Ще не рахуємо', false],
      ['Розгорнуто', '$90', true],
      ['Резерв', 'Ще не рахуємо', false],
    ],
  )
  const onCurve = budgetRows(SAMPLE_HEALTH_CURVE, uk, 'uk')
  assert.equal(onCurve[1].value, 'Драбини немає')
  const unreadLadder = budgetRows(
    health({ budget: { ...SAMPLE_HEALTH_DEX.budget, ladder: 'UNREAD', deployed: null } }),
    uk,
    'uk',
  )
  assert.equal(unreadLadder[1].value, 'Не прочитано')
  for (const row of [...rows, ...onCurve, ...unreadLadder]) assert.doesNotMatch(row.value, /^\$?0$/)
})

test('Ryntra’s ladder in one line: what the deepest drop reaches, else where its steps stand, else nothing', () => {
  assert.equal(ladderLine(SAMPLE_HEALTH_DEX, uk, 'uk'), 'З них драбина Ryntra: $60 до −10 %')
  assert.equal(ladderLine(SAMPLE_HEALTH_DEX, en, 'en'), "Of it, Ryntra's ladder: $60 down to −10%")
  // Out of the deepest drop's reach and below the price by more than a tenth: it stands deeper.
  const deeper = health({
    depth: SAMPLE_HEALTH_DEX.depth.map((level) => ({ ...level, ladderRaw: '0' })),
    ladder: { ...SAMPLE_HEALTH_DEX.ladder, pairFrom: 0.00005, pairTo: 0.00006 },
  })
  assert.match(
    ladderLine(deeper, uk, 'uk'),
    /^Драбина Ryntra стоїть глибше: її сходинки купують від \$0,00005 до \$0,00006, ціна зараз \$0,000081$/,
  )
  // Sales went through its steps: they hold the token, not the pair — never «$0».
  const used = health({
    depth: SAMPLE_HEALTH_DEX.depth.map((level) => ({ ...level, ladderRaw: '0' })),
    ladder: { ...SAMPLE_HEALTH_DEX.ladder, pairFrom: null, pairTo: null },
  })
  assert.equal(
    ladderLine(used, uk, 'uk'),
    'Купівлі Ryntra нижче ціни вже виконано: продажі пройшли крізь них, і куплений токен тримає Ryntra',
  )
  // No steps: nothing is said, as on the web — whether a ladder will ever stand here is not in the answer.
  const none = { ladder: null, budget: { ...SAMPLE_HEALTH_DEX.budget, ladder: 'NONE', deployed: null } }
  assert.equal(ladderLine(health(none), uk, 'uk'), null)
  assert.equal(ladderLine(health(none), uk, 'uk', 'card'), null)
  assert.equal(
    ladderLine(health({ ...none, engine: { executor: null, acts: false, lastAction: null, pause: null } }), uk, 'uk'),
    null,
  )
  assert.equal(ladderLine(health({ ...none, engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false } }), uk, 'uk'), null)
  assert.equal(
    ladderLine(
      health({ ladder: null, budget: { ...SAMPLE_HEALTH_DEX.budget, ladder: 'UNREAD', deployed: null } }),
      uk,
      'uk',
    ),
    'Купівлі Ryntra нижче ціни зараз не прочитано',
  )
})

test('the state in words and what comes next — never a promise the data does not hold', () => {
  assert.equal(stateLine(SAMPLE_HEALTH_DEX.state, uk, 'uk', NOW), 'Сходинки Ryntra на купівлю стоять нижче ціни.')
  assert.equal(
    stateLine({ code: 'MAINTAINING', since: '2026-10-09T10:00:00.000Z' }, uk, 'uk', NOW),
    'Востаннє піднято чи поповнено 2 год тому.',
  )
  // On the curve the way to the threshold says what comes next («До виходу ще …»): nothing said twice.
  assert.equal(nextLine(SAMPLE_HEALTH_CURVE, uk), null)
  // A full curve: Ryntra sends the move only while its executor acts here.
  const ready = curve({ state: { code: 'GRADUATION_READY', since: null } })
  assert.equal(nextLine(ready, uk), null)
  assert.equal(
    nextLine({ ...ready, engine: { ...ready.engine, executor: 'X', acts: true } }, uk),
    'Далі — пул DEX; якщо ніхто інший, вихід надішле Ryntra',
  )
  assert.equal(
    nextLine(curve({ state: { code: 'MIGRATING', since: null } }), en),
    'Next: trading in its DEX pool, once the network confirms',
  )
  assert.equal(nextLine(SAMPLE_HEALTH_DEX, uk), null)
  // A stop: its reason in words on the card, never a time the server does not give.
  const paused = health({
    state: { code: 'PAUSED_RISK', since: null },
    engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false, pause: { code: 'RISK_LIMIT', at: null } },
  })
  // A pause on the card says trading goes on, as the web's state line; its reason stands with the executor in the sheet.
  assert.equal(nextLine(paused, uk), null)
  assert.equal(stateLine(paused.state, uk, 'uk', NOW), 'Дії Ryntra на цьому ринку на паузі; торгівля йде далі.')
  assert.equal(
    engineLines(paused, uk)[0].text,
    'Пауза за ризик-лімітом: Ryntra нічого тут не робить, поки ризик не мине.',
  )
  // On the DEX the card's sentence names neither the pool's program nor its lock — the pool's own line says that.
  assert.equal(stateLine({ code: 'CORE_MARKET_LIVE', since: null }, uk, 'uk', NOW), 'Торгується в пулі DEX.')
  assert.equal(
    stateLine({ code: 'ENDOWMENT_EXHAUSTED', since: null }, en, 'en', NOW),
    "The ladder isn't topped up any more; the market lives on its DEX pool.",
  )
  for (const code of STATES) assert.doesNotMatch(stateLine({ code, since: null }, uk, 'uk', NOW), /DAMM/, code)
  // A pool is said locked for ever from the card's locked positions alone, too.
  assert.equal(poolLocked({ ...SAMPLE_HEALTH_DEX, rules: [] }, SAMPLE_MARKET_CARD), true)
  assert.equal(poolLocked({ ...SAMPLE_HEALTH_DEX, rules: [] }, null), false)
  assert.equal(poolLocked(SAMPLE_HEALTH_DEX, SAMPLE_MARKET_CARD), true)
  assert.equal(poolLocked(SAMPLE_HEALTH_CURVE, null), false)
})

test('«Що тримає цей ринок»: rules and policies with their words, without what «Чесний лаунч» shows', () => {
  const rules = rulesToShow(SAMPLE_HEALTH_DEX, MARKS)
  assert.deepEqual(
    rules.map((rule) => `${rule.code}:${rule.enforcement}`),
    [
      'CONFIG_FIXED:rule',
      'CREATOR_FIRST_BUY_CAP:policy',
      'FEE_FUNDED_LADDER:policy',
      'CREATOR_SALE_MARK:policy',
      'CONCENTRATION_MARK:policy',
    ],
  )
  const text = (rule) => ruleText(rule, SAMPLE_HEALTH_DEX.pair, uk, 'uk', NOW)
  assert.equal(text(rules[1]), 'Перша покупка творця — не більше 5 % емісії')
  assert.equal(text(rules[4]), 'Топ-10 понад 60 % — позначка')
  // Without the receipt's marks every rule is said here; each has a sentence, never its code.
  for (const rule of [...SAMPLE_HEALTH_DEX.rules, ...SAMPLE_HEALTH_CURVE.rules]) {
    const said = ruleText(rule, SAMPLE_HEALTH_DEX.pair, uk, 'uk', NOW)
    assert.doesNotMatch(said, /^(rule|mark)_/, rule.code)
  }
  const threshold = SAMPLE_HEALTH_CURVE.rules.find((rule) => rule.code === 'GRADUATION_AT_THRESHOLD')
  assert.equal(
    ruleText(threshold, SAMPLE_HEALTH_CURVE.pair, uk, 'uk', NOW),
    'Вихід на DEX — на $15,5 тис.; надіслати його може будь-хто',
  )
  // The pool's locked shares, by whose they are.
  const locks = SAMPLE_HEALTH_DEX.rules.filter((rule) => rule.code === 'LP_LOCKED_FOREVER')
  assert.deepEqual(
    locks.map((rule) => ruleText(rule, SAMPLE_HEALTH_DEX.pair, uk, 'uk', NOW)),
    ['Частку творця в пулі DEX замкнено назавжди', 'Частку Ryntra в пулі DEX замкнено назавжди'],
  )
  // A figure the rule does not carry is not said — never «$0» or «0 %» in its place.
  const bare = (code) =>
    ruleText(
      { code, enforcement: 'rule', by: 'ryntra', source: null, values: {} },
      SAMPLE_HEALTH_DEX.pair,
      uk,
      'uk',
      NOW,
    )
  assert.equal(bare('GRADUATION_AT_THRESHOLD'), 'Вихід на DEX — на порозі кривої; надіслати його може будь-хто')
  assert.equal(bare('CREATOR_FIRST_BUY_CAP'), 'Перша покупка творця — з обмеженням')
  assert.equal(bare('CONCENTRATION_MARK'), 'Топ-10 понад позначку — позначка')
  for (const code of ['GRADUATION_AT_THRESHOLD', 'CREATOR_FIRST_BUY_CAP', 'CONCENTRATION_MARK'])
    assert.doesNotMatch(bare(code), /\b0\b/)
})

test('one measure per name: «Топ-10» of the supply on the market, of circulating tokens in the health', () => {
  assert.equal(uk('top10'), 'Топ-10 · частка емісії')
  assert.equal(en('top10'), 'Top 10 · share of supply')
  assert.equal(uk('risk_TOP10_HOLD', { pct: '38 %' }), '10 найбільших власників мають 38 % емісії')
  assert.match(uk('hTop10', { pct: '42 %' }), /в обігу$/)
})

test('a crumb read is «< $0,01», never a false zero; a real zero stays a zero', () => {
  const usdc = SAMPLE_HEALTH_DEX.pair
  assert.equal(pairMoney('3000', usdc, 'uk'), '< $0,01')
  assert.equal(pairMoney('3000', usdc, 'en'), '< $0.01')
  assert.equal(pairMoney('3000', { symbol: 'COMM', decimals: 6, dollar: false }, 'uk'), '< 0,01 COMM')
  assert.equal(pairMoney('0', usdc, 'uk'), '$0')
  assert.equal(pairMoney('4949933', usdc, 'uk'), '$4,95')
})

test('money under a hundred keeps both cents — «$3,90», never «$3,9» — and a whole sum stays whole', () => {
  const usdc = SAMPLE_HEALTH_DEX.pair
  assert.equal(pairMoney('3900000', usdc, 'en'), '$3.90')
  assert.equal(pairMoney('3900000', usdc, 'uk'), '$3,90')
  assert.equal(pairMoney('90000000', usdc, 'en'), '$90')
  assert.equal(pairMoney('3900000', { symbol: 'COMM', decimals: 6, dollar: false }, 'en'), '3.90 COMM')
})

test('a list card says one status — whether it trades now — never the cycle and «Live» beside it', () => {
  const row = (code, venue, progress) => ({ state: code ? { code, since: null } : null, venue, progress })
  // Ryntra's ladder at work on a DEX market: it trades, as Home's «Мої ринки» says.
  assert.equal(rowTradeStatus(row('MAINTAINING', 'pool', { bps: 10_000, migrated: true })), 'trading')
  assert.equal(rowTradeStatus(row('PRICE_DISCOVERY', 'curve', { bps: 4_200, migrated: false })), 'trading')
  // A pause stops Ryntra, not the market.
  assert.equal(rowTradeStatus(row('PAUSED_RISK', 'curve', { bps: 4_200, migrated: false })), 'trading')
  // A full curve takes no trade until it is on the DEX.
  assert.equal(rowTradeStatus(row('GRADUATION_READY', 'curve', { bps: 10_000, migrated: false })), 'moving')
  assert.equal(rowTradeStatus(row('MIGRATING', null, null)), 'moving')
  assert.equal(rowTradeStatus(row('PAUSED_RISK', 'curve', { bps: 10_000, migrated: false })), 'moving')
  assert.equal(rowTradeStatus(row('MIGRATION_FAILED', 'curve', { bps: 10_000, migrated: false })), 'stalled')
  // Not read is not read; a stage the server names still says it trades, a pause alone does not.
  assert.equal(rowTradeStatus(row(null, null, null)), 'notRead')
  assert.equal(rowTradeStatus(row('PAUSED_RISK', null, null)), 'notRead')
  assert.equal(rowTradeStatus(row('CORE_MARKET_LIVE', null, null)), 'trading')
  // The words are Home's.
  assert.equal(uk('tradeStatus_trading'), 'Торгується')
  assert.equal(en('tradeStatus_trading'), 'Trading')
})

test('the creator’s lock reads its dates: until the cliff, vesting after it; a row not read never says «no lock»', () => {
  const lockRule = SAMPLE_HEALTH_DEX.rules.find((rule) => rule.code === 'CREATOR_LOCK')
  assert.match(
    ruleText(lockRule, SAMPLE_HEALTH_DEX.pair, uk, 'uk', NOW),
    /^Покупка творця під замком до 30 груд\. 2026/,
  )
  assert.match(
    ruleText(lockRule, SAMPLE_HEALTH_DEX.pair, uk, 'uk', Date.parse('2027-01-15T00:00:00Z')),
    /^Покупка творця вивільняється поступово до 30 бер\. 2027/,
  )
  const lock = SAMPLE_HEALTH_DEX.creator.lock
  assert.deepEqual(creatorLockText(lock, true, uk, 'uk', NOW), { text: 'Замок до 30 груд. 2026 р.', locked: true })
  assert.deepEqual(creatorLockText(null, true, uk, 'uk', NOW), { text: 'Без замка', locked: false })
  assert.deepEqual(creatorLockText(null, false, uk, 'uk', NOW), { text: 'Не прочитано', locked: false })
  assert.equal(creatorSoldText(SAMPLE_HEALTH_DEX.creator, uk, 'uk'), 'Не продавав')
  assert.equal(creatorSoldText({ ...SAMPLE_HEALTH_DEX.creator, sold: null }, uk, 'uk'), 'Продажі не прочитано')
  assert.equal(
    creatorSoldText({ ...SAMPLE_HEALTH_DEX.creator, sold: true, soldBps: 10_000, soldOf: 'bought' }, uk, 'uk'),
    'Продав 100 % купленого',
  )
  assert.equal(
    creatorSoldText({ ...SAMPLE_HEALTH_DEX.creator, sold: true, soldBps: 250, soldOf: 'supply' }, en, 'en'),
    'Sold 2.5% of the supply',
  )
})

test('concentration: the top ten’s share and the mark above 60 % — a mark, never a pause; not read is said so', () => {
  assert.deepEqual(concentrationLines(SAMPLE_HEALTH_DEX, uk, 'uk'), {
    share: 'Топ-10 тримають 100 % токенів в обігу',
    mark: { text: 'Понад 60 %: позначка', marked: true },
  })
  const floor = health({ concentration: { top10Bps: 4200, atLeast: true, marked: null, markBps: 6000 } })
  assert.deepEqual(concentrationLines(floor, uk, 'uk'), {
    share: 'Топ-10 тримають щонайменше 42 % токенів в обігу',
    mark: null,
  })
  assert.deepEqual(
    concentrationLines(
      health({ concentration: { top10Bps: null, atLeast: false, marked: null, markBps: 6000 } }),
      uk,
      'uk',
    ),
    { share: null, mark: null },
  )
  assert.equal(pct(6000, 'en'), '60%')
  assert.equal(pct(1250, 'uk'), '12,5 %')
})

test('Ryntra’s executor: a pause first, idle said once, its last action with its transaction', () => {
  // Acting here: what it does on this market first, then what it last did — the web's lines.
  assert.deepEqual(engineLines(SAMPLE_HEALTH_DEX, uk), [
    { text: 'Стежить за ринком — так, як визначила Ryntra.' },
    {
      text: 'Остання дія: Ryntra розмістила драбину',
      tx: SAMPLE_HEALTH_DEX.engine.lastAction.signature,
      at: '2026-10-06T08:55:00.000Z',
    },
  ])
  assert.deepEqual(engineLines(SAMPLE_HEALTH_CURVE, uk), [
    {
      text: 'На цій мережі Ryntra ще не діє — вихід на DEX може надіслати будь-хто, зокрема Meteora.',
      quiet: true,
    },
  ])
  const paused = health({
    state: { code: 'PAUSED_RISK', since: null },
    engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false, pause: { code: 'STOPPED', at: null } },
  })
  const lines = engineLines(paused, uk)
  assert.equal(lines[0].mark, true)
  assert.equal(lines[0].text, 'Ryntra зараз не діє на цьому ринку: драбина стоїть, але не рухається.')
  assert.equal(lines.length, 2)
  const idle = curve({ engine: { executor: 'X', acts: false, lastAction: null, pause: null } })
  assert.deepEqual(engineLines(idle, uk), [
    { text: 'Зараз не діє на цій мережі — вихід на DEX може надіслати будь-хто.', quiet: true },
  ])
  const fresh = curve({ engine: { executor: 'X', acts: true, lastAction: null, pause: null } })
  assert.deepEqual(engineLines(fresh, uk), [
    { text: 'Стежить за ринком: надішле вихід на DEX, щойно крива набере поріг.' },
    { text: 'На цьому ринку ще не діяв', quiet: true },
  ])
})

test('the depth: the same figure three times on a thin curve is said once; all zero is not', () => {
  const thin = curve({ depth: [200, 500, 1000].map((dropBps) => ({ dropBps, pairRaw: '4949933', ladderRaw: null })) })
  assert.equal(depthAllSame(thin), '4949933')
  assert.equal(
    depthAllSame(curve({ depth: [200, 500, 1000].map((dropBps) => ({ dropBps, pairRaw: '0', ladderRaw: null })) })),
    null,
  )
  assert.equal(depthAllSame(SAMPLE_HEALTH_CURVE), null)
  assert.equal(depthAllSame(SAMPLE_HEALTH_DEX), null)
  assert.equal(healthDoorLine(SAMPLE_HEALTH_DEX, false, uk, 'uk'), 'Продаж до падіння на 5 %: $373')
  assert.equal(
    healthDoorLine(
      health({ depth: SAMPLE_HEALTH_DEX.depth.map((level) => ({ ...level, pairRaw: null })) }),
      false,
      uk,
      'uk',
    ),
    'Продаж до падіння на 5 %: Не прочитано',
  )
  assert.equal(healthDoorLine(null, false, uk, 'uk'), 'Читаємо здоров’я ринку…'.replace('’', "'"))
  assert.equal(healthDoorLine(null, true, uk, 'uk'), "Зараз не вдалося прочитати здоров'я ринку.")
})

test('the market’s addresses one tap deep, in the order the money goes; none missing, none invented', () => {
  const rows = addressRows(SAMPLE_MARKET_CARD)
  assert.deepEqual(
    rows.map((row) => row.key),
    [
      'addr_curve',
      'addr_config',
      'addr_pool',
      'addr_locked',
      'addr_locked',
      'addr_creatorLock',
      'addr_ladder',
      'addr_executor',
    ],
  )
  for (const row of rows) assert.notEqual(uk(row.key), row.key)
})

test('every rule code and every keeper has its words — none is ever drawn as its code', () => {
  const codes = [
    'MINT_REVOKED',
    'NO_FREEZE',
    'METADATA_FIXED',
    'NO_TRANSFER_HOOK',
    'CONFIG_FIXED',
    'CURVE_HOLDS_FUNDS',
    'GRADUATION_AT_THRESHOLD',
    'LP_LOCKED_FOREVER',
    'CREATOR_LOCK',
    'CREATOR_FEES_SHARED',
    'CREATOR_FIRST_BUY_CAP',
    'GRADUATION_BY_RYNTRA',
    'FEE_FUNDED_LADDER',
    'CREATOR_SALE_MARK',
    'CONCENTRATION_MARK',
  ]
  for (const word of [uk, en])
    for (const code of codes) {
      const said = ruleText(
        { code, enforcement: 'rule', by: 'ryntra', source: null, values: {} },
        SAMPLE_HEALTH_DEX.pair,
        word,
        'uk',
        NOW,
      )
      assert.doesNotMatch(said, /^(rule|mark)_|\{/, code)
    }
  for (const by of ['token-2022', 'meteora-dbc', 'meteora-damm-v2', 'met-lock', 'dynamic-fee-sharing', 'ryntra'])
    assert.doesNotMatch(keeperWord(by, uk), /^keeper_/, by)
})

test('no ladder is said on the curve; on the market’s card a ladder at work says what its steps hold', () => {
  const acting = curve({ engine: { executor: 'X', acts: true, lastAction: null, pause: null } })
  assert.equal(ladderLine(acting, uk, 'uk'), null)
  assert.equal(ladderLine(acting, uk, 'uk', 'card'), null)
  assert.equal(ladderLine(SAMPLE_HEALTH_DEX, uk, 'uk', 'card'), 'Ryntra тримає $90 на купівлю нижче ціни')
  // Stopped, or no executor acting: what the steps hold, never «працює» beside «драбина стоїть».
  const stopped = health({ engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false, pause: { code: 'STOPPED', at: null } } })
  assert.equal(
    ladderLine(stopped, uk, 'uk', 'card'),
    '$90 від Ryntra стоїть на купівлю нижче ціни; зараз Ryntra її не рухає',
  )
  const idle = health({ engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false } })
  assert.equal(
    ladderLine(idle, en, 'en', 'card'),
    "$90 from Ryntra stands to buy below the price; Ryntra isn't moving it now",
  )
  // Bought through — the steps hold the token: the card says so in the web's words, never «$0».
  const used = health({ ladder: { ...SAMPLE_HEALTH_DEX.ladder, pairRaw: '0', pairFrom: null, pairTo: null } })
  assert.equal(
    ladderLine(used, uk, 'uk', 'card'),
    'Купівлі Ryntra нижче ціни вже виконано: продажі пройшли крізь них, і куплений токен тримає Ryntra',
  )
})

test('how long ago, as the web says it: «щойно» within a minute, whole units after, a date beyond a month', () => {
  assert.equal(sinceText('2026-10-09T11:59:15.000Z', uk, 'uk', NOW), 'щойно')
  assert.equal(sinceText('2026-10-09T11:55:00.000Z', uk, 'uk', NOW), '5 хв тому')
  assert.equal(sinceText('2026-10-07T12:00:00.000Z', en, 'en', NOW), '2 d ago')
  assert.equal(sinceText('2026-08-01T12:00:00.000Z', uk, 'uk', NOW), '1 серп. 2026 р.')
})

test('the health says each thing once: the budget once while nothing is counted; bars only where they compare', () => {
  assert.equal(budgetInRows(SAMPLE_HEALTH_CURVE), false)
  assert.equal(budgetInRows(SAMPLE_HEALTH_DEX), true)
  // A ladder not read is «Не прочитано» in its row, never folded into «Ще не рахуємо».
  const unread = health({ budget: { ...SAMPLE_HEALTH_DEX.budget, ladder: 'UNREAD', deployed: null } })
  assert.equal(budgetInRows(unread), true)
  assert.equal(budgetRows(unread, uk, 'uk')[1].value, 'Не прочитано')
  assert.equal(depthBars(SAMPLE_HEALTH_DEX), true)
  assert.equal(
    depthBars(curve({ depth: [200, 500, 1000].map((dropBps) => ({ dropBps, pairRaw: '4949933', ladderRaw: null })) })),
    false,
  )
  assert.equal(
    depthBars(curve({ depth: [200, 500, 1000].map((dropBps) => ({ dropBps, pairRaw: '0', ladderRaw: null })) })),
    false,
  )
})

test('the list tells two markets of one name apart, and never cuts a reserve under a hundred to whole units', () => {
  const [owl, cat] = SAMPLE_MARKETS.markets
  const twin = { ...cat, token: 'HgAhkysaHqnBE99oWMBAbCPy9VwNZYH5L2mJJTo1LrJq', name: owl.name, symbol: owl.symbol }
  assert.deepEqual([...namesShared([owl, cat, twin])].sort(), [owl.token, twin.token].sort())
  assert.equal(namesShared(SAMPLE_MARKETS.markets).size, 0)
  assert.equal(reserveText('4949933', 6, 'uk'), '4,95')
  assert.equal(reserveText('15454411163', 6, 'uk'), '15 454')
  assert.equal(reserveText('0', 6, 'en'), '0')
})

test('the pool is said locked for ever only when both shares are; a share alone is said as a share', () => {
  assert.equal(poolLockState(SAMPLE_HEALTH_DEX, SAMPLE_MARKET_CARD), 'all')
  const creatorOnly = health({ rules: SAMPLE_HEALTH_DEX.rules.filter((rule) => rule.values.owner !== 'partner') })
  assert.equal(poolLockState(creatorOnly, SAMPLE_MARKET_CARD), 'part')
  const noRules = health({ rules: [] })
  assert.equal(poolLockState(noRules, SAMPLE_MARKET_CARD), 'all')
  const oneLocked = {
    ...SAMPLE_MARKET_CARD,
    addresses: {
      ...SAMPLE_MARKET_CARD.addresses,
      lockedPositions: SAMPLE_MARKET_CARD.addresses.lockedPositions.slice(0, 1),
    },
  }
  assert.equal(poolLockState(noRules, oneLocked), 'part')
  assert.equal(poolLockState(SAMPLE_HEALTH_CURVE, null), 'none')
  assert.equal(uk('poolPartLocked'), 'Частку ліквідності пулу DEX замкнено назавжди')
  assert.equal(uk('sinceDate', { date: '6 жовт. 2026 р.' }), 'з 6 жовт. 2026 р.')
})

test('what is left on the way to the DEX is never «0» while some is left', () => {
  assert.equal(reserveText('300000', 6, 'uk'), '0,3')
  assert.equal(reserveText('1', 6, 'en'), '< 0.01')
  assert.equal(reserveText('1163', 6, 'uk'), '< 0,01')
  assert.equal(reserveText('0', 6, 'uk'), '0')
})

test('what the page reads again when the market moves: health on any change, the card once the way to the DEX ends', () => {
  const curveKey = marketKey({ trades: { read: 3, rows: [{ signature: 'a' }] }, progress: { migrated: false } })
  const traded = marketKey({ trades: { read: 4, rows: [{ signature: 'b' }] }, progress: { migrated: false } })
  const graduated = marketKey({ trades: { read: 4, rows: [{ signature: 'b' }] }, progress: { migrated: true } })
  assert.equal(curveKey, '3:a:false')
  assert.deepEqual(readsOnChange(null, curveKey), { health: false, card: false })
  assert.deepEqual(readsOnChange(curveKey, curveKey), { health: false, card: false })
  assert.deepEqual(readsOnChange(curveKey, traded), { health: true, card: false })
  assert.deepEqual(readsOnChange(traded, graduated), { health: true, card: true })
  // A change met while the page was hidden is read when it is seen: the key it last read is still the before.
  assert.deepEqual(readsOnChange(curveKey, graduated), { health: true, card: true })
})

test('since when a state stands: within a day in hours, from a day back by its date', () => {
  assert.equal(sinceShort('2026-10-09T09:00:00.000Z', uk, 'uk', NOW), '3 год тому')
  assert.equal(sinceShort('2026-10-07T06:04:09.000Z', uk, 'uk', NOW), 'З 7 жовт.')
  assert.equal(sinceShort('2026-10-07T06:04:09.000Z', en, 'en', NOW), 'Since Oct 7')
})

test('the creator’s lock after its cliff vests to its end; past its end it is no lock', () => {
  const lock = { escrow: 'E', cliffAt: '2026-11-06T06:04:03.000Z', endsAt: '2027-02-04T06:04:03.000Z' }
  assert.deepEqual(creatorLockText(lock, true, uk, 'uk', Date.parse('2026-12-01T00:00:00Z')), {
    text: 'Вестинг до 4 лют. 2027 р.',
    locked: true,
  })
  assert.deepEqual(creatorLockText(lock, true, uk, 'uk', Date.parse('2027-03-01T00:00:00Z')), {
    text: 'Без замка',
    locked: false,
  })
  assert.deepEqual(creatorLockText({ escrow: 'E', cliffAt: null, endsAt: null }, false, uk, 'uk', NOW), {
    text: 'Під замком',
    locked: true,
  })
})

test('the market’s own holders: a count, a floor with «+», and never «0+»', () => {
  assert.equal(holdersFloor(12, false, 'uk'), '12')
  assert.equal(holdersFloor(4, true, 'uk'), '4+')
  assert.equal(holdersFloor(0, true, 'uk'), '—')
  assert.equal(holdersFloor(0, false, 'uk'), '0')
})

test('a value a later contract adds never breaks the page: a stop is a stop, an unknown state is not read, an unknown rule is left out', () => {
  // 1.37.0: the operator's own pause, in the web's words.
  const operator = health({
    state: { code: 'PAUSED_RISK', since: null },
    engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false, pause: { code: 'OPERATOR', at: null } },
  })
  assert.equal(
    pauseWord({ code: 'OPERATOR' }, uk),
    'На паузі тут вручну: нічого не підписує, доки його знову не ввімкнуть.',
  )
  assert.equal(
    engineLines(operator, uk)[0].text,
    'На паузі тут вручну: нічого не підписує, доки його знову не ввімкнуть.',
  )
  // The card never says the operator's words without their subject: trading goes on, the reason one tap deeper.
  assert.equal(stateLine(operator.state, uk, 'uk', NOW), 'Дії Ryntra на цьому ринку на паузі; торгівля йде далі.')
  // Any stop the phone does not know yet is said as the pause itself, true at any stage — never a ladder that may not stand.
  assert.equal(pauseWord({ code: 'SOMETHING_NEW' }, uk), 'Дії Ryntra на цьому ринку на паузі; торгівля йде далі.')
  // A state the phone has no words for: no sentence, the chip says «Не прочитано» (knownState false), the tone quiet.
  assert.equal(knownState('SOMETHING_NEW'), false)
  assert.equal(knownState('MATURE'), true)
  assert.equal(stateLine({ code: 'SOMETHING_NEW', since: null }, uk, 'uk', NOW), null)
  assert.equal(stateTone('SOMETHING_NEW'), 'curve')
  // A rule, a keeper or an action the phone does not know is left out — never drawn as its code, never a crash.
  assert.equal(knownRule('SOMETHING_NEW'), false)
  assert.equal(knownRule('MINT_REVOKED'), true)
  const newRule = { code: 'SOMETHING_NEW', enforcement: 'rule', by: 'ryntra', source: null, values: {} }
  assert.deepEqual(
    rulesToShow(health({ rules: [...SAMPLE_HEALTH_DEX.rules, newRule] }), MARKS)
      .map((rule) => rule.code)
      .includes('SOMETHING_NEW'),
    false,
  )
  assert.equal(keeperWord('some-new-program', uk), '')
  const newAction = health({
    engine: { ...SAMPLE_HEALTH_DEX.engine, lastAction: { kind: 'SOMETHING_NEW', at: null, signature: 'S' } },
  })
  // It acted — what, the phone cannot say yet: never «На цьому ринку ще не діяв».
  assert.deepEqual(engineLines(newAction, uk), [{ text: 'Стежить за ринком — так, як визначила Ryntra.' }])
})

test('a date in a dense line says the year only where it differs', () => {
  // No-break spaces: a date never breaks across lines.
  assert.equal(shortDate('2026-10-06T08:00:40.000Z', 'uk', NOW), '6 жовт.')
  assert.equal(shortDate('2025-10-06T08:00:40.000Z', 'uk', NOW), '6 жовт. 2025 р.')
  assert.equal(shortDate('2026-10-06T08:00:40.000Z', 'en', NOW), 'Oct 6')
})

test('a paused curve keeps its way to the DEX: the pool only once the market moved or its venue is the pool', () => {
  const curveMarket = { progress: { migrated: false } }
  // 1.37.0: the operator's pause makes any market PAUSED_RISK, the curve's too.
  const pausedCurve = curve({
    state: { code: 'PAUSED_RISK', since: null },
    engine: { executor: 'X', acts: false, lastAction: null, pause: { code: 'OPERATOR', at: null } },
  })
  assert.equal(onDexNow(curveMarket, pausedCurve), false)
  assert.equal(onDexNow(curveMarket, null), false)
  assert.equal(onDexNow(curveMarket, SAMPLE_HEALTH_DEX), true)
  assert.equal(onDexNow({ progress: { migrated: true } }, null), true)
  // On the curve no ladder is said, paused or not.
  assert.equal(ladderLine(pausedCurve, uk, 'uk', 'card'), null)
})

test('a full curve is full by its own progress too — a pause over it never shows its depth as «$0»', () => {
  // 1.37.0: the operator's pause is PAUSED_RISK over any state, and a curve that filled under it stays full.
  assert.equal(curveFull('curve', 'PAUSED_RISK', { bps: 10_000, migrated: false }), true)
  assert.equal(curveFull('curve', 'PAUSED_RISK', { bps: 3_999, migrated: false }), false)
  assert.equal(curveFull('curve', 'GRADUATION_READY', null), true)
  assert.equal(curveFull('pool', 'PAUSED_RISK', { bps: 10_000, migrated: true }), false)
  const [, cat] = SAMPLE_MARKETS.markets
  const pausedFull = {
    ...cat,
    state: { code: 'PAUSED_RISK', since: null },
    progress: { bps: 10_000, migrated: false },
    depth5Raw: '0',
  }
  assert.deepEqual(rowDepth(pausedFull), { kind: 'curveFull' })
  const pausedHealth = curve({
    state: { code: 'PAUSED_RISK', since: null },
    depth: [200, 500, 1000].map((dropBps) => ({ dropBps, pairRaw: '0', ladderRaw: null })),
  })
  assert.deepEqual(healthDepth5(pausedHealth, { bps: 10_000, migrated: false }), { kind: 'curveFull' })
  assert.equal(
    healthDoorLine(pausedHealth, false, uk, 'uk', { bps: 10_000, migrated: false }),
    'Продаж до падіння на 5 %: Крива повна',
  )
})

test('the card’s pool line, its link and its header time — the pool and its lock, never the curve under the pool’s name', () => {
  // Both shares locked: the whole pool, since the day it opened, the year only where it differs.
  assert.deepEqual(poolLine(SAMPLE_HEALTH_DEX, SAMPLE_MARKET_CARD, uk, 'uk', NOW), {
    text: 'Пул DEX замкнений назавжди · з 6 жовт.',
    locked: true,
  })
  // One share's lock alone is said as a share.
  const creatorOnly = health({ rules: SAMPLE_HEALTH_DEX.rules.filter((rule) => rule.values.owner !== 'partner') })
  assert.equal(
    poolLine(creatorOnly, SAMPLE_MARKET_CARD, uk, 'uk', NOW)?.text,
    'Частку ліквідності пулу DEX замкнено назавжди · з 6 жовт.',
  )
  // No lock: since when it trades on the DEX; no lock and no date: nothing, the link alone names it.
  const open = health({ rules: [] })
  assert.deepEqual(poolLine(open, null, uk, 'uk', NOW), { text: 'На DEX з 6 жовт.', locked: false })
  assert.equal(
    poolLine(
      health({ rules: [], survival: { ...SAMPLE_HEALTH_DEX.survival, graduatedAt: null } }),
      null,
      uk,
      'uk',
      NOW,
    ),
    null,
  )
  // The link: the card's pool; else the market's own only once it moved; on the curve, none.
  const curveMarket = { progress: { migrated: false }, trading: { pool: 'CURVE' } }
  assert.equal(poolAddressOf(SAMPLE_MARKET_CARD, curveMarket), SAMPLE_MARKET_CARD.addresses.pool)
  assert.equal(poolAddressOf(null, curveMarket), null)
  assert.equal(poolAddressOf(null, { progress: { migrated: true }, trading: { pool: 'POOL' } }), 'POOL')
  // The header's time: not beside an unknown state, nor beside a sentence that says it.
  assert.equal(headerSince(SAMPLE_HEALTH_DEX, uk, 'uk', NOW), 'З 6 жовт.')
  assert.equal(
    headerSince(health({ state: { code: 'SOMETHING_NEW', since: '2026-10-06T08:55:00.000Z' } }), uk, 'uk', NOW),
    null,
  )
  assert.equal(
    headerSince(health({ state: { code: 'MAINTAINING', since: '2026-10-09T10:00:00.000Z' } }), uk, 'uk', NOW),
    null,
  )
})

test('a pause over a full curve says what a full curve says; a failed move is not said twice; unknown marks are left out', () => {
  const pausedFull = curve({ state: { code: 'PAUSED_RISK', since: null } })
  assert.equal(stateLine(pausedFull.state, uk, 'uk', NOW, true), uk('stateHint_GRADUATION_READY'))
  assert.equal(
    stateLine(pausedFull.state, uk, 'uk', NOW, false),
    'Дії Ryntra на цьому ринку на паузі; торгівля йде далі.',
  )
  const failed = curve({
    state: { code: 'MIGRATION_FAILED', since: null },
    engine: { executor: 'X', acts: true, lastAction: null, pause: null },
  })
  assert.equal(nextLine(failed, uk), null)
  // A rule whose mark (rule / policy) a later contract adds is left out, never a crash.
  const odd = { code: 'CONFIG_FIXED', enforcement: 'something-new', by: 'meteora-dbc', source: null, values: {} }
  assert.equal(rulesToShow(health({ rules: [odd] }), []).length, 0)
  // The ladder's budget row: «Драбини немає» only for NONE; any other without its figure is not read.
  assert.equal(
    budgetRows(
      health({ budget: { ...SAMPLE_HEALTH_DEX.budget, ladder: 'SOMETHING_NEW', deployed: null } }),
      uk,
      'uk',
    )[1].value,
    'Не прочитано',
  )
})

test('a bare zero of holders the market contradicts is not counted — «—», never «0»', () => {
  const [owl] = SAMPLE_MARKETS.markets
  const zero = { ...owl, holders: 0, holdersAtLeast: false }
  // The curve moved: some wallet holds it, so the server's 0 was not a count.
  assert.deepEqual(rowHoldersView({ ...zero, progress: { bps: 3, migrated: false } }), { kind: 'uncounted' })
  assert.deepEqual(rowHoldersView({ ...zero, progress: { bps: 10_000, migrated: true } }), { kind: 'uncounted' })
  assert.deepEqual(rowHoldersView({ ...zero, progress: null, traded24h: true }), { kind: 'uncounted' })
  assert.deepEqual(rowHoldersView({ ...zero, progress: null, traded24h: null, creatorSold: true }), {
    kind: 'uncounted',
  })
  // Nothing says anyone holds it: a zero stays a figure.
  assert.deepEqual(
    rowHoldersView({ ...zero, progress: { bps: 0, migrated: false }, traded24h: false, creatorSold: false }),
    { kind: 'count', count: 0, atLeast: false },
  )
  // A real count is left as it is.
  assert.deepEqual(rowHoldersView(owl), { kind: 'count', count: 5, atLeast: false })
})

test('one status everywhere: the page, the cabinet and the list say whether it trades; the stage is words', () => {
  assert.equal(
    healthTradeStatus({ state: { code: 'CREATED', since: null }, venue: 'curve' }, { bps: 3, migrated: false }),
    'trading',
  )
  assert.equal(
    healthTradeStatus(
      { state: { code: 'GRADUATION_READY', since: null }, venue: 'curve' },
      { bps: 10_000, migrated: false },
    ),
    'moving',
  )
  assert.equal(cabinetTradeStatus({ progressBps: 3, migrated: false }), 'trading')
  assert.equal(cabinetTradeStatus({ progressBps: 10_000, migrated: false }), 'moving')
  assert.equal(cabinetTradeStatus({ progressBps: 10_000, migrated: true }), 'trading')
  assert.equal(cabinetTradeStatus({ progressBps: null, migrated: null }), 'notRead')
  assert.equal(uk('filled', { pct: '0,03 %' }), 'заповнено 0,03 %')
  assert.equal(en('colDepth'), 'Can sell before a 5% drop')
  assert.equal(uk('holders'), 'Власники')
})

test('the ladder on the card is an outcome; how it works and when it last moved stand behind its «?»', () => {
  for (const code of ['ENDOWMENT_FUNDED', 'LADDER_ACTIVE', 'MAINTAINING']) assert.ok(LADDER_STATES.has(code), code)
  assert.ok(!LADDER_STATES.has('CREATED'))
  const maintaining = health({ state: { code: 'MAINTAINING', since: '2026-10-09T10:00:00.000Z' } })
  assert.deepEqual(ladderHelp(maintaining, uk, 'uk', NOW), [
    uk('ladderHelp'),
    'Востаннє піднято чи поповнено 2 год тому.',
  ])
  assert.deepEqual(ladderHelp(SAMPLE_HEALTH_DEX, en, 'en', NOW), [en('ladderHelp')])
  // No state machine words on the card's face.
  for (const key of ['ladderWorks', 'ladderHolds', 'hLadderUsed', 'ladderUnread', 'rule_FEE_FUNDED_LADDER'])
    assert.doesNotMatch(uk(key), /[Дд]рабин|сходин|[Ее]тап/, key)
})

test("the creator's lock says what it holds, and a creator holding more is told apart — only from the data", () => {
  const receipt = (patch) => ({
    creatorFirstBuy: { quoteInRaw: '1', tokensOutRaw: '20000000', capRaw: '20000000' },
    creatorLock: {
      escrow: 'E',
      lockedRaw: '20000000',
      cliffAt: '2027-04-08T00:00:00.000Z',
      endsAt: '2027-10-08T00:00:00.000Z',
    },
    token2022: { supplyRaw: '1000000000' },
    ...patch,
  })
  const exact = lockBoundBps(receipt({}))
  assert.deepEqual(exact, { bps: 200, exact: true })
  assert.equal(lockedWhatLine(exact, uk, 'uk'), 'Заблоковано: перша покупка творця, 2 % емісії')
  // The amount not in the receipt: the first buy without a figure, measured against its cap.
  const capped = lockBoundBps(receipt({ creatorLock: null }))
  assert.deepEqual(capped, { bps: 200, exact: false })
  assert.equal(lockedWhatLine(capped, en, 'en'), "Locked: the creator's first buy")
  assert.equal(lockBoundBps(receipt({ creatorLock: null, creatorFirstBuy: null })), null)
  assert.equal(lockBoundBps(null), null)
  // 86,09 % held against a 2 % lock: the part above it is said not locked; «bought more» only with more than one buy seen.
  assert.equal(
    creatorFreeLine({ creatorBps: 8609, bound: exact, creatorBuys: 3 }, uk),
    'Творець докупив після запуску — ця частина не заблокована',
  )
  assert.equal(
    creatorFreeLine({ creatorBps: 8609, bound: exact, creatorBuys: 1 }, uk),
    'Творець тримає більше, ніж заблоковано, — ця частина не заблокована',
  )
  assert.equal(creatorFreeLine({ creatorBps: 201, bound: exact, creatorBuys: 3 }, uk), null)
  assert.equal(creatorFreeLine({ creatorBps: null, bound: exact, creatorBuys: 3 }, uk), null)
  assert.equal(creatorFreeLine({ creatorBps: 8609, bound: null, creatorBuys: 3 }, uk), null)
})
