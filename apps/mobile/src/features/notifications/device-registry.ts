/**
 * This phone in the wallet's device registry — the decisions, pure.
 *
 * A device is registered for exactly one wallet at a time, under that
 * wallet's bearer, with the push provider's token, the app's version, the
 * language and the quiet hours; it is refreshed when any of those change
 * and revoked when the wallet signs out or switches. The token is data the
 * server needs and nothing else: it is kept on the device, sent on the
 * registration, and never logged or shown.
 */

import type { DeviceRegistration, NotificationCategory, QuietHours } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'

/** What the phone remembers of its registration for one wallet. */
export type DeviceRecord = Readonly<{
  address: string
  deviceId: string
  token: string
  appVersion: string
  locale: Locale
  categories: readonly NotificationCategory[]
  quietHours: QuietHours | null
  registeredAt: string
  /** When the record was last confirmed or refreshed on the server. */
  refreshedAt: string
}>

/** The notes this app asks to be pushed: a plan's material change. Operations, market and system notes have no phone surface yet. */
export const PHONE_CATEGORIES: readonly NotificationCategory[] = ['plan']

/** A registration record is refreshed no more often than this when nothing changed. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

export type RegistrationInput = Readonly<{
  address: string
  token: string | null
  appVersion: string
  locale: Locale
  quietHours: QuietHours | null
  record: DeviceRecord | null
  now: number
}>

function sameQuietHours(a: QuietHours | null, b: QuietHours | null): boolean {
  if (a === null || b === null) return a === b
  return a.start === b.start && a.end === b.end && a.timezone === b.timezone
}

/** The body to send, as the contract's strict schema reads it — every field said, so a refresh never blanks one. */
export function registrationOf(
  input: Readonly<{ token: string; appVersion: string; locale: Locale; quietHours: QuietHours | null }>,
): DeviceRegistration {
  return {
    platform: 'android',
    token: input.token,
    appVersion: input.appVersion,
    locale: input.locale,
    categories: [...PHONE_CATEGORIES],
    quietHours: input.quietHours,
  }
}

/**
 * Whether the server must be told about this device now: a first
 * registration, a token the provider rotated, a new app version, another
 * language, other quiet hours, or a day since the last word. Null when the
 * record on the phone already says what the server holds. Never for a
 * record of another wallet.
 */
export function registrationNeeded(input: RegistrationInput): DeviceRegistration | null {
  if (!input.token) return null
  const record = input.record && input.record.address === input.address ? input.record : null
  const next = registrationOf({
    token: input.token,
    appVersion: input.appVersion,
    locale: input.locale,
    quietHours: input.quietHours,
  })
  if (!record) return next
  const changed =
    record.token !== input.token ||
    record.appVersion !== input.appVersion ||
    record.locale !== input.locale ||
    !sameQuietHours(record.quietHours, input.quietHours) ||
    record.categories.join(',') !== next.categories.join(',')
  if (changed) return next
  const refreshedAt = Date.parse(record.refreshedAt)
  if (!Number.isFinite(refreshedAt) || input.now - refreshedAt >= REFRESH_AFTER_MS) return next
  return null
}

/** The record to keep after the server answered a registration. */
export function recordOf(
  registration: DeviceRegistration,
  answer: Readonly<{ deviceId: string; registeredAt: string }>,
  address: string,
  now: number,
): DeviceRecord {
  return {
    address,
    deviceId: answer.deviceId,
    token: registration.token,
    appVersion: registration.appVersion,
    locale: registration.locale,
    categories: [...registration.categories],
    quietHours: registration.quietHours,
    registeredAt: answer.registeredAt,
    refreshedAt: new Date(now).toISOString(),
  }
}

/** The record of this wallet only; another wallet's record is never handed to a screen or a request. */
export function recordFor(record: DeviceRecord | null, address: string | null): DeviceRecord | null {
  return record && address && record.address === address ? record : null
}

/** A line for a log or a screen that names a device without its token. */
export function describeDevice(record: DeviceRecord | null): string {
  if (!record) return 'no device'
  return `${record.deviceId} · ${record.appVersion} · ${record.locale}`
}

/**
 * A push tap is handled once: the same response delivered again — the app
 * resumed twice, the listener and the launch response both firing — never
 * opens a second time. Bounded so a long-lived process does not grow.
 */
export class OnceSet {
  private readonly seen: string[] = []
  private readonly limit: number
  constructor(limit = 64) {
    this.limit = limit
  }
  /** True the first time an id is seen. */
  take(id: string): boolean {
    if (this.seen.includes(id)) return false
    this.seen.push(id)
    if (this.seen.length > this.limit) this.seen.shift()
    return true
  }
}

/** How the phone stands, for the preferences screen — one word, then one line. */
export type PhoneState = 'on' | 'off' | 'off_permission' | 'off_no_config' | 'off_web' | 'unknown'

export function phoneState(
  input: Readonly<{
    record: DeviceRecord | null
    permission: 'granted' | 'denied' | 'undetermined' | null
    tokenAvailable: boolean | null
    serverPush: boolean | null
  }>,
): PhoneState {
  if (input.permission === 'denied') return 'off_permission'
  if (input.tokenAvailable === false) return 'off_no_config'
  if (!input.record) return 'off'
  if (input.serverPush === false) return 'off_web'
  if (input.serverPush === null || input.permission === null) return 'unknown'
  return 'on'
}
