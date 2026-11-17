import { useEffect, useMemo, useState } from 'react';
import { readAgentView, useAutopilot, type AgentView } from '@/city/lib/autopilot/store';
import { forgetAgents, syncAgents, useAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { CARE_MODE, useCare, type CareRow } from '@/city/lib/earn/care';
import { PILOT_OPEN, usePilot } from '@/city/lib/pilot/store';
import { useWallet } from '@/city/lib/trade/wallet';
import type { PilotView } from '@/lib/pilot/view';
import { keeperRows, pastAgents, pilotRecord, pilotRow, traderRecords, traderRows, type MineRow, type PastRow } from './rows';

/**
 * What the Agents screen reads for the connected wallet, all of it the city's own logic as it is: the wallet's agents
 * from the engine, any browser or phone (`city/lib/bots/agents.ts`); each trader's book and the mandate's standing on
 * chain, every half minute while the page is in view (`city/lib/autopilot/store.ts`, `city/lib/bots/mandate-sign.ts`);
 * the autopilot's plan (`/api/bots/pilot`, read as the city reads it); the pools the keeper looks after
 * (`city/lib/earn/care.ts`). Every answer is kept with the wallet it was asked for: after a switch of wallets, nothing of
 * the last one stands on screen. Nothing here signs, builds or sends.
 */

/** Runs `read` now and then every `ms` while the page is in view; the returned stop ends it. */
function every(ms: number, read: () => void): () => void {
  read();
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') read();
  }, ms);
  return () => clearInterval(timer);
}

/** The clock the rows count days by: nothing before the page is in a browser, then the minute. */
function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => every(60_000, () => setNow(Date.now())), []);
  return now;
}

/** The autopilot's plan for a wallet, as the city reads it; null — none, or not read. */
async function readPilotView(owner: string): Promise<PilotView | null> {
  try {
    const response = await fetch(`/api/bots/pilot?owner=${owner}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const value = (await response.json()) as PilotView;
    return typeof value?.status === 'string' && typeof value.plan === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** An answer, with the wallet it is about. */
type For<T> = Readonly<{ owner: string; value: T }>;

export type AgentsData = Readonly<{
  owner: string | null;
  /** The traders' books, by policy; the first trader's for the panel and the history. */
  views: Readonly<Record<string, AgentView>>;
  pilot: PilotView | null;
  rows: readonly MineRow[];
  past: readonly PastRow[];
  setPilot: (owner: string, view: PilotView | null) => void;
}>;

export function useAgentsData(): AgentsData {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const local = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const localStatus = useMandate((st) => (local ? st.status[local.policy] : undefined));
  const views = useAutopilot((st) => st.views);
  const engine = useAgents((st) => (owner && MANDATE_NET ? (st.byOwner[owner]?.networks[MANDATE_NET] ?? null) : null));
  const cityPilot = usePilot((st) => st.view);
  const cares = useCare((st) => st.cares);
  const caresFailed = useCare((st) => st.caresFailed);
  const [pilot, setPilotFor] = useState<For<PilotView | null> | null>(null);
  const [caresFor, setCaresFor] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => useMandate.getState().hydrate(), []);

  // The wallet's agents from the engine: an agent hired on another device stands here too. A mandate signed here asks
  // the engine again at once.
  useEffect(() => {
    if (!owner || !(MANDATE_NET || CARE_MODE !== 'closed')) return;
    return every(60_000, () => void syncAgents(owner));
  }, [owner]);
  useEffect(() => {
    if (!owner || !local) return;
    forgetAgents(owner);
    void syncAgents(owner);
  }, [owner, local]);

  // The autopilot's plan, kept with its wallet; read again as the city's own card changes it (a plan gone live, stopped).
  useEffect(() => {
    if (!owner || !PILOT_OPEN) return;
    let live = true;
    const stop = every(30_000, () => void readPilotView(owner).then((view) => live && setPilotFor({ owner, value: view })));
    return () => {
      live = false;
      stop();
    };
  }, [owner, cityPilot]);

  // The pools the keeper looks after: the shared list counts for this wallet only once its own read answered.
  useEffect(() => {
    if (!owner || CARE_MODE === 'closed') return;
    let live = true;
    void useCare
      .getState()
      .load(owner)
      .then(() => live && setCaresFor(owner));
    return () => {
      live = false;
    };
  }, [owner]);

  const mandates = engine?.read ? engine.mandates : null;
  const pilotView = owner && PILOT_OPEN && pilot?.owner === owner ? pilot.value : null;
  const traders = useMemo(
    () => (owner ? traderRecords({ local: local ? { record: local, status: localStatus } : null, engine: mandates, pilotPolicy: pilotView?.policy ?? null }) : []),
    [owner, local, localStatus, mandates, pilotView],
  );
  const traderKey = traders.map((one) => one.record.policy).join(',');

  // Each trader's book, and this browser's mandate's standing on chain.
  useEffect(() => {
    if (!traders.length) return;
    let live = true;
    const read = async () => {
      const sign = await import('@/city/lib/bots/mandate-sign');
      for (const one of traders) {
        const answer = await readAgentView(one.record);
        if (live && answer) useAutopilot.getState().setView(one.record.policy, answer);
        if (one.record === local) {
          const standing = await sign.readStatus(one.record);
          if (live && standing) useMandate.getState().setStatus(one.record.policy, standing);
        }
      }
    };
    const stop = every(30_000, () => void read());
    return () => {
      live = false;
      stop();
    };
    // The books are read again only when the set of traders changes, not on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traderKey]);

  const careRows: readonly CareRow[] | null = owner && CARE_MODE !== 'closed' && caresFor === owner && !caresFailed ? cares : null;
  const rows = useMemo(() => {
    if (!owner || !now) return [];
    const trader = traderRows({ local: local ? { record: local, status: localStatus } : null, engine: mandates, pilotPolicy: pilotView?.policy ?? null, views }, now);
    const autopilot = pilotRow(pilotView, pilotRecord(pilotView?.policy ?? null, mandates, local));
    return [...trader, ...(autopilot ? [autopilot] : []), ...keeperRows(careRows)];
  }, [owner, now, local, localStatus, mandates, pilotView, views, careRows]);
  const past = useMemo(() => (owner && mandates ? pastAgents(mandates) : []), [owner, mandates]);
  const traderViews = useMemo(() => Object.fromEntries(traders.flatMap((one) => (views[one.record.policy] ? [[one.record.policy, views[one.record.policy]!]] : []))), [traders, views]);

  return { owner, views: traderViews, pilot: pilotView, rows, past, setPilot: (who, view) => setPilotFor({ owner: who, value: view }) };
}

export type StopResult = 'stopped' | 'walletNo' | 'refused' | 'unreachable';

/**
 * «Stop», the agent's own way: a trader's or the autopilot's mandate taken back — one signature, the rest back to the
 * wallet; a pool taken back from the keeper. The engine builds; the person's wallet signs. Nothing happens without a
 * wallet, or for a row with nothing to stop.
 */
export async function stopAgent(row: MineRow, done: (pilot: PilotView | null) => void): Promise<StopResult | null> {
  const connection = useWallet.getState().connection;
  if (!connection || !row.stop || useMandate.getState().busy) return null;
  if ('care' in row.stop) {
    useCare.setState({ notice: null });
    await useCare.getState().takeBack(connection, row.stop.care);
    const notice = useCare.getState().notice;
    return notice === 'cancelled' ? 'walletNo' : notice === 'failed' ? 'refused' : 'stopped';
  }
  const { tapStop } = await import('@/city/lib/bots/mandate-sign');
  await tapStop({ wallet: connection.wallet, owner: connection.address }, row.stop.record);
  const said = useMandate.getState().note?.kind;
  const result: StopResult = said === 'stopped' ? 'stopped' : said === 'walletNo' ? 'walletNo' : said === 'unreachable' ? 'unreachable' : 'refused';
  if (row.role === 'pilot' && result === 'stopped') {
    // The autopilot's plan stops with its mandate; its savings and pools stay where they are.
    const view = usePilot.getState().view;
    if (view && view.policy === row.stop.record.policy) usePilot.setState({ view: { ...view, status: 'stopped' } });
    done(null);
  }
  return result;
}
