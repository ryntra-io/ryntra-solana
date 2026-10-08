/**
 * Rewards as values — pure. The one place in the app that knows the shape
 * of the server's rewards answer: it folds that answer into the view the
 * screens draw — what is available, pending and earned over time, where
 * it came from, the points and their level, the referral link and who was
 * invited — so the screens name no loyalty provider and a different one
 * behind the same route changes this file alone. Nothing here reads the
 * network, and no figure is invented: a reward without a dollar figure is
 * a dash, a points ledger that could not be read is unavailable.
 */

import type { RewardRow, RewardsResponse } from '../../lib/api.ts'
import type { Locale } from '../../lib/locale.ts'
import { DASH, formatUsd, localizeFigures } from '../../utils/format.ts'

export type RewardSourceId = 'cashback' | 'referralL1' | 'referralL2'
export type RewardEntryKind = 'cashback' | 'referralL1' | 'referralL2' | 'claim' | 'other'

export type RewardSource = Readonly<{ id: RewardSourceId; text: string }>

export type RewardEntry = Readonly<{
  kind: RewardEntryKind
  /** Signed and with its currency, as the server printed it; a dash for a reward without a figure yet. */
  display: string
  valued: boolean
  /** The pair it came from when the source names one; never an address. */
  detail: string | null
  at: string
}>

export type PointsProgress = Readonly<{
  points: string
  level: number
  levelFrom: string
  nextLevelAt: string | null
  /** Where the level stands, 0…1; null at the top or when the figures cannot be read. */
  progress: number | null
  rank: number | null
  ranked: number
  volume: string
  trades: number
  activeDays: number
  /** An internal wallet earns points but is not ranked. */
  excluded: boolean
}>

export type RewardsView = Readonly<{
  address: string
  /** Money as text with its currency: "$12.34", "<$0.01", "$0.00". */
  available: string
  pending: string
  lifetime: string
  sources: readonly RewardSource[]
  /** The sentence the server gives for why Claim is not offered, or null when it would be. */
  claimNote: string | null
  claimable: boolean
  /** An open claim, as the server describes it. */
  claim: Readonly<{ state: string; text: string; signature: string | null }> | null
  points: PointsProgress | null
  referral: Readonly<{ code: string; link: string }> | null
  invited: Readonly<{ level1: number; level2: number }>
  /** Who invited this wallet, masked by the server, or null. */
  invitedBy: string | null
  entries: readonly RewardEntry[]
  /** Whether accrual has begun on this deployment at all. */
  started: boolean
}>

/** The server's decimal text with its currency in front, in the language's shape: "12.34" → "$12.34" · «$12,34», "<0.01" → "<$0.01". */
export function dollars(text: string | null | undefined, locale: Locale = 'en'): string {
  if (typeof text !== 'string' || text.length === 0) return DASH
  // A plain decimal is money the app shapes itself — grouped, with the language's marks: «$1,234.50» · «$1 234,50».
  const plain = /^([<-]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)$/.exec(text)
  if (plain) {
    const shaped = formatUsd(Number(plain[2].replace(/,/g, '')), locale)
    return plain[1] === '-' ? `−${shaped}` : `${plain[1]}${shaped}`
  }
  return localizeFigures(text, locale)
}

/** A grouped figure as the server prints it ("1 234", "1,234") back into a number; null when it is not one. */
export function ungroup(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null
  const digits = text.replace(/[\s,  ]/g, '')
  if (!/^\d+(\.\d+)?$/.test(digits)) return null
  const value = Number(digits)
  return Number.isFinite(value) ? value : null
}

export function entryKind(kind: RewardRow['kind']): RewardEntryKind {
  switch (kind) {
    case 'CASHBACK':
      return 'cashback'
    case 'REFERRAL_L1':
      return 'referralL1'
    case 'REFERRAL_L2':
      return 'referralL2'
    case 'CLAIM':
      return 'claim'
    default:
      return 'other'
  }
}

export function pointsProgress(points: RewardsResponse['points']): PointsProgress | null {
  if (!points) return null
  const have = ungroup(points.points)
  const from = ungroup(points.levelFrom)
  const next = points.nextLevelAt === null ? null : ungroup(points.nextLevelAt)
  let progress: number | null = null
  if (have !== null && from !== null && next !== null && next > from) {
    progress = Math.min(1, Math.max(0, (have - from) / (next - from)))
  }
  return {
    points: points.points,
    level: points.level,
    levelFrom: points.levelFrom,
    nextLevelAt: points.nextLevelAt,
    progress,
    rank: typeof points.rank === 'number' && Number.isFinite(points.rank) ? points.rank : null,
    ranked: points.ranked,
    volume: points.volume,
    trades: points.trades,
    activeDays: points.activeDays,
    excluded: points.excluded === true,
  }
}

/** The whole answer, as the screens read it. */
export function rewardsView(response: RewardsResponse, locale: Locale): RewardsView {
  const sources: RewardSource[] = [
    { id: 'cashback', text: dollars(response.cashback, locale) },
    { id: 'referralL1', text: dollars(response.referralL1, locale) },
    { id: 'referralL2', text: dollars(response.referralL2, locale) },
  ]
  const points = pointsProgress(response.points)
  return {
    address: response.address,
    available: dollars(response.available, locale),
    pending: dollars(response.pending, locale),
    lifetime: dollars(response.lifetime, locale),
    sources,
    claimNote: response.claimable ? null : response.claimBlockedReason ? localizeFigures(response.claimBlockedReason, locale) : null,
    claimable: response.claimable === true,
    claim: response.claim ?? null,
    points: points ? { ...points, volume: localizeFigures(points.volume, locale) } : null,
    referral: response.referral && response.referral.code && response.referral.link ? response.referral : null,
    invited: { level1: response.referrals?.level1 ?? 0, level2: response.referrals?.level2 ?? 0 },
    invitedBy: response.invitedBy ?? null,
    entries: (response.rows ?? []).map((row) => ({
      kind: entryKind(row.kind),
      display: row.valued ? localizeFigures(row.display, locale) : DASH,
      valued: row.valued,
      detail: row.detail ?? null,
      at: row.at,
    })),
    started: response.started !== false,
  }
}

/** What the Android share sheet carries for a referral: one sentence and the link, never the code alone. */
export function referralShare(
  referral: Readonly<{ code: string; link: string }>,
  words: Readonly<{ invite: (link: string) => string; subject: string }>,
): Readonly<{ message: string; url: string; title: string }> {
  return { message: words.invite(referral.link), url: referral.link, title: words.subject }
}
