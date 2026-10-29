import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import { creditsText } from './credits-model.ts'
import {
  askOf,
  createTaskBody,
  DAILY_TIMES,
  fittingEvery,
  focusedTask,
  ownZone,
  pauseBody,
  readTasksAgainAfter,
  resumeBody,
  rhythmFits,
  someRhythmOff,
  taskFailureOf,
  tasksFull,
  tasksOff,
  taskStatus,
} from './tasks-model.ts'
import { WATCH_COPY } from './watch-copy.ts'

const MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'

const read = (patch = {}) => ({
  tasks: [],
  limit: 5,
  pricePerRun: 2,
  rhythms: [
    { every: '10m', runsPerDay: 144, perDayCredits: 288, fits: false },
    { every: '30m', runsPerDay: 48, perDayCredits: 96, fits: true },
    { every: '1h', runsPerDay: 24, perDayCredits: 48, fits: true },
    { every: '1d', runsPerDay: 1, perDayCredits: 2, fits: true },
  ],
  runs: { used: 24, cap: 100 },
  ...patch,
})

const task = (patch = {}) => ({
  id: 't_1',
  ask: { kind: 'portfolio' },
  name: 'My portfolio',
  every: '1h',
  time: null,
  zone: 'Europe/Kyiv',
  rhythm: 'Every hour',
  onlyWhenNew: true,
  channels: { telegram: true, push: false },
  status: 'active',
  pausedBy: null,
  priceCredits: 2,
  perDayCredits: 48,
  nextRunAt: '2026-10-22T10:00:00.000Z',
  skippedAt: null,
  last: null,
  runs: 3,
  href: '/app/ryn?task=t_1',
  sessionId: null,
  version: 4,
  ...patch,
})

test('what a task asks, from the form', () => {
  assert.deepEqual(askOf('portfolio', '', null), { kind: 'portfolio' })
  assert.equal(askOf('question', ' hi ', null), null)
  assert.deepEqual(askOf('question', '  What moved SOL?  ', null), { kind: 'question', text: 'What moved SOL?' })
  assert.equal(askOf('question', 'x'.repeat(301), null), null)
  assert.equal(askOf('news', '', null), null)
  assert.deepEqual(askOf('news', '', { mint: MINT, symbol: 'JUP' }), { kind: 'news', mint: MINT, symbol: 'JUP' })
  assert.deepEqual(askOf('move', '', { mint: MINT, symbol: null }), { kind: 'move', mint: MINT, symbol: 'JUPy' })
  assert.equal(askOf('move', '', { mint: MINT, symbol: 'A'.repeat(30) }).symbol.length, 16)
})

test('a rhythm that does not fit the day’s runs cannot be picked; the first that fits is taken', () => {
  const answer = read()
  assert.equal(rhythmFits(answer, '10m'), false)
  assert.equal(rhythmFits(answer, '1h'), true)
  assert.equal(fittingEvery(answer, '10m'), '30m')
  assert.equal(fittingEvery(answer, '1d'), '1d')
  assert.equal(fittingEvery(null, '10m'), '10m')
  assert.equal(someRhythmOff(answer), true)
  assert.equal(tasksOff(read({ runs: { used: 0, cap: 0 } })), true)
  assert.equal(tasksFull(read({ tasks: Array.from({ length: 5 }, (_, i) => task({ id: `t_${i}` })) })), true)
  assert.equal(tasksFull(read()), false)
})

test('the new task’s request carries exactly the price shown; a daily one its time and zone', () => {
  const base = {
    ask: { kind: 'portfolio' },
    every: '1h',
    time: '09:00',
    zone: 'Europe/Kyiv',
    locale: 'uk',
    onlyWhenNew: true,
    channels: { telegram: false, push: true },
    shownPrice: 2,
  }
  assert.deepEqual(createTaskBody(base), {
    ask: { kind: 'portfolio' },
    every: '1h',
    zone: 'Europe/Kyiv',
    locale: 'uk',
    onlyWhenNew: true,
    channels: { telegram: false, push: true },
    acceptCredits: 2,
  })
  assert.equal(createTaskBody({ ...base, every: '1d', time: '07:30' }).time, '07:30')
  assert.equal(createTaskBody({ ...base, ask: null }), null)
  assert.equal(createTaskBody({ ...base, shownPrice: null }), null)
  assert.equal(createTaskBody({ ...base, shownPrice: 0 }).acceptCredits, 0)
})

test('pause is free by the version shown; resume carries the price of a run shown', () => {
  assert.deepEqual(pauseBody(task()), { ifVersion: 4, status: 'paused' })
  assert.deepEqual(resumeBody(task({ status: 'paused', pausedBy: 'credits' }), 3), {
    ifVersion: 4,
    status: 'active',
    acceptCredits: 3,
  })
})

test('a card says why it rests or when it runs next', () => {
  assert.deepEqual(taskStatus(task()), { kind: 'next', at: '2026-10-22T10:00:00.000Z' })
  assert.deepEqual(taskStatus(task({ nextRunAt: null })), { kind: 'none' })
  assert.deepEqual(taskStatus(task({ status: 'paused', pausedBy: 'person' })), { kind: 'paused' })
  assert.deepEqual(taskStatus(task({ status: 'paused', pausedBy: 'credits' })), { kind: 'pausedCredits' })
  assert.deepEqual(taskStatus(task({ status: 'paused', pausedBy: 'price' })), { kind: 'pausedPrice' })
})

test('the price line in both languages, credits counted as a person reads them', () => {
  assert.equal(WATCH_COPY.uk.taskPrice(2, 48), 'До 2 кредитів за запуск · до 48 кредитів на добу')
  assert.equal(WATCH_COPY.uk.taskPrice(1, 21), 'До 1 кредиту за запуск · до 21 кредиту на добу')
  assert.equal(WATCH_COPY.en.taskPrice(1, 24), 'Up to 1 credit a run · up to 24 credits a day')
  assert.equal(WATCH_COPY.uk.taskResumeAt(creditsText(3, 'uk')), 'Продовжити за 3 кредити')
  assert.equal(WATCH_COPY.uk.taskPriceBefore(2, 48), 'Один запуск — до 2 кредитів; доба так — до 48 кредитів.')
  assert.equal(WATCH_COPY.uk.taskPriceNow(null), 'Запуск зараз — —')
  assert.equal(WATCH_COPY.uk.taskEvery['1h'], 'Щогодини')
  assert.equal(WATCH_COPY.uk.taskOnlyNew, 'Лише коли є що нового')
})

test('the daily times and the device’s zone', () => {
  assert.equal(DAILY_TIMES.length, 48)
  assert.equal(DAILY_TIMES[0], '00:00')
  assert.equal(DAILY_TIMES[19], '09:30')
  assert.equal(DAILY_TIMES.at(-1), '23:30')
  assert.ok(ownZone().length > 0)
})

test('every refusal has its own line; a changed price or task is read again', () => {
  assert.equal(taskFailureOf(new ApiError('TASK_LIMIT_REACHED', 'five', 409)), 'limit')
  assert.equal(taskFailureOf(new ApiError('TASK_RUNS_CAP', 'cap', 409)), 'runsCap')
  assert.equal(taskFailureOf(new ApiError('TASK_PRICE_NOT_SHOWN', 'price', 409)), 'priceChanged')
  assert.equal(taskFailureOf(new ApiError('TASK_VERSION_CONFLICT', 'version', 409)), 'changed')
  assert.equal(taskFailureOf(new ApiError('TASK_NOT_FOUND', 'gone', 404)), 'gone')
  assert.equal(taskFailureOf(new ApiError('VALIDATION_ERROR', 'bad', 400)), 'invalid')
  assert.equal(taskFailureOf(new ApiError('RATE_LIMITED', 'slow', 429)), 'failed')
  assert.equal(taskFailureOf(new Error('offline')), 'network')
  assert.equal(readTasksAgainAfter('priceChanged'), true)
  assert.equal(readTasksAgainAfter('network'), false)
  for (const locale of ['en', 'uk']) {
    const words = WATCH_COPY[locale].taskFailure
    assert.ok(words.limit(5).includes('5'))
    for (const key of ['runsCap', 'priceChanged', 'changed', 'gone', 'invalid', 'network', 'signIn', 'failed'])
      assert.ok(words[key].length > 0)
  }
})

test('a note’s task is in view only while this wallet has it', () => {
  const tasks = [task()]
  assert.equal(focusedTask('t_1', tasks), 't_1')
  assert.equal(focusedTask('t_9', tasks), null)
  assert.equal(focusedTask('wch_1', tasks), null)
  assert.equal(focusedTask(null, tasks), null)
})
