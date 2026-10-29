/**
 * What a preset says before the signature (contract 1.36.0, `GET
 * /api/v1/launch/presets`): its facts, and the rules the new market will
 * stand on — each a program's rule or Ryntra's policy, keyed as the server's
 * market health keys them (`MARKET_RULE_KEEPING` in
 * `lib/core/launch/market-health.ts` on the web line). Every figure is the
 * preset's own; a preset the phone has not seen before (Micro, once the
 * server lists it) is said the same way. Nothing of a constitution — no
 * version, no hash — until the server has one. Pure: the screens and the
 * tests read it.
 */

import type {
  LaunchMarketEnforcement,
  LaunchMarketKeeper,
  LaunchMarketRule,
  LaunchMarketRuleCode,
  LaunchPreset,
} from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/locale.ts'
import type { LaunchWord } from './copy.ts'
import { formatNumber } from './launch-format.ts'
import { pct, ruleText } from './market-view.ts'

/** Who keeps each rule — the server's own table; a program's rule first, Ryntra's policy after. */
export const RULE_KEEPING: Readonly<
  Record<LaunchMarketRuleCode, Readonly<{ enforcement: LaunchMarketEnforcement; by: LaunchMarketKeeper }>>
> = {
  MINT_REVOKED: { enforcement: 'rule', by: 'token-2022' },
  NO_FREEZE: { enforcement: 'rule', by: 'token-2022' },
  METADATA_FIXED: { enforcement: 'rule', by: 'token-2022' },
  NO_TRANSFER_HOOK: { enforcement: 'rule', by: 'token-2022' },
  CONFIG_FIXED: { enforcement: 'rule', by: 'meteora-dbc' },
  CURVE_HOLDS_FUNDS: { enforcement: 'rule', by: 'meteora-dbc' },
  GRADUATION_AT_THRESHOLD: { enforcement: 'rule', by: 'meteora-dbc' },
  LP_LOCKED_FOREVER: { enforcement: 'rule', by: 'meteora-damm-v2' },
  CREATOR_LOCK: { enforcement: 'rule', by: 'met-lock' },
  CREATOR_FEES_SHARED: { enforcement: 'rule', by: 'dynamic-fee-sharing' },
  CREATOR_FIRST_BUY_CAP: { enforcement: 'policy', by: 'ryntra' },
  GRADUATION_BY_RYNTRA: { enforcement: 'policy', by: 'ryntra' },
  FEE_FUNDED_LADDER: { enforcement: 'policy', by: 'ryntra' },
  CREATOR_SALE_MARK: { enforcement: 'policy', by: 'ryntra' },
  CONCENTRATION_MARK: { enforcement: 'policy', by: 'ryntra' },
}

export type PresetLock = Readonly<{ cliffDays: number; vestDays: number }>

/**
 * The rules a launch with this preset — and, when chosen, the creator's lock —
 * will stand on: what a buyer asks first (the lock, no minting, no freezing,
 * the curve holding the money), then the config and the token's other rules,
 * the way out and the locked pool, then Ryntra's one policy every launch gets. Not
 * what the server lists only while something runs or was read — Ryntra's
 * executor sending the move, its ladder, the marks of the creator's sales and
 * of concentration — nor a sharing of fees the phone does not build: the
 * market's page shows those once they hold. No source yet — the accounts
 * exist only after the signature.
 */
export function presetRules(preset: LaunchPreset, lock: PresetLock | null, now: number): readonly LaunchMarketRule[] {
  const rules: LaunchMarketRule[] = []
  const add = (code: LaunchMarketRuleCode, values: Readonly<Record<string, number | string>> = {}) =>
    rules.push({ code, ...RULE_KEEPING[code], source: null, values })
  if (lock) {
    const cliffAt = Math.floor(now / 1000) + lock.cliffDays * 86_400
    add('CREATOR_LOCK', { cliffAt, endsAt: cliffAt + lock.vestDays * 86_400 })
  }
  add('MINT_REVOKED')
  add('NO_FREEZE')
  add('CURVE_HOLDS_FUNDS')
  add('CONFIG_FIXED')
  add('METADATA_FIXED')
  add('NO_TRANSFER_HOOK')
  add('GRADUATION_AT_THRESHOLD', { capUsd: preset.graduationMarketCapUsd })
  if (preset.lpLockedForeverPct === 100) add('LP_LOCKED_FOREVER')
  add('CREATOR_FIRST_BUY_CAP', { capBps: preset.firstBuyCapBps })
  return rules
}

/** A rule's sentence before the market exists: the way out by its market cap, the pool still to come, the rest as the market's page says it. */
export function presetRuleText(rule: LaunchMarketRule, preset: LaunchPreset, word: LaunchWord, locale: Locale, now: number) {
  switch (rule.code) {
    case 'GRADUATION_AT_THRESHOLD':
      return word('rule_GRADUATION_AT_CAP', { amount: usd(preset.graduationMarketCapUsd, locale) })
    case 'CREATOR_FIRST_BUY_CAP':
      return word('rule_CREATOR_FIRST_BUY_CAP_before', { pct: pct(preset.firstBuyCapBps, locale) })
    case 'LP_LOCKED_FOREVER':
      return word('presetLpForever')
    default:
      return ruleText(rule, { symbol: preset.pair.symbol, decimals: preset.pair.decimals, dollar: false }, word, locale, now)
  }
}

/**
 * What every preset the server lists says alike — the way to the DEX, the
 * pool locked for ever — said once above the cards; a preset that differs
 * (Micro, with its own threshold) brings the line back onto each card.
 */
export function presetsAlike(presets: readonly LaunchPreset[]): Readonly<{ way: boolean; lpForever: boolean }> {
  const [first, ...rest] = presets
  if (!first || rest.length === 0) return { way: false, lpForever: false }
  return {
    way: rest.every(
      (entry) =>
        entry.startMarketCapUsd === first.startMarketCapUsd &&
        entry.graduationMarketCapUsd === first.graduationMarketCapUsd,
    ),
    lpForever: presets.every((entry) => entry.lpLockedForeverPct === 100),
  }
}

/** Whole dollars of a preset's market cap. */
export function usd(value: number, locale: Locale): string {
  return `$${formatNumber(value, locale, 0)}`
}
