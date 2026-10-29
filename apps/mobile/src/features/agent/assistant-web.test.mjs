import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ApiError } from '../../lib/api.ts'
import { mapDeepLink } from '../monitoring/deep-link.ts'
import { assistantTarget, briefTarget, latestWalletNote } from '../monitoring/monitoring-model.ts'
import {
  agentFailureOf,
  budgetView,
  shownPrice,
  EMPTY_GUEST_THREAD,
  guestContextOf,
  guestMeterView,
  isAnswerCard,
  laterMeter,
  rynTurnView,
  withGuestExchange,
} from './agent-model.ts'
import { AGENT_COPY } from './copy.ts'
import {
  briefMomentInZone,
  clockOf,
  recordingCredits,
  recordingId,
  recordingKept,
  recordingProblemOf,
  speechLanguage,
  withSpokenWords,
} from './voice.ts'

/* ST-8 «Помічник у телефоні працює, як у вебі»: the guest, the credits the phone spends, the cards, the brief's note. */

const here = dirname(fileURLToPath(import.meta.url))
const SOL = 'So11111111111111111111111111111111111111112'

const budget = {
  unit: 'calls',
  day: { used: 3, allowance: 200, resetsAt: '2026-10-21T00:00:00.000Z' },
  month: { used: 3, allowance: 3000, resetsAt: '2026-11-01T00:00:00.000Z' },
  inFlight: { used: 0, limit: 2 },
  exhausted: false,
  reason: null,
  model: 'configured',
}
const credits = (left) => ({
  unit: 'credits',
  balance: 0,
  welcome: 0,
  bought: 0,
  free: { used: 20 - left, left, daily: 20, resetsAt: '2026-10-21T00:00:00.000Z' },
  reserved: 0,
  dailySpend: { used: 0, cap: 2000, resetsAt: '2026-10-21T00:00:00.000Z' },
  prices: { question: 2, alertExplain: 2, tokenReport: 10, priceMove: 2, voice: 2, deep: 60, plan: 5 },
  welcomeOffer: 'open',
  holder: 'wallet',
})

test('with credits (1.52.0) the line says the next question’s price — free, then from the balance, never unshown', () => {
  assert.deepEqual(budgetView({ ...budget, credits: credits(20) }), { kind: 'free', left: 10 })
  assert.deepEqual(budgetView({ ...budget, credits: credits(3) }), { kind: 'free', left: 1 })
  assert.equal(shownPrice({ ...budget, credits: credits(3) }), 0)
  // Past the free ones the balance pays — whole, or the rest beside the last free credit — and that price is sent.
  const rich = { ...credits(1), balance: 5000, bought: 5000 }
  assert.deepEqual(budgetView({ ...budget, credits: rich }), { kind: 'balance', price: 2, free: 1, rest: 1, balance: 5000 })
  assert.deepEqual(budgetView({ ...budget, credits: { ...rich, free: { ...rich.free, left: 0 } } }), {
    kind: 'balance',
    price: 2,
    free: 0,
    rest: 2,
    balance: 5000,
  })
  assert.equal(shownPrice({ ...budget, credits: rich }), 2)
  // Short of the balance: from the reads until the free ones come back, and nothing of the balance is sent.
  assert.deepEqual(budgetView({ ...budget, credits: credits(0) }), { kind: 'freeSpent', resetsAt: '2026-10-21T00:00:00.000Z' })
  assert.equal(shownPrice({ ...budget, credits: credits(0) }), 0)
  // The day's ceiling of credits reached: said with its own reset.
  const capped = { ...rich, free: { ...rich.free, left: 0 }, dailySpend: { used: 1999, cap: 2000, resetsAt: '2026-10-21T00:00:00.000Z' } }
  assert.deepEqual(budgetView({ ...budget, credits: capped }), { kind: 'dayCap', resetsAt: '2026-10-21T00:00:00.000Z' })
  assert.equal(shownPrice({ ...budget, credits: capped }), 0)
  // The safety cap and an absent model still say what they said.
  assert.deepEqual(budgetView({ ...budget, credits: credits(20), model: 'absent' }), { kind: 'reads' })
  // The free credits spent read as `exhausted` on the server: the phone says the free ones are used up, not «short answers».
  assert.equal(budgetView({ ...budget, credits: credits(0), exhausted: true }).kind, 'freeSpent')
  // The wallet's safety cap reached: said as before.
  assert.equal(budgetView({ ...budget, credits: credits(20), exhausted: true, day: { ...budget.day, used: 200 } }).kind, 'spent')
  // Without credits (switched off) the calls' allowance as before, and no price is sent.
  assert.deepEqual(budgetView(budget), { kind: 'open', left: 197, allowance: 200 })
  assert.equal(shownPrice(budget), undefined)
})

test('a guest asks about an asset or a page only — never someone’s own plan, portfolio or note', () => {
  assert.deepEqual(guestContextOf({ kind: 'asset', mint: SOL, symbol: 'SOL' }), { kind: 'asset', mint: SOL, symbol: 'SOL' })
  assert.deepEqual(guestContextOf({ kind: 'asset', mint: SOL }), { kind: 'asset', mint: SOL })
  assert.deepEqual(guestContextOf({ kind: 'page', page: 'trends' }), { kind: 'page', page: 'trends' })
  assert.equal(guestContextOf({ kind: 'portfolio' }), null)
  assert.equal(guestContextOf({ kind: 'plan', planId: 'plan_0123456789abcdef0123456789abcdef' }), null)
  assert.equal(guestContextOf({ kind: 'note', inboxId: 'inb_0123' }), null)
  assert.equal(guestContextOf(null), null)
})

const guestTurn = (id, role, text) => ({
  id,
  role,
  at: '2026-10-20T13:04:06.907Z',
  text,
  class: 'market',
  answer: null,
  cards: [],
  citations: [],
  handoffs: [],
  tools: [],
  composedBy: null,
  refusal: null,
  brief: null,
  critic: null,
})

test('the guest’s thread on the phone: each exchange once, the meter as the last answer carried it', () => {
  const answered = (n, used) => ({
    person: guestTurn(`agt_p${n}`, 'person', `q${n}`),
    ryn: guestTurn(`agt_r${n}`, 'ryn', `a${n}`),
    guest: { day: { used, allowance: 5, resetsAt: '2026-10-21T00:00:00.000Z' }, model: 'configured', needsWallet: false },
  })
  assert.deepEqual(guestMeterView(EMPTY_GUEST_THREAD), { kind: 'note' })
  let thread = withGuestExchange(EMPTY_GUEST_THREAD, answered(1, 1))
  thread = withGuestExchange(thread, answered(1, 1))
  assert.equal(thread.turns.length, 2)
  const before = Date.parse('2026-10-20T20:00:00.000Z')
  assert.deepEqual(guestMeterView(thread, before), { kind: 'open', used: 1, allowance: 5 })
  thread = withGuestExchange(thread, answered(2, 5))
  assert.equal(thread.turns.length, 4)
  assert.deepEqual(guestMeterView(thread, before), { kind: 'spent' })
  assert.deepEqual(guestMeterView({ ...thread, model: 'absent' }, before), { kind: 'reads' })
  // One meter per guest and day: past its reset nothing is said until the next answer reads it again.
  assert.deepEqual(guestMeterView(thread, Date.parse('2026-10-21T00:00:01.000Z')), { kind: 'note' })
})

test('six questions a minute: a guest’s RATE_LIMITED is said as such, not as a failure of Ryntra', () => {
  assert.equal(agentFailureOf(new ApiError('RATE_LIMITED', 'slow down', 429)), 'rate')
  assert.ok(AGENT_COPY.en.failure.rate.length > 0 && AGENT_COPY.uk.failure.rate.length > 0)
})

test('news and «Що зрушило ціну?» are the answer itself; the answer opens in its two titled blocks', () => {
  assert.equal(isAnswerCard({ kind: 'move', mint: SOL, symbol: 'SOL', window: '24h', change: null, rows: [] }), true)
  assert.equal(
    isAnswerCard({ kind: 'news', mint: null, symbol: null, items: [], day: { stories: 0, sources: 0 }, collectedAt: '', state: 'current' }),
    true,
  )
  assert.equal(isAnswerCard({ kind: 'comparison', title: '', columns: [], rows: [], note: '', href: null }), false)
  const view = rynTurnView({
    ...guestTurn('agt_r', 'ryn', 'About SOL'),
    answer: {
      observation: [{ text: 'Price $104.24.', cites: [] }],
      meaning: [{ text: 'Sells ahead by count.', cites: [] }],
      counter: [],
      risks: [],
      checks: [],
      actions: [],
      insufficient: false,
    },
  })
  assert.deepEqual(view.observation.map((sentence) => sentence.text), ['Price $104.24.'])
  assert.deepEqual(view.meaning.map((sentence) => sentence.text), ['Sells ahead by count.'])
  assert.equal(view.lead.length, 2)
})

test('the move’s marks and the brief’s marks are named in both languages', () => {
  for (const locale of ['en', 'uk']) {
    for (const mark of ['fact', 'unverified', 'inference', 'unknown']) assert.ok(AGENT_COPY[locale].mark[mark])
  }
  assert.equal(AGENT_COPY.uk.newsDay(3, 1), '3 історії · 1 джерело за 24 год')
  assert.equal(AGENT_COPY.uk.newsDay(5, 12), '5 історій · 12 джерел за 24 год')
  assert.equal(AGENT_COPY.uk.freeLeft(10), 'Сьогодні безкоштовно: 10 питань з моделлю')
  assert.equal(AGENT_COPY.uk.freeLeft(2), 'Сьогодні безкоштовно: 2 питання з моделлю')
  assert.equal(AGENT_COPY.uk.explainAsk('SOL'), 'Що зрушило ціну SOL?')
})

test('voice is input only: the heard words join the composer, to be read and edited', () => {
  assert.equal(withSpokenWords('', '  що зрушило   ціну SOL ', 2000), 'що зрушило ціну SOL')
  assert.equal(withSpokenWords('Порівняй JUP ', 'і WIF', 2000), 'Порівняй JUP і WIF')
  assert.equal(withSpokenWords('abc', '', 2000), 'abc')
  assert.equal(withSpokenWords('abc', 'defgh', 6), 'abc de')
})

test('the microphone is Android’s own speech to text first; the recording asks for the microphone only on a press', () => {
  const manifest = readFileSync(join(here, '../../../modules/ryntra-speech/android/src/main/AndroidManifest.xml'), 'utf8')
  // One permission, the microphone's, for the paid fallback's recording — and nothing else.
  assert.deepEqual(
    [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((match) => match[1]),
    ['android.permission.RECORD_AUDIO'],
  )
  assert.match(manifest, /android\.speech\.action\.RECOGNIZE_SPEECH/)
  const module = readFileSync(
    join(here, '../../../modules/ryntra-speech/android/src/main/java/io/ryntra/speech/RyntraSpeechModule.kt'),
    'utf8',
  )
  assert.match(module, /RecognizerIntent\.ACTION_RECOGNIZE_SPEECH/)
  // No listening in the background: the system's screen, or a recording the person started and stops.
  assert.doesNotMatch(module, /SpeechRecognizer|AudioRecord\b/)
  assert.match(module, /MediaRecorder\.AudioEncoder\.AAC/)
  // Two minutes at most: the recorder stops writing by itself there, and the file it wrote is still read.
  assert.match(module, /setMaxDuration\(MAX_SECONDS \* 1_000\)/)
  assert.match(module, /MEDIA_RECORDER_INFO_MAX_DURATION_REACHED/)
  // The recording's file is deleted once its bytes are read or it is let go.
  assert.match(module, /file\.delete\(\)/)
  const bridge = readFileSync(join(here, '../../../modules/ryntra-speech/index.ts'), 'utf8')
  // The permission is asked inside the start of a recording — a press — never when the screen opens.
  const start = bridge.slice(bridge.indexOf('export async function startRecording'))
  assert.match(start.slice(0, start.indexOf('\n}\n')), /PermissionsAndroid\.request\(PermissionsAndroid\.PERMISSIONS\.RECORD_AUDIO\)/)
  assert.equal((bridge.match(/PermissionsAndroid\.request/g) ?? []).length, 1)
})

test('a morning brief’s note and link open the brief on the phone (1.46.0)', () => {
  const note = (subject) => ({
    id: 'inb_1',
    monitorId: 'mon_1',
    title: 'Ранковий огляд · 18 жовтня',
    reason: '…',
    context: 'Ryntra',
    href: 'https://ryntra.io/app/ryn?brief=2026-10-18',
    cta: 'Відкрити огляд',
    paper: false,
    unread: true,
    createdAt: '2026-10-18T06:00:00.000Z',
    subject,
  })
  assert.deepEqual(briefTarget(note({ kind: 'assistant-brief', id: '2026-10-18' })), { kind: 'brief', day: '2026-10-18' })
  assert.deepEqual(briefTarget(note({ kind: 'assistant-brief', id: 'tomorrow' })), { kind: 'unknown' })
  assert.equal(briefTarget(note({ kind: 'trading-plan', id: 'plan_x' })), null)
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?brief=2026-10-18'), { path: '/ryn?brief=2026-10-18', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?brief=nope'), { path: '/ryn', kind: 'native' })
})

test('the next brief is said in the brief’s own zone, as the person chose it — never in the phone’s', () => {
  // 06:00 UTC is 09:00 in Kyiv; at 02:30 Kyiv time on the 21st that is «today at 09:00».
  const now = Date.parse('2026-10-20T23:30:00Z')
  assert.deepEqual(briefMomentInZone('2026-10-21T06:00:00Z', 'Europe/Kyiv', now), { day: 'today', time: '09:00' })
  assert.deepEqual(briefMomentInZone('2026-10-22T06:00:00Z', 'Europe/Kyiv', now), { day: 'tomorrow', time: '09:00' })
  assert.deepEqual(briefMomentInZone('2026-10-25T06:00:00Z', 'Europe/Kyiv', now), { day: '2026-10-25', time: '08:00' })
  assert.equal(briefMomentInZone(null, 'Europe/Kyiv', now), null)
  assert.equal(AGENT_COPY.uk.briefNext(AGENT_COPY.uk.briefWhen(AGENT_COPY.uk.briefToday, '09:00')), 'Наступний сьогодні о 09:00')
})

test('the guest meter never goes back when answers come out of order', () => {
  const answered = (used, resetsAt) => ({ guest: { day: { used, allowance: 5, resetsAt }, model: 'configured', needsWallet: false } })
  const day = '2026-10-22T00:00:00.000Z'
  let meter = laterMeter(undefined, answered(5, day))
  meter = laterMeter(meter, answered(4, day))
  assert.equal(meter.day.used, 5)
  meter = laterMeter(meter, answered(1, '2026-10-23T00:00:00.000Z'))
  assert.equal(meter.day.used, 1)
})

test('voice on the server (AI-08): the language the person speaks, the price per started 30 s, its refusals', () => {
  assert.equal(speechLanguage('en', 'uk-UA', null), 'uk')
  assert.equal(speechLanguage('en', 'en-US', null), 'en')
  assert.equal(speechLanguage('uk', 'en-US', null), 'uk')
  assert.equal(speechLanguage('uk', 'uk-UA', 'en'), 'en')
  assert.equal(recordingCredits(1, 2), 2)
  assert.equal(recordingCredits(30, 2), 2)
  assert.equal(recordingCredits(31, 2), 4)
  assert.equal(recordingCredits(120, 2), 8)
  assert.equal(clockOf(7), '0:07')
  assert.equal(clockOf(90), '1:30')
  assert.equal(recordingProblemOf('VOICE_PRICE_NOT_SHOWN'), 'priceChanged')
  assert.equal(recordingProblemOf('AGENT_BUDGET_EXHAUSTED'), 'noCredits')
  assert.equal(recordingProblemOf(undefined), 'failed')
  assert.equal(recordingKept('priceChanged'), true)
  assert.equal(recordingKept('noCredits'), false)
  const id = recordingId((bytes) => bytes.fill(0xab))
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('the assistant’s notes and links open their own places on the phone (AI-13): a watch, a task, a plan, a followed wallet', () => {
  const WATCH = 'wch_0123456789abcdef01234567'
  const TASK = 't_0123456789ab'
  const WALLET = 'So11111111111111111111111111111111111111112'
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/ryn?watch=${WATCH}`), { path: `/ryn?watch=${WATCH}`, kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?watch=all'), { path: '/ryn?watch=all', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?watch=nope'), { path: '/ryn', kind: 'native' })
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/ryn?task=${TASK}`), { path: `/ryn?task=${TASK}`, kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?brief=latest'), { path: '/ryn?brief=latest', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?tab=credits'), { path: '/ryn?tab=credits', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn/plans/apl_123'), { path: '/ryn-plan/apl_123', kind: 'native' })
  assert.deepEqual(mapDeepLink('/ryn-plan/apl_123'), { path: '/ryn-plan/apl_123', kind: 'native' })
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/markets?tab=wallets&wallet=${WALLET}`), {
    path: `/monitoring/open?wallet=${WALLET}`,
    kind: 'native',
  })
  const note = (kind, id) => ({
    id: 'inb_0123456789abcdef01234567',
    monitorId: 'mon_1',
    title: 'T',
    reason: 'R',
    context: 'Ryntra',
    href: '/app/alerts/open?n=inb_0123456789abcdef01234567',
    cta: 'Open',
    paper: false,
    unread: true,
    createdAt: '2026-10-22T10:00:00.000Z',
    subject: { kind, id },
  })
  assert.deepEqual(assistantTarget(note('token-watch', WATCH)), { kind: 'watch', watchId: WATCH })
  assert.deepEqual(assistantTarget(note('assistant-task', TASK)), { kind: 'task', taskId: TASK })
  assert.deepEqual(assistantTarget(note('wallet-watch', WALLET)), { kind: 'walletWatch', wallet: WALLET })
  assert.deepEqual(assistantTarget(note('token-watch', 'bad')), { kind: 'unknown' })
  assert.equal(assistantTarget(note('limit-order', WALLET)), null)
  const older = { ...note('wallet-watch', WALLET), id: 'inb_a', createdAt: '2026-10-21T10:00:00.000Z' }
  const surface = { attention: [], watching: [], recent: [older, note('wallet-watch', WALLET)], unread: 1 }
  assert.equal(latestWalletNote(surface, WALLET)?.id, 'inb_0123456789abcdef01234567')
  assert.equal(latestWalletNote(surface, 'other'), null)
})

test('the Lens is the phone’s own place: a link to it opens it', () => {
  const SOL = 'So11111111111111111111111111111111111111112'
  assert.deepEqual(mapDeepLink(`/lens?context=asset%3A${SOL}%3ASOL`), {
    path: `/lens?context=asset%3A${SOL}%3ASOL`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?order=ord_1'), { path: '/ryn?order=ord_1', kind: 'native' })
})

test('the next question’s price is never hidden by the voice’s line (ST-13 critic r2)', () => {
  const composer = readFileSync(join(here, '../../screens/agent/composer.tsx'), 'utf8')
  assert.doesNotMatch(composer, /line \?\? footLine/)
  assert.match(composer, /\{footLine \?\? ''\}/)
})
