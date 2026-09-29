import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BUDGET_EDIT_PATH,
  cardById,
  deviceTimezone,
  inQuietHours,
  isValidQuietHours,
  lastCheckedAt,
  normalizeClock,
  noteLanguageMismatch,
  noteRefOfHref,
  noteWords,
  parseNoteRef,
  planForCard,
  quietHoursText,
  resolveNote,
  unreadCount,
  unreadNoteOfCard,
  issuerTarget,
} from './monitoring-model.ts'

const NOTE = 'inb_0123456789abcdef01234567'
const NOTE2 = 'inb_89abcdef0123456789abcdef'
const MON = 'mon_0123456789abcdef01234567'
const MON2 = 'mon_89abcdef0123456789abcdef'
const PAPER = 'mon_ffffffffffffffffffffffff'

const plan = (id, symbol, status = 'active') => ({ id, status, asset: { symbol } })

const card = (over = {}) => ({
  monitorId: MON,
  label: 'NVDAx',
  status: 'needs_attention',
  title: 'NVDAx is above your price bound',
  reason: 'The market is $228.82 per share; the bound is $216.60.',
  href: `/app/alerts/open?n=${NOTE}`,
  cta: 'Review plan',
  paper: false,
  lastCheckedAt: '2026-09-21T18:00:00.000Z',
  lastTriggeredAt: '2026-09-21T17:00:00.000Z',
  ...over,
})

const note = (over = {}) => ({
  id: NOTE,
  monitorId: MON,
  title: 'NVDAx is above your price bound',
  reason: 'The market is $228.82 per share; the bound is $216.60.',
  context: 'NVDAx',
  href: `/app/alerts/open?n=${NOTE}`,
  cta: 'Review plan',
  paper: false,
  unread: true,
  createdAt: '2026-09-21T17:00:00.000Z',
  locale: 'en',
  ...over,
})

const surface = (over = {}) => ({
  attention: [card()],
  watching: [
    card({
      monitorId: MON2,
      label: 'AAPLx',
      status: 'watching',
      title: 'Watching',
      reason: '',
      href: `/app/alerts/open?n=${MON2}`,
    }),
  ],
  recent: [note()],
  unread: 1,
  preferences: { telegram: true, push: true, quietHours: null },
  ...over,
})

test('a deep link names a note or a monitor, and nothing else', () => {
  assert.deepEqual(parseNoteRef(NOTE), { kind: 'note', id: NOTE })
  assert.deepEqual(parseNoteRef(MON), { kind: 'monitor', id: MON })
  assert.equal(parseNoteRef('inb_short'), null)
  assert.equal(parseNoteRef(`${NOTE}; drop table`), null)
  assert.equal(parseNoteRef(undefined), null)
  assert.deepEqual(noteRefOfHref(`/app/alerts/open?n=${NOTE}`), { kind: 'note', id: NOTE })
  assert.deepEqual(noteRefOfHref(`https://ryntra.io/app/alerts/open?from=x&n=${MON}`), { kind: 'monitor', id: MON })
  assert.equal(noteRefOfHref('/app/strategies/plans/plan_1'), null)
})

test('one plan on the symbol is the exact plan; the card never opens a plan by guess', () => {
  const plans = [plan('plan_a', 'NVDAx'), plan('plan_b', 'AAPLx')]
  assert.deepEqual(planForCard(card(), plans), { kind: 'plan', planId: 'plan_a', symbol: 'NVDAx' })
})

test('two active plans on one symbol ask the person to choose — the phone does not pick', () => {
  const plans = [plan('plan_a', 'NVDAx'), plan('plan_b', 'NVDAx'), plan('plan_c', 'NVDAx', 'draft')]
  assert.deepEqual(planForCard(card(), plans), { kind: 'choose', symbol: 'NVDAx', planIds: ['plan_a', 'plan_b'] })
})

test('a card that is not paused prefers the active plan over a draft or a closed one on the same symbol', () => {
  const plans = [plan('plan_a', 'NVDAx', 'draft'), plan('plan_b', 'NVDAx'), plan('plan_c', 'NVDAx', 'cancelled')]
  assert.deepEqual(planForCard(card(), plans), { kind: 'plan', planId: 'plan_b', symbol: 'NVDAx' })
  // A paused card watches a plan that is not active.
  assert.deepEqual(
    planForCard(card({ status: 'paused' }), [plan('plan_a', 'NVDAx', 'draft'), plan('plan_b', 'NVDAx')]),
    {
      kind: 'plan',
      planId: 'plan_a',
      symbol: 'NVDAx',
    },
  )
})

test('a card whose plan is gone says so; a paper card opens on the web', () => {
  assert.deepEqual(planForCard(card(), [plan('plan_b', 'AAPLx')]), { kind: 'gone', symbol: 'NVDAx' })
  assert.deepEqual(planForCard(card({ monitorId: PAPER, paper: true, label: 'Will X happen?' }), []), {
    kind: 'web',
    href: `https://ryntra.io/app/alerts/open?n=${PAPER}`,
  })
})

test('a note resolves through its monitor to the exact plan and carries the note to mark read', () => {
  const plans = [plan('plan_a', 'NVDAx'), plan('plan_b', 'AAPLx')]
  const resolved = resolveNote({ kind: 'note', id: NOTE }, surface(), plans)
  assert.deepEqual(resolved.target, { kind: 'plan', planId: 'plan_a', symbol: 'NVDAx' })
  assert.equal(resolved.note?.id, NOTE)
  assert.equal(resolved.card?.monitorId, MON)
  const byMonitor = resolveNote({ kind: 'monitor', id: MON2 }, surface(), plans)
  assert.deepEqual(byMonitor.target, { kind: 'plan', planId: 'plan_b', symbol: 'AAPLx' })
  assert.equal(byMonitor.note, null)
})

test("a note that is not in this wallet's inbox is unknown — another wallet's note never resolves", () => {
  const resolved = resolveNote({ kind: 'note', id: NOTE2 }, surface(), [plan('plan_a', 'NVDAx')])
  assert.deepEqual(resolved.target, { kind: 'unknown' })
  assert.equal(resolved.note, null)
  assert.deepEqual(resolveNote({ kind: 'monitor', id: PAPER }, surface(), []).target, { kind: 'unknown' })
})

test('a note whose monitor left the surface still finds its plan by the label it was written for', () => {
  const orphan = surface({ attention: [], watching: [] })
  assert.deepEqual(resolveNote({ kind: 'note', id: NOTE }, orphan, [plan('plan_a', 'NVDAx')]).target, {
    kind: 'plan',
    planId: 'plan_a',
    symbol: 'NVDAx',
  })
  assert.deepEqual(resolveNote({ kind: 'note', id: NOTE }, orphan, []).target, { kind: 'gone', symbol: 'NVDAx' })
})

test("the unread count is the server's, and the card's note is the one its href opens", () => {
  assert.equal(unreadCount(surface()), 1)
  assert.equal(unreadCount(surface({ unread: 3 })), 3)
  assert.equal(unreadCount(surface({ unread: undefined })), 1)
  assert.equal(unreadCount(null), 0)
  assert.equal(unreadNoteOfCard(card(), surface())?.id, NOTE)
  assert.equal(unreadNoteOfCard(card(), surface({ recent: [note({ unread: false })] })), null)
  assert.equal(unreadNoteOfCard(card({ href: `/app/alerts/open?n=${MON}` }), surface()), null)
  assert.equal(cardById(surface(), MON2)?.label, 'AAPLx')
  assert.equal(lastCheckedAt(surface()), '2026-09-21T18:00:00.000Z')
  assert.equal(lastCheckedAt(surface({ attention: [], watching: [] })), null)
})

test("quiet hours follow the contract's rule and the server's clock", () => {
  assert.equal(isValidQuietHours({ start: '22:00', end: '07:00', timezone: 'Europe/Kyiv' }), true)
  assert.equal(isValidQuietHours({ start: '25:00', end: '07:00', timezone: 'Europe/Kyiv' }), false)
  assert.equal(isValidQuietHours({ start: '22:00', end: '07:00', timezone: '' }), false)
  assert.equal(isValidQuietHours(null), false)
  assert.equal(normalizeClock('9:5'), '09:05')
  assert.equal(normalizeClock('22.30'), '22:30')
  assert.equal(normalizeClock('2230'), '22:30')
  assert.equal(normalizeClock('25:00'), '25:00')
  assert.equal(quietHoursText({ start: '22:00', end: '07:00', timezone: 'UTC' }), '22:00–07:00')
  assert.equal(quietHoursText(null), null)
  const hours = { start: '22:00', end: '07:00', timezone: 'UTC' }
  assert.equal(inQuietHours(Date.parse('2026-09-21T23:30:00.000Z'), hours), true)
  assert.equal(inQuietHours(Date.parse('2026-09-21T06:59:00.000Z'), hours), true)
  assert.equal(inQuietHours(Date.parse('2026-09-21T07:00:00.000Z'), hours), false)
  assert.equal(inQuietHours(Date.parse('2026-09-21T12:00:00.000Z'), hours), false)
  assert.equal(inQuietHours(Date.parse('2026-09-21T12:00:00.000Z'), { ...hours, start: '10:00', end: '10:00' }), false)
  assert.equal(inQuietHours(Date.parse('2026-09-21T12:00:00.000Z'), null), false)
  assert.equal(
    deviceTimezone(() => 'Europe/Kyiv'),
    'Europe/Kyiv',
  )
  assert.equal(
    deviceTimezone(() => undefined),
    'UTC',
  )
  assert.equal(
    deviceTimezone(() => {
      throw new Error('no Intl')
    }),
    'UTC',
  )
})

test("a note's language is compared with the screen's, never translated", () => {
  assert.equal(noteLanguageMismatch(note({ locale: 'en' }), 'uk'), true)
  assert.equal(noteLanguageMismatch(note({ locale: 'uk' }), 'uk'), false)
  assert.equal(noteLanguageMismatch(note({ locale: undefined }), 'uk'), false)
})

/* ---- «Автоінвест» notes (M16, contract 1.12.0–1.13.0) ---- */

const RULE = 'rule_5e1f0c2a9b8d4e7f6a3c1b0d9e8f7a6b'
const RULE_NOTE = 'inb_aaaaaaaaaaaaaaaaaaaaaaaa'
const BUDGET_NOTE = 'inb_bbbbbbbbbbbbbbbbbbbbbbbb'

/** A reminder as the tick writes it: a `mon_` id no monitor has, the company's name as its label, both languages. */
const reminder = (over = {}) =>
  note({
    id: RULE_NOTE,
    monitorId: 'mon_5e1f0c2a9b8d4e7f6a3c1b0d',
    triggerId: `autoinvest:${RULE}:2026-09-24T16:00:00.000Z@NVDAx`,
    title: 'Час твоєї покупки: $25 в NVIDIA',
    reason: 'Щотижня · чт о 19:00. Один дотик — свіжа «Перевірка», купує лише твій підпис.',
    context: 'NVIDIA',
    href: `/app/alerts/open?n=${RULE_NOTE}`,
    cta: 'Купити $25',
    locale: 'uk',
    subject: { kind: 'autoinvest-rule', id: RULE },
    text: {
      en: {
        title: 'Time for your purchase: $25 of NVIDIA',
        reason: 'Every week · Thu at 19:00. One tap opens a fresh Review — only your signature buys.',
      },
      uk: {
        title: 'Час твоєї покупки: $25 в NVIDIA',
        reason: 'Щотижня · чт о 19:00. Один дотик — свіжа «Перевірка», купує лише твій підпис.',
      },
    },
    ...over,
  })

test('a rule’s reminder leads to its company’s purchase under the rule — never to a plan that shares a name', () => {
  // A plan on a symbol the reminder's label could be mistaken for: the reminder still names its rule.
  const plans = [plan('plan_nvidia', 'NVIDIA'), plan('plan_nvdax', 'NVDAx')]
  const resolved = resolveNote({ kind: 'note', id: RULE_NOTE }, surface({ recent: [reminder()] }), plans)
  assert.deepEqual(resolved.target, {
    kind: 'rule',
    ruleId: RULE,
    dueAt: '2026-09-24T16:00:00.000Z',
    symbol: 'NVDAx',
  })
  assert.equal(resolved.note?.id, RULE_NOTE)
  // A reminder whose identity is unreadable still names its rule; a subject that is not a rule id leads nowhere.
  assert.deepEqual(
    resolveNote({ kind: 'note', id: RULE_NOTE }, surface({ recent: [reminder({ triggerId: 'x' })] }), plans).target,
    {
      kind: 'rule',
      ruleId: RULE,
      dueAt: null,
      symbol: null,
    },
  )
  assert.deepEqual(
    resolveNote(
      { kind: 'note', id: RULE_NOTE },
      surface({ recent: [reminder({ subject: { kind: 'autoinvest-rule', id: 'rule_bad' } })] }),
      plans,
    ).target,
    { kind: 'unknown' },
  )
})

test('the month’s budget, spent, opens Home with the budget’s sheet — on the phone, as the web’s own link does', () => {
  const spent = note({
    id: BUDGET_NOTE,
    monitorId: 'mon_0f0f0f0f0f0f0f0f0f0f0f0f',
    triggerId: 'autoinvest-budget:36C2y1TLdGEBjwEKaCF2MBeR9Xw9oanY6So3UyiE1SPm:2026-09:10000',
    title: 'Бюджет місяця вичерпано',
    context: 'Автоінвест',
    subject: { kind: 'autoinvest-budget', id: 'budget:2026-09' },
  })
  const resolved = resolveNote({ kind: 'note', id: BUDGET_NOTE }, surface({ recent: [spent] }), [])
  assert.deepEqual(resolved.target, { kind: 'budget' })
  assert.equal(resolved.note?.id, BUDGET_NOTE, 'the note is carried, so opening it marks it read')
  assert.equal(BUDGET_EDIT_PATH, '/(tabs)?budget=edit')
  assert.equal(
    resolveNote({ kind: 'note', id: NOTE }, surface(), [plan('plan_a', 'NVDAx')]).target.kind,
    'plan',
    'a plan’s note is unchanged',
  )
})

test('a note is read in the reader’s language when the server keeps both; otherwise as written, and said so', () => {
  assert.deepEqual(noteWords(reminder(), 'en'), {
    title: 'Time for your purchase: $25 of NVIDIA',
    reason: 'Every week · Thu at 19:00. One tap opens a fresh Review — only your signature buys.',
    foreign: false,
  })
  assert.equal(noteWords(reminder(), 'uk').title, 'Час твоєї покупки: $25 в NVIDIA')
  assert.deepEqual(noteWords(note({ locale: 'en' }), 'uk'), {
    title: 'NVDAx is above your price bound',
    reason: 'The market is $228.82 per share; the bound is $216.60.',
    foreign: true,
  })
})

test('an issuer’s event note opens the token it names, with the swap’s sheet — never a plan, and unknown without a token', () => {
  const SPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'
  const EVENT_NOTE = 'inb_eeeeeeeeeeeeeeeeeeeeeeee'
  const event = note({
    id: EVENT_NOTE,
    monitorId: 'mon_111111111111111111111111',
    triggerId: `issuer-event:${SPACEX}:event@36C2y1TLdGEBjwEKaCF2MBeR9Xw9oanY6So3UyiE1SPm`,
    title: 'SpaceX вийшла на біржу',
    reason: 'Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.',
    context: 'SpaceX',
    cta: 'Обміняти на SpaceX (SPCXx)',
    subject: { kind: 'issuer-event', id: SPACEX },
  })
  assert.deepEqual(issuerTarget(event), { kind: 'issuer', mint: SPACEX })
  const resolved = resolveNote({ kind: 'note', id: EVENT_NOTE }, surface({ recent: [event] }), [
    plan('plan_a', 'SpaceX'),
  ])
  assert.deepEqual(resolved.target, { kind: 'issuer', mint: SPACEX })
  assert.equal(resolved.note?.id, EVENT_NOTE, 'the note is carried, so opening it marks it read')
  assert.deepEqual(issuerTarget(note({ subject: { kind: 'issuer-event', id: 'not a mint' } })), { kind: 'unknown' })
  assert.equal(issuerTarget(note()), null, 'a plan’s note is not an issuer’s')
})
