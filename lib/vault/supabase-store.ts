import type { Title, VaultId } from "./levels";
import { VaultStoreUnavailable, type Crack, type Cracked, type FeedEntry, type Progress, type Take, type VaultStore, type Window } from "./store";

/**
 * The vault in the database: one call to one `public.vault_*` function per question, each gated by the app secret and
 * each one transaction (`supabase/migrations/20261027200000_vault_v1.sql`). Every server instance reads and writes the
 * same rows, so the limits hold across instances, a crack is recorded once however many arrive at once, and the feed
 * is one feed. The transport is the server's usual one (`rpcResult`, which adds the secret); a test passes its own.
 */

export type VaultRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const WINDOW_NAMES = ["minute", "day"] as const;

function progressOf(value: unknown, fn: string): Progress {
  if (!isRecord(value) || !isRecord(value.cracked) || !Array.isArray(value.dailyDays) || !isCount(value.points)) throw new VaultStoreUnavailable(`${fn}: no progress`);
  return {
    cracked: Object.fromEntries(Object.entries(value.cracked).filter(([, day]) => typeof day === "string")) as Partial<Record<VaultId, string>>,
    dailyDays: value.dailyDays.filter((d): d is string => typeof d === "string"),
    points: value.points,
    title: value.title === "breaker" ? (value.title as Title) : null,
  };
}

const windowsArg = (windows: readonly Window[]) => windows.map((w) => ({ name: w.name, ms: w.ms, limit: w.limit }));

export function createSupabaseVaultStore(rpc: VaultRpc): VaultStore {
  /** One call; a transport failure, a refusal or a malformed answer is `VaultStoreUnavailable`. */
  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new VaultStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new VaultStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new VaultStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }

  return {
    durable: true,

    async take(key, windows, now): Promise<Take> {
      const data = await call("vault_take", { p_key: key, p_windows: windowsArg(windows), p_now: iso(now) });
      if (data.allowed === true && typeof data.ticket === "string" && isRecord(data.left)) {
        const left = data.left;
        if (windows.every((w) => isCount(left[w.name]))) return { ok: true, ticket: data.ticket, left: left as Record<Window["name"], number> };
      }
      if (data.allowed === false && WINDOW_NAMES.includes(data.window as Window["name"]) && isCount(data.retryAfterS)) {
        return { ok: false, window: data.window as Window["name"], retryAfterS: Math.max(1, Math.ceil(data.retryAfterS)) };
      }
      throw new VaultStoreUnavailable("vault_take: unreadable");
    },

    async giveBack(key, ticket) {
      await call("vault_give_back", { p_key: key, p_ticket: ticket });
    },

    async left(key, windows, now) {
      const data = await call("vault_left", { p_key: key, p_windows: windowsArg(windows), p_now: iso(now) });
      const left = isRecord(data.left) ? data.left : {};
      return Object.fromEntries(
        windows.map((w) => {
          const one = left[w.name];
          if (!isRecord(one) || !isCount(one.left) || !isCount(one.resetS)) throw new VaultStoreUnavailable("vault_left: unreadable");
          return [w.name, { left: one.left, resetS: one.resetS }];
        }),
      ) as Record<Window["name"], { left: number; resetS: number }>;
    },

    async progress(who) {
      const data = await call("vault_progress", { p_who: who });
      return progressOf(data.progress, "vault_progress");
    },

    async crack(who, crack: Crack, now): Promise<Cracked> {
      const data = await call("vault_crack", {
        p_who: who, p_vault: crack.vault, p_day: crack.day, p_points: crack.points, p_title: crack.title, p_keep_days: crack.keepDays, p_now: iso(now),
      });
      if (typeof data.recorded !== "boolean") throw new VaultStoreUnavailable("vault_crack: unreadable");
      return { recorded: data.recorded, title: data.recorded && data.title === "breaker" ? "breaker" : null, progress: progressOf(data.progress, "vault_crack") };
    },

    async push(entry: FeedEntry) {
      await call("vault_push", {
        p_id: entry.id, p_vault: entry.vault, p_at: entry.at, p_who_tag: entry.who, p_outcome: entry.outcome,
        p_reply: entry.reply, p_pressure: entry.pressure, p_attempt: entry.attempt,
      });
    },

    async feed(vault, limit, before) {
      const data = await call("vault_feed", { p_vault: vault, p_limit: limit, p_before: before ?? null });
      if (!Array.isArray(data.entries)) throw new VaultStoreUnavailable("vault_feed: unreadable");
      return data.entries.filter(isRecord).map((e) => ({
        id: String(e.id),
        vault: e.vault as VaultId,
        at: String(e.at),
        who: String(e.who),
        outcome: e.outcome as FeedEntry["outcome"],
        reply: typeof e.reply === "string" ? e.reply : null,
        pressure: isCount(e.pressure) ? e.pressure : 0,
        attempt: typeof e.attempt === "string" ? e.attempt : "",
      }));
    },

    async answer(key, now) {
      const data = await call("vault_answer", { p_key: key, p_now: iso(now) });
      return data.body ?? null;
    },

    async keepAnswer(key, body, now) {
      await call("vault_keep_answer", { p_key: key, p_body: body, p_now: iso(now) });
    },
  };
}
