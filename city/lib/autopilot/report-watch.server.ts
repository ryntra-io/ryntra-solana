import 'server-only';

import { onlyRows } from '@/lib/assistant/watch/runtime.server';
import type { GuardStore } from '@/lib/guard/store';
import { AGENT_SYMBOL_ENV, agentResult } from '@/lib/mandate/agent-service.server';
import { mandateGate } from '@/lib/mandate/service.server';
import { deliverOutbox } from '@/lib/monitoring/service.server';
import { fetchTokenCatalog } from '@/lib/solana/catalog';
import { WRAPPED_SOL_MINT } from '@/lib/solana/send-kinds';
import { agentReportSends, AGENT_REPORT_SEND_ENV } from './report';
import { runReportPass, type ReportPass, type ReportRead } from './report-watch';

/**
 * The production side of the agent's daily report (CITY-194): what the agent did comes from its own book and the
 * venue's price through `agentResult` — the very read the city's card shows — the coin's ticker and SOL's dollar price
 * from Jupiter's catalogue, and the note goes through the monitoring delivery (Telegram, the phone's push, the
 * browser's push, quiet hours, retries). Shut unless `RYNTRA_AGENT_REPORT=on` and the mandate's gate stands open.
 */

type Env = Readonly<Record<string, string | undefined>>;

const SYMBOL = /^[A-Za-z0-9]{1,10}$/u;

export type ReportAnswer = Readonly<{ ran: false; why: 'closed' | 'no-agent' | 'read-only' }> | (Readonly<{ ran: true }> & ReportPass);

export async function runAgentReport(env: Env, guard: Readonly<{ store: GuardStore; writes: { allowed: boolean } }>): Promise<ReportAnswer> {
  if (!agentReportSends(env[AGENT_REPORT_SEND_ENV])) return { ran: false, why: 'closed' };
  const gate = mandateGate(env);
  if (!gate.open) return { ran: false, why: 'no-agent' };
  if (!guard.writes.allowed) return { ran: false, why: 'read-only' };
  const named = env[AGENT_SYMBOL_ENV]?.trim() ?? null;
  const read = async (entry: Parameters<Parameters<typeof runReportPass>[0]['read']>[0], since: number, until: number): Promise<ReportRead> => {
    const view = await agentResult({ policy: entry.record.policy, owner: entry.record.owner, since }, gate, { store: guard.store, symbol: named, now: () => until });
    if (!view?.away) return null;
    /* The names that say it: the coin's ticker and SOL in dollars; unread, the report says it without them. */
    const catalog = await fetchTokenCatalog([WRAPPED_SOL_MINT, entry.receiveMint], 5_000).catch(() => null);
    const sol = catalog?.ok ? Number(catalog.byMint[WRAPPED_SOL_MINT]?.usdPrice ?? NaN) : NaN;
    const ticker = view.symbol ?? (catalog?.ok ? (catalog.byMint[entry.receiveMint]?.symbol ?? null) : null);
    return { day: view.away, symbol: ticker && SYMBOL.test(ticker) ? ticker : null, solUsd: Number.isFinite(sol) && sol > 0 ? sol : null };
  };
  const pass = await runReportPass({
    store: guard.store,
    cluster: gate.network,
    clock: Date.now,
    read,
    /* This pass's own deliveries, sent at once through the monitoring delivery — it sees only their rows. */
    deliver: (rows, atMs) => deliverOutbox(onlyRows(guard.store, rows), atMs),
  });
  return { ran: true, ...pass };
}
