import type { CopyRecord, StrategyPoint } from './captain.ts';
import { CaptainStoreUnavailable, copyOfRow, PENDING_MAX, pointOfRow, REPORTS_PER_DAY, type CaptainStore, type ReportState } from './captain-store.ts';

/**
 * «Like the Captain»'s ledger in the database: one call to one `public.city_captain_*` function per question, each gated
 * by the app secret and each one transaction (`supabase/migrations/20261031120000_city_earn_captain_v1.sql`). The
 * transport is the server's usual one (`rpcResult`, which adds the secret); a test passes its own.
 */

export type CaptainRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

async function ask(rpc: CaptainRpc, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const answer = await rpc(fn, args);
  if (!answer.ok) throw new CaptainStoreUnavailable(`${fn}: ${answer.error}`);
  if (!isRecord(answer.data) || answer.data.ok !== true) throw new CaptainStoreUnavailable(`${fn}: unreadable answer`);
  return answer.data;
}

export function createSupabaseCaptainStore(rpc: CaptainRpc): CaptainStore {
  return {
    durable: true,
    async report(copy: CopyRecord, now: number): Promise<ReportState> {
      const data = await ask(rpc, 'city_captain_report', { p_copy: copy, p_max: REPORTS_PER_DAY, p_pending_max: PENDING_MAX, p_now: iso(now) });
      const state = data.state;
      if (state !== 'added' && state !== 'known' && state !== 'limit') throw new CaptainStoreUnavailable('city_captain_report: unreadable state');
      return state;
    },
    async copies(): Promise<CopyRecord[]> {
      const data = await ask(rpc, 'city_captain_copies', {});
      if (!Array.isArray(data.copies)) throw new CaptainStoreUnavailable('city_captain_copies: no list');
      return data.copies.map(copyOfRow).filter((copy): copy is CopyRecord => copy !== null);
    },
    async save(updated, dropped, now) {
      if (!updated.length && !dropped.length) return;
      await ask(rpc, 'city_captain_save', { p_updated: updated, p_dropped: dropped, p_now: iso(now) });
    },
    async putPoints(points: readonly StrategyPoint[]) {
      if (!points.length) return;
      await ask(rpc, 'city_captain_points_put', { p_points: points });
    },
    async points(since: string): Promise<StrategyPoint[]> {
      const data = await ask(rpc, 'city_captain_points', { p_since: since });
      if (!Array.isArray(data.points)) throw new CaptainStoreUnavailable('city_captain_points: no list');
      return data.points.map(pointOfRow).filter((point): point is StrategyPoint => point !== null);
    },
  };
}
