import { planFrom, type StrategyPlan } from '../../../lib/mandate/plans.ts';
import type { AUTOPILOT } from './words.ts';

/**
 * CITY-193 — the agent's strategy as the card says it: one line on the card, the rules behind «Details», and the run on
 * history in one line. Pure: the words in, the lines out — the tests read them in both languages.
 */

type W = (typeof AUTOPILOT)['en'];

/** Basis points as a person reads a per cent: «8», «2.5»; the Ukrainian comma. */
export function pctText(bps: number, lang: 'en' | 'uk'): string {
  const text = String(Math.round(bps) / 100);
  return lang === 'uk' ? text.replace('.', ',') : text;
}

/** The plan in one line — «Buys on dips of 8% · takes +20%»; null for the plain steady one, whose rhythm says it all. */
export function planLine(plan: StrategyPlan | null, w: W, lang: 'en' | 'uk'): string | null {
  if (!plan) return null;
  const head = plan.id === 'dip' ? w.planDip(pctText(plan.dropBps, lang)) : plan.id === 'grid' ? w.planGrid(plan.levels, pctText(plan.stepBps, lang)) : plan.id === 'early' ? w.planEarly : plan.exit ? w.planSteady : null;
  if (!head) return null;
  const exit = [plan.exit?.takeBps ? w.planTake(pctText(plan.exit.takeBps, lang)) : null, plan.exit?.stopBps ? w.planStop(pctText(plan.exit.stopBps, lang)) : null].filter(Boolean);
  return [head, ...exit].join(' · ');
}

/** The plan's rules, for «Details»: what decides a buy, the rhythm as its ceiling, the exit, the same limits. */
export function planRules(plan: StrategyPlan | null, w: W, lang: 'en' | 'uk', rhythm: Readonly<{ buys: number; perTrade: string }> | null, sells: boolean): string[] {
  if (!plan || (plan.id === 'steady' && !plan.exit)) return [];
  const lines: string[] = [];
  if (plan.id === 'dip') lines.push(w.ruleDip(pctText(plan.dropBps, lang)));
  if (plan.id === 'grid') lines.push(w.ruleGrid(plan.levels, pctText(plan.stepBps, lang)));
  if (plan.id === 'early') lines.push(w.ruleEarly);
  if (plan.id !== 'steady' && rhythm) lines.push(w.ruleCeiling(rhythm.buys, rhythm.perTrade));
  if (plan.exit) lines.push(w.ruleExit(sells));
  lines.push(w.ruleSame);
  return lines;
}

/** A run's per cent as the card writes it: «+4.2%», «−3.1%», «0%». */
export function signedPct(value: number, lang: 'en' | 'uk'): string {
  const rounded = Math.round(value * 10) / 10;
  const body = Math.abs(rounded).toFixed(Math.abs(rounded) >= 10 ? 0 : 1).replace(/\.0$/u, '');
  const text = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${body}${lang === 'uk' ? ' %' : '%'}`;
  return lang === 'uk' ? text.replace('.', ',') : text;
}

/** The run on history in one line; null when it did not run. */
export function testedLine(run: Readonly<{ fromMs: number; toMs: number; resultPct: number | null; holdPct: number | null }> | null, w: W, lang: 'en' | 'uk'): string | null {
  if (!run || !(run.toMs > run.fromMs)) return null;
  const days = String(Math.max(1, Math.round((run.toMs - run.fromMs) / 86_400_000)));
  if (run.resultPct === null || run.holdPct === null) return w.testedNone(days);
  return w.tested(days, signedPct(run.resultPct, lang), signedPct(run.holdPct, lang));
}

/** The plan of a view or a paper, from its text; null — the steady one or not read. */
export const planOfText = (text: string | null | undefined): StrategyPlan | null => (text ? planFrom(text) : null);
