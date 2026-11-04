import { FEE_POLICY_V2 } from '../../../lib/core/fee-policy.ts';
import { AGENT_FEE_CEILING_BPS, AGENT_FEE_FLOOR_BPS } from '../../../lib/mandate/fee-rates.ts';
import type { Lang } from './format.ts';

/**
 * Ryntra's fee on the agent's trades as the agent's windows say it (CITY-183): the range in one line before the
 * signature, the rates by kind of coin behind «Details». The numbers are the engine's own — fee policy v2, the table a
 * person's swap pays by — never typed here.
 */

/** A rate in basis points as the windows write it: 10 → «0.1», 25 → «0.25», 100 → «1»; the Ukrainian comma. */
export function bpsText(bps: number, lang: Lang): string {
  const text = String(bps / 100);
  return lang === 'uk' ? text.replace('.', ',') : text;
}

/** What the windows show: the range and the rate of each kind of coin the agent buys. */
export function agentFeeFigures(lang: Lang) {
  const at = (bps: number) => bpsText(bps, lang);
  return {
    low: at(AGENT_FEE_FLOOR_BPS),
    high: at(AGENT_FEE_CEILING_BPS),
    major: at(FEE_POLICY_V2.MAJOR.bps),
    stock: at(FEE_POLICY_V2.XSTOCK.bps),
    trending: at(FEE_POLICY_V2.TRENDING.bps),
    meme: at(FEE_POLICY_V2.MEME.bps),
  } as const;
}
