import type { MineRow } from '../agents/rows.ts';
import { foldZeros } from '../ui/figures.ts';

/**
 * The Portfolio screen's older rules, without React, that the new screen still stands on: a coin amount for the eye,
 * what the agents hold — their budgets stand outside the wallet, so the engine's read of the wallet does not count
 * them — and when the panel in front may close. The groups, the total and the three actions are `./all-view.ts`.
 *
 * Pure: the tests hold them as they are written.
 */

/**
 * A coin amount for the eye, the English way (the screen writes it in its language): 4,200,000 · 135.60 · 0.3026 ·
 * 0.0000425. Large amounts whole, amounts of one coin or more to the cent, smaller ones to four significant digits.
 */
export function unitsFigure(units: number): string {
  if (!Number.isFinite(units) || units <= 0) return '0';
  if (units >= 10_000) return Math.floor(units).toLocaleString('en-US');
  if (units >= 1) return units.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const places = Math.min(12, -Math.floor(Math.log10(units)) + 3);
  return units.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * A tiny coin price for the eye, the English way (the screen writes it in its language): a coin worth under a hundredth
 * of a cent has its run of zeros folded, as the chart and the pool's desk write it — $0.000001036 → «$0.0₅1036» (QA
 * 19.11). Null — a price the terminal's own `priceText` writes as it is.
 */
export function tinyPrice(price: number): string | null {
  if (!Number.isFinite(price) || price <= 0 || price >= 0.0001) return null;
  // Four significant figures, however small, the zeros at their end dropped.
  const places = Math.min(40, -Math.floor(Math.log10(price)) + 3);
  return `$${foldZeros(price.toFixed(places).replace(/0+$/, ''))}`;
}

/* ── what the agents hold ─────────────────────────────────────────────── */

/** A mandate's budget account and what stands in it now, lamports; null — not read. */
export type Budget = Readonly<{ account: string; lamports: string | null }>;

export type AgentHeld = Readonly<{
  key: string;
  /** What the agent holds of the person's money, dollars; null — not read, not priced, or not counted here. */
  usd: number | null;
}>;

export type AgentsInput = Readonly<{
  rows: readonly MineRow[];
  /** Each mandate's budget, by its policy: the engine's answer, and this browser's own mandate beside it. */
  budgets: ReadonlyMap<string, Budget>;
  /** What each pool the keeper looks after is worth now, dollars, by the care's key. */
  cares: ReadonlyMap<string, number | null>;
  /** SOL's price, the Agents screen's own: the market's read. */
  solUsd: number | null;
  /** A budget counts as money only on the network that holds the person's money; a practice one is shown, never added. */
  counted: boolean;
}>;

/**
 * What each agent at work holds: a trader's or the autopilot's budget — the SOL its mandate's budget account holds on
 * chain — and a pool the keeper looks after, at the pool's own worth. Two mandates on one budget account count it once.
 */
export function agentsHeld(input: AgentsInput): Readonly<{ rows: readonly AgentHeld[]; usd: number | null }> {
  const seen = new Set<string>();
  const rows = input.rows.map((row): AgentHeld => {
    if (!input.counted) return { key: row.key, usd: null };
    if (row.role === 'keeper') {
      const usd = input.cares.get(row.key.replace(/^keeper:/, '')) ?? null;
      return { key: row.key, usd: typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : null };
    }
    const record = row.stop && 'record' in row.stop ? row.stop.record : null;
    const budget = record ? input.budgets.get(record.policy) : undefined;
    if (!budget || budget.lamports === null || !/^\d+$/.test(budget.lamports) || seen.has(budget.account)) return { key: row.key, usd: null };
    seen.add(budget.account);
    if (input.solUsd === null || !(input.solUsd > 0)) return { key: row.key, usd: null };
    return { key: row.key, usd: (Number(BigInt(budget.lamports)) / 1e9) * input.solUsd };
  });
  const known = rows.filter((row) => row.usd !== null);
  return { rows, usd: known.length ? known.reduce((sum, row) => sum + (row.usd as number), 0) : rows.length ? null : 0 };
}

/* ── the panel the screen acts in ─────────────────────────────────────── */

/** Where a trade is, as the trade card's store says it. */
export type CardPhase = 'idle' | 'preparing' | 'wallet' | 'sending' | 'checking' | 'done' | 'failed' | 'unknown';

/**
 * Whether the panel in front may close: never while money is mid-way — an order being built or signed, a trade being
 * sent or read, a transfer out to the wallet. A trade that ended, or never started, lets it go.
 */
export function mayClose(input: Readonly<{ trade: boolean; phase: CardPhase; held: boolean; moneyBusy: boolean }>): boolean {
  if (input.moneyBusy) return false;
  if (!input.trade) return true;
  return !input.held && (input.phase === 'idle' || input.phase === 'done' || input.phase === 'failed');
}

/** Where the wallet's proof stands for one address, as the shared store says it (`proofStatusFor`). */
export type ProofSeen = 'idle' | 'checking' | 'proven' | 'unproven';

/**
 * Whether «Show my agents» stands where the agents would: the engine reads a wallet's agents only for the wallet this
 * browser proved (`/api/bots/agents`), so on a new device «Agents» would simply be missing. The quiet action stands
 * only on the person's own wallet, where agents are served here, while the engine has not answered for it, the store
 * knows the wallet is not proven (never while it is still checking), no agent row stands from this browser's own note,
 * and the person has not put it away for this wallet. Nothing here asks the wallet: the action does, on a tap.
 *
 * `locked` — the engine itself refused the wallet for want of this device's proof (401). Then the action stands
 * whatever the store believes of the proof (a proof this tab remembers may have run out) and beside the rows that do stand
 * (a pool the keeper looks after reads without the proof; the bots do not).
 */
export function agentsAsk(at: Readonly<{ own: boolean; served: boolean; answered: boolean; proof: ProofSeen; rows: number; hidden: boolean; locked?: boolean }>): boolean {
  if (!at.own || !at.served || at.answered || at.hidden) return false;
  return at.locked === true || (at.proof === 'unproven' && at.rows === 0);
}
