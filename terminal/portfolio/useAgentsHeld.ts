import { useEffect, useMemo, useState } from 'react';
import { syncAgents, useAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { CARE_MODE, useCare } from '@/city/lib/earn/care';
import { SOL } from '@/city/lib/trade/tiles';
import { useAgentsData } from '@/terminal/agents/useAgentsData';
import type { MineRow } from '@/terminal/agents/rows';
import { useMarket } from '@/terminal/shell/useMarket';
import { agentsHeld, type AgentHeld, type Budget } from './portfolio-view';

export type AgentsHeld = Readonly<{
  rows: readonly MineRow[];
  /** What each agent holds of the person's money, by the row's key. */
  held: ReadonlyMap<string, AgentHeld>;
  /** What they hold together, dollars; null — not read, or nothing of it priced. */
  usd: number | null;
}>;

const NONE: AgentsHeld = { rows: [], held: new Map(), usd: null };

/**
 * The connected wallet's agents and what each holds, from the Agents screen's own reads (`../agents/useAgentsData.ts`):
 * a trader's or the autopilot's budget — the SOL its mandate's budget account holds — and a pool the keeper looks
 * after. That money stands outside the wallet, so the engine's read of the wallet does not count it: the Portfolio adds
 * it beside. `owner` null — a wallet that is only looked at: its agents are not read.
 */
export function useAgentsHeld(owner: string | null): AgentsHeld {
  const agentsData = useAgentsData();
  const engine = useAgents((st) => (owner && MANDATE_NET ? (st.byOwner[owner]?.networks[MANDATE_NET] ?? null) : null));
  const local = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const localStatus = useMandate((st) => (local ? st.status[local.policy] : undefined));
  const cares = useCare((st) => st.cares);
  const [, setRound] = useState(0);
  const served = Boolean(MANDATE_NET) || CARE_MODE !== 'closed';
  useEffect(() => {
    if (!owner || !served) return;
    let live = true;
    void syncAgents(owner).then(() => live && setRound((n) => n + 1));
    return () => {
      live = false;
    };
  }, [owner, served]);

  // SOL's price, as the Agents screen reads it: the market's own.
  const towers = useMarket().towers;
  const solUsd = useMemo(() => {
    const sol = towers.find((tower) => tower.id === SOL.mint);
    return sol && Number.isFinite(sol.price) && sol.price > 0 ? sol.price : null;
  }, [towers]);

  return useMemo(() => {
    if (!owner) return NONE;
    const budgets = new Map<string, Budget>();
    for (const mandate of engine?.read ? engine.mandates : []) budgets.set(mandate.record.policy, { account: mandate.record.budget, lamports: mandate.budgetLamports });
    if (local && !budgets.has(local.policy)) budgets.set(local.policy, { account: local.budget, lamports: localStatus?.budgetLamports ?? null });
    const careWorth = new Map<string, number | null>((cares ?? []).map((care) => [care.key, care.valueUsd ?? null]));
    const rows = agentsData.rows;
    const money = agentsHeld({ rows, budgets, cares: careWorth, solUsd, counted: MANDATE_NET === 'mainnet' });
    return { rows, held: new Map(money.rows.map((row) => [row.key, row])), usd: money.usd };
  }, [owner, agentsData.rows, engine, local, localStatus, cares, solUsd]);
}
