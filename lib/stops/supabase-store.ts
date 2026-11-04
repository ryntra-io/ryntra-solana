import { STOP_ID, type EngineStop, type StopState } from "./model.ts";
import { StopsStoreUnavailable, type StopsStore } from "./store.ts";

/**
 * Stops in the database: one call to one `public.spot_stops_*` function per question, each gated by the app secret and
 * each one transaction (`supabase/migrations/20261029200000_spot_stops_v1.sql`). Every server instance and every cron
 * pass reads and writes the same rows, so a wallet's limit holds across instances and a stop is reached once. The
 * transport is the server's usual one (`rpcResult`, which adds the secret); a test passes its own.
 */

export type StopsRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const isMs = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const msOrNull = (value: unknown): number | null => (isMs(value) ? value : null);
const STATES: ReadonlySet<string> = new Set(["watching", "reached", "done", "cancelled", "expired"]);
const RAW = /^\d{1,40}$/;

function coin(value: unknown): { mint: string; symbol: string; decimals: number; name?: string } | null {
  if (!isRecord(value) || typeof value.mint !== "string" || typeof value.symbol !== "string" || typeof value.decimals !== "number") return null;
  return { mint: value.mint, symbol: value.symbol, decimals: value.decimals, ...(typeof value.name === "string" ? { name: value.name } : {}) };
}

/** A row as the function wrote it, or null for anything that is not exactly a stop: it is left out, never guessed at. */
export function stopOfRow(value: unknown): EngineStop | null {
  if (!isRecord(value)) return null;
  const base = coin(value.base);
  const quote = coin(value.quote);
  if (!base || !quote || typeof value.id !== "string" || !STOP_ID.test(value.id) || typeof value.owner !== "string") return null;
  if ((value.side !== "buy" && value.side !== "sell") || typeof value.state !== "string" || !STATES.has(value.state)) return null;
  if (typeof value.amountRaw !== "string" || !RAW.test(value.amountRaw) || typeof value.thresholdRaw !== "string" || !RAW.test(value.thresholdRaw) || typeof value.price !== "string") return null;
  if (!isMs(value.createdAt) || !isMs(value.updatedAt)) return null;
  return {
    id: value.id,
    owner: value.owner,
    side: value.side,
    base: { mint: base.mint, symbol: base.symbol, decimals: base.decimals, name: base.name ?? base.symbol },
    quote: { mint: quote.mint, symbol: quote.symbol, decimals: quote.decimals },
    amountRaw: value.amountRaw,
    price: value.price,
    thresholdRaw: value.thresholdRaw,
    locale: value.locale === "uk" ? "uk" : "en",
    createdAt: value.createdAt,
    expiresAt: msOrNull(value.expiresAt),
    state: value.state as StopState,
    reachedAt: msOrNull(value.reachedAt),
    reachedOutRaw: typeof value.reachedOutRaw === "string" && RAW.test(value.reachedOutRaw) ? value.reachedOutRaw : null,
    updatedAt: value.updatedAt,
  };
}

const stopsOf = (data: Answer, fn: string): EngineStop[] => {
  if (!Array.isArray(data.stops)) throw new StopsStoreUnavailable(`${fn}: unreadable`);
  return data.stops.map(stopOfRow).filter((stop): stop is EngineStop => stop !== null);
};

export function createSupabaseStopsStore(rpc: StopsRpc): StopsStore {
  /** One call; a transport failure, a refusal or a malformed answer is `StopsStoreUnavailable`. */
  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new StopsStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new StopsStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new StopsStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }

  const one = (data: Answer, fn: string): EngineStop | null => {
    if (data.stop === null) return null;
    const stop = stopOfRow(data.stop);
    if (!stop) throw new StopsStoreUnavailable(`${fn}: unreadable`);
    return stop;
  };

  return {
    durable: true,

    async list(owner, now) {
      return stopsOf(await call("spot_stops_list", { p_owner: owner, p_now: iso(now) }), "spot_stops_list");
    },

    async create(stop, max, now) {
      const data = await call("spot_stops_create", { p_stop: stop, p_max: max, p_now: iso(now) });
      if (data.created === true) return { ok: true };
      if (data.created === false && (data.reason === "limit" || data.reason === "taken")) return { ok: false, reason: data.reason };
      throw new StopsStoreUnavailable("spot_stops_create: unreadable");
    },

    async cancel(owner, id, now) {
      return one(await call("spot_stops_cancel", { p_owner: owner, p_id: id, p_now: iso(now) }), "spot_stops_cancel");
    },

    async finish(owner, id, now) {
      return one(await call("spot_stops_finish", { p_owner: owner, p_id: id, p_now: iso(now) }), "spot_stops_finish");
    },

    async due(now, limit) {
      return stopsOf(await call("spot_stops_due", { p_now: iso(now), p_limit: limit }), "spot_stops_due");
    },

    async reach(id, outRaw, now) {
      const data = await call("spot_stops_reach", { p_id: id, p_out_raw: outRaw, p_now: iso(now) });
      if (typeof data.reached !== "boolean") throw new StopsStoreUnavailable("spot_stops_reach: unreadable");
      return data.reached;
    },

    async untold(limit) {
      return stopsOf(await call("spot_stops_untold", { p_limit: limit }), "spot_stops_untold");
    },

    async told(id, now) {
      await call("spot_stops_told", { p_id: id, p_now: iso(now) });
    },

    async expire(now, limit) {
      const data = await call("spot_stops_expire", { p_now: iso(now), p_limit: limit });
      return typeof data.expired === "number" ? data.expired : 0;
    },
  };
}
