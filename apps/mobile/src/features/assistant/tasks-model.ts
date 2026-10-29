/**
 * «Доручення» as values — pure (1.59.0). A task is a question Ryntra asks itself on a schedule; each run is paid at
 * the price of one question, shown before «Увімкнути» and sent back exactly as shown (`acceptCredits`). This module
 * builds the request from the form, says what a card's status line is, which rhythm can be picked, and names a
 * refusal in the app's terms. Nothing here reads the network, signs or spends.
 */

import { ApiError } from '../../lib/api.ts'
import type {
  AssistantTask,
  AssistantTaskAsk,
  AssistantTaskCreate,
  AssistantTaskEvery,
  AssistantTaskUpdate,
  AssistantTasksResponse,
} from '../../lib/api/v1/types.ts'

export type TaskKind = AssistantTaskAsk['kind']

export const TASK_KINDS: readonly TaskKind[] = ['news', 'move', 'question', 'portfolio']
export const TASK_EVERY: readonly AssistantTaskEvery[] = ['10m', '30m', '1h', '1d']

/** The question a task asks, as the server takes it (3 … 300 characters). */
export const QUESTION_MIN = 3
export const QUESTION_MAX = 300

/** The device's own zone — a daily task runs at its time on the person's clock; Kyiv when the device names none. */
export function ownZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv'
  } catch {
    return 'Europe/Kyiv'
  }
}

/** The times a daily task may run, every half hour of the day. */
export const DAILY_TIMES: readonly string[] = Array.from({ length: 48 }, (_, index) => {
  const minutes = index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
export const DEFAULT_DAILY_TIME = '09:00'

/** What the task asks, from the form — null until it holds (a question long enough, a token for news or a move). */
export function askOf(
  kind: TaskKind,
  question: string,
  token: Readonly<{ mint: string; symbol: string | null }> | null,
): AssistantTaskAsk | null {
  if (kind === 'portfolio') return { kind }
  if (kind === 'question') {
    const text = question.trim()
    return text.length >= QUESTION_MIN && text.length <= QUESTION_MAX ? { kind, text } : null
  }
  if (!token) return null
  const symbol = (token.symbol ?? '').trim() || token.mint.slice(0, 4)
  return { kind, mint: token.mint, symbol: symbol.slice(0, 16) }
}

export type Rhythm = AssistantTasksResponse['rhythms'][number]

/** A rhythm's row in the answer, if the server named it. */
export function rhythmOf(read: AssistantTasksResponse | null | undefined, every: AssistantTaskEvery): Rhythm | null {
  return read?.rhythms.find((row) => row.every === every) ?? null
}

/** A rhythm can be picked unless the answer says it does not fit the day's runs. */
export function rhythmFits(read: AssistantTasksResponse | null | undefined, every: AssistantTaskEvery): boolean {
  return rhythmOf(read, every)?.fits !== false
}

/** The chosen rhythm, or the first that fits when the chosen one does not; the chosen one when none fits. */
export function fittingEvery(
  read: AssistantTasksResponse | null | undefined,
  chosen: AssistantTaskEvery,
): AssistantTaskEvery {
  if (!read || rhythmFits(read, chosen)) return chosen
  return read.rhythms.find((row) => row.fits)?.every ?? chosen
}

/** Whether any rhythm is off because the day's runs would not hold it. */
export function someRhythmOff(read: AssistantTasksResponse | null | undefined): boolean {
  return read ? read.rhythms.some((row) => !row.fits) : false
}

/** Tasks are off on this deployment (no runs a day at all). */
export function tasksOff(read: AssistantTasksResponse | null | undefined): boolean {
  return read ? read.runs.cap === 0 : false
}

/** The wallet keeps as many tasks as it may. */
export function tasksFull(read: AssistantTasksResponse | null | undefined): boolean {
  return read ? read.tasks.length >= read.limit : false
}

/** The new task's request — the price of a run sent exactly as shown; null until the ask holds. */
export function createTaskBody(
  input: Readonly<{
    ask: AssistantTaskAsk | null
    every: AssistantTaskEvery
    time: string
    zone: string
    locale: 'en' | 'uk'
    onlyWhenNew: boolean
    channels: Readonly<{ telegram: boolean; push: boolean }>
    shownPrice: number | null
  }>,
): AssistantTaskCreate | null {
  if (!input.ask || input.shownPrice === null) return null
  return {
    ask: input.ask,
    every: input.every,
    ...(input.every === '1d' ? { time: input.time } : {}),
    zone: input.zone,
    locale: input.locale,
    onlyWhenNew: input.onlyWhenNew,
    channels: input.channels,
    acceptCredits: input.shownPrice,
  }
}

/** «Пауза»: free, by the version the card shows. */
export function pauseBody(task: AssistantTask): AssistantTaskUpdate {
  return { ifVersion: task.version, status: 'paused' }
}

/** «Продовжити за N»: the price of a run the card shows, exactly. */
export function resumeBody(task: AssistantTask, shownPrice: number): AssistantTaskUpdate {
  return { ifVersion: task.version, status: 'active', acceptCredits: shownPrice }
}

/** A card's status: paused and why, or when it runs next; nothing when the server names no next run. */
export type TaskStatus =
  | Readonly<{ kind: 'paused' | 'pausedCredits' | 'pausedPrice' }>
  | Readonly<{ kind: 'next'; at: string }>
  | Readonly<{ kind: 'none' }>

export function taskStatus(task: AssistantTask): TaskStatus {
  if (task.status === 'paused') {
    if (task.pausedBy === 'credits') return { kind: 'pausedCredits' }
    if (task.pausedBy === 'price') return { kind: 'pausedPrice' }
    return { kind: 'paused' }
  }
  return task.nextRunAt ? { kind: 'next', at: task.nextRunAt } : { kind: 'none' }
}

/** The note's task (`?task=t_…`) when this wallet still has it. */
export function focusedTask(taskId: string | null, tasks: readonly AssistantTask[]): string | null {
  if (!taskId || !taskId.startsWith('t_')) return null
  return tasks.some((task) => task.id === taskId) ? taskId : null
}

export type TaskFailure =
  'limit' | 'runsCap' | 'priceChanged' | 'changed' | 'gone' | 'invalid' | 'network' | 'signIn' | 'failed'

/** The server's refusal in the app's terms; anything unnamed is «did not go through». */
export function taskFailureOf(error: unknown): TaskFailure {
  if (!(error instanceof ApiError)) return 'network'
  switch (error.code) {
    case 'TASK_LIMIT_REACHED':
      return 'limit'
    case 'TASK_RUNS_CAP':
      return 'runsCap'
    case 'TASK_PRICE_NOT_SHOWN':
      return 'priceChanged'
    case 'TASK_VERSION_CONFLICT':
      return 'changed'
    case 'TASK_NOT_FOUND':
      return 'gone'
    case 'VALIDATION_ERROR':
      return 'invalid'
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return 'signIn'
    default:
      return 'failed'
  }
}

/** A refusal after which the tasks are read again — a new price, a changed or vanished task. */
export function readTasksAgainAfter(failure: TaskFailure): boolean {
  return failure === 'priceChanged' || failure === 'changed' || failure === 'gone' || failure === 'runsCap'
}
