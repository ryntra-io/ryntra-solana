/**
 * The pair-currency watch (SOL-L12, Meteora review 22.10 — `docs/research/meteora-2026-10-22/REVIEW.md`): every pair
 * currency Launch trades against on this network — USDC, the community tokens and every checked pair currency the
 * deployment carries (SOL-L11) — read from its mint on each pass and held against the profile first read. A badge Meteora gives a quote token
 * does not bind its issuer, so the issuer may still change the transfer fee, its authorities or its extensions after
 * a market opens; when it does:
 * - the watch reads `CHANGED`, with the fields that changed and since when;
 * - the page of every market on that pair says so (`pairWatch` on the token's read);
 * - each such market's creator gets one note per change (`quote`, `./creator-notes.server.ts`);
 * - new launches on that pair are refused `QUOTE_PAUSED` until the mint reads as before, or the operator accepts the
 *   new profile by naming its fingerprint in `RYNTRA_LAUNCH_QUOTE_ACCEPTED` (`<mint>:<fingerprint>`, comma-separated).
 *
 * A mint that could not be read changes nothing — no answer, an answer with no account, bytes that are not a mint: its
 * watch keeps what it last knew, and says since when it was not read. Reads only; signs nothing.
 */

import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import { quoteAssetsOffered } from "../core/launch/quote-asset.ts";
import type { GuardStore } from "../guard/store.ts";
import { mintProfileChanges, mintProfileLine, mintProfileOf, type MintProfile, type MintProfileField } from "../solana/mint-profile.ts";
import type { LaunchNetwork } from "./config.server.ts";
import { writeCreatorNote } from "./creator-notes.server.ts";
import type { LaunchRecord } from "./flow.server.ts";

const WATCH = "launchQuoteWatch";
const watchKey = (cluster: string, mint: string) => `${cluster}:${mint}`;

/** The operator's acceptance of a changed pair: `<mint>:<fingerprint>` pairs, comma-separated. */
export const QUOTE_ACCEPTED_ENV = "RYNTRA_LAUNCH_QUOTE_ACCEPTED";

export type QuoteWatchRecord = Readonly<{
  cluster: string;
  mint: string;
  symbol: string;
  /** The profile changes are measured against: the first read, or the one the operator accepted. */
  baseline: MintProfile;
  baselineFingerprint: string;
  baselineAt: string;
  /** The profile as last read. */
  current: MintProfile;
  fingerprint: string;
  state: "OK" | "CHANGED";
  /** What differs from the baseline; empty while OK. */
  changes: readonly MintProfileField[];
  /** When the mint was first read as it reads now, changed; null while OK. */
  changedAt: string | null;
  /** The last read that answered. */
  checkedAt: string;
  /** Since when the mint has not been read, while it is not; null after a read that answered. */
  unreadSince: string | null;
  /** The change whose notes have all been written: later passes do not walk the markets again for it. */
  notifiedFingerprint?: string | null;
}>;

/** A profile's fingerprint — what the operator names to accept it. */
export function mintFingerprint(profile: MintProfile): string {
  return createHash("sha256").update(mintProfileLine(profile)).digest("hex").slice(0, 16);
}

/** The `<mint>:<fingerprint>` pairs the operator accepted. */
export function acceptedFingerprints(env: Readonly<Record<string, string | undefined>> = process.env): ReadonlySet<string> {
  return new Set((env[QUOTE_ACCEPTED_ENV] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => /^[1-9A-HJ-NP-Za-km-z]{32,44}:[0-9a-f]{16}$/.test(entry)));
}

/**
 * The watch after one read: `observed` null — the mint was not read, and nothing changes but `unreadSince`. The first
 * read sets the baseline; a read equal to the baseline is OK; a different one is CHANGED, since the first read that
 * showed it — unless the operator accepted it, and then it is the new baseline.
 */
export function nextQuoteWatch(
  before: QuoteWatchRecord | null,
  observed: MintProfile | null,
  args: Readonly<{ cluster: string; mint: string; symbol: string; now: string; accepted: ReadonlySet<string> }>,
): QuoteWatchRecord | null {
  if (!observed) return before ? { ...before, unreadSince: before.unreadSince ?? args.now } : null;
  const fingerprint = mintFingerprint(observed);
  const fresh = { cluster: args.cluster, mint: args.mint, symbol: args.symbol, current: observed, fingerprint, checkedAt: args.now, unreadSince: null, notifiedFingerprint: before?.notifiedFingerprint ?? null };
  if (!before || args.accepted.has(`${args.mint}:${fingerprint}`) || fingerprint === before.baselineFingerprint) {
    const keep = before && fingerprint === before.baselineFingerprint;
    return {
      ...fresh,
      baseline: keep ? before.baseline : observed,
      baselineFingerprint: fingerprint,
      baselineAt: keep ? before.baselineAt : args.now,
      state: "OK",
      changes: [],
      changedAt: null,
    };
  }
  return {
    ...fresh,
    baseline: before.baseline,
    baselineFingerprint: before.baselineFingerprint,
    baselineAt: before.baselineAt,
    state: "CHANGED",
    changes: mintProfileChanges(before.baseline, observed),
    /* The same change read again keeps its time; another change starts its own. */
    changedAt: before.state === "CHANGED" && before.fingerprint === fingerprint ? before.changedAt : args.now,
  };
}

/**
 * Every pair currency Launch trades against on this network, once each: the presets' pairs, the community tokens, and
 * the checked pair currencies this deployment carries (SOL-L11) — a market opened in one of those is watched like any
 * other, because its issuer may change the mint after the launch just as well.
 */
export function networkQuotes(
  network: Pick<LaunchNetwork, "pairs" | "communities">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Readonly<{ mint: string; symbol: string }>[] {
  const seen = new Map<string, string>();
  for (const pair of [...Object.values(network.pairs), ...network.communities]) if (pair && !seen.has(pair.mint)) seen.set(pair.mint, pair.symbol);
  for (const record of quoteAssetsOffered(env)) if (!seen.has(record.mint)) seen.set(record.mint, record.symbol);
  return [...seen].map(([mint, symbol]) => ({ mint, symbol }));
}

export function readQuoteWatch(store: GuardStore, cluster: string, mint: string): Promise<QuoteWatchRecord | null> {
  return store.collection<QuoteWatchRecord>(WATCH).get(watchKey(cluster, mint)).then((watch) => watch ?? null);
}

/** Whether new launches on this pair wait: its mint changed and nobody accepted the change. */
export async function quotePaused(store: GuardStore, cluster: string, mint: string): Promise<boolean> {
  return (await readQuoteWatch(store, cluster, mint))?.state === "CHANGED";
}

type AccountReader = Readonly<{ getMultipleAccountsInfo: (keys: PublicKey[], commitment?: "confirmed") => Promise<readonly (Readonly<{ owner: PublicKey; data: Uint8Array; lamports: number; executable: boolean }> | null)[]> }>;

export type QuoteWatchDeps = Readonly<{
  network: Pick<LaunchNetwork, "cluster" | "pairs" | "communities">;
  connection: AccountReader;
  store: GuardStore;
  now: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
}>;

export type QuoteWatchStep = Readonly<{ mint: string; state: QuoteWatchRecord["state"] | "UNREAD"; changes: readonly MintProfileField[]; notes: number }>;

/**
 * One pass: every pair's mint in one read, each watch moved on, and for each pair that reads CHANGED a note to the
 * creator of every market on it — once per change and market (the note's identity carries the fingerprint), so a pass
 * that stopped half-way writes the rest next time and never a second one.
 */
export async function runQuoteWatch(deps: QuoteWatchDeps, options: Readonly<{ budgetMs?: number }> = {}): Promise<readonly QuoteWatchStep[]> {
  const started = Date.now();
  const cluster = deps.network.cluster;
  const quotes = networkQuotes(deps.network, deps.env ?? process.env);
  if (!quotes.length) return [];
  let accounts: readonly (Parameters<typeof mintProfileOf>[1])[] | null;
  try {
    /* Half the pass's budget at most: a node that hangs leaves the notes of a change, and the creators' notes, their time. */
    const read = deps.connection.getMultipleAccountsInfo(quotes.map((quote) => new PublicKey(quote.mint)), "confirmed");
    let timer: ReturnType<typeof setTimeout> | undefined;
    accounts =
      options.budgetMs === undefined
        ? await read
        : await Promise.race([read, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), options.budgetMs! / 2)))]).finally(() => clearTimeout(timer));
  } catch {
    accounts = null;
  }
  const now = deps.now().toISOString();
  const accepted = acceptedFingerprints(deps.env ?? process.env);
  const watches = deps.store.collection<QuoteWatchRecord>(WATCH);
  const steps: QuoteWatchStep[] = [];
  const changed: QuoteWatchRecord[] = [];
  for (const [index, quote] of quotes.entries()) {
    /*
     * Not answered is not read. Nor is an answer with no account: a node behind or wrong says so for a mint that is there,
     * and a pair's mint with holders cannot be closed — one such answer must not pause launches or write every creator.
     * Bytes that are not a mint are not read either, and never stop the other pairs.
     */
    const account = accounts?.[index] ?? null;
    let observed: MintProfile | null = null;
    try {
      observed = account ? mintProfileOf(quote.mint, account) : null;
    } catch {
      observed = null;
    }
    const before = (await watches.get(watchKey(cluster, quote.mint))) ?? null;
    const next = nextQuoteWatch(before, observed, { cluster, mint: quote.mint, symbol: quote.symbol, now, accepted });
    if (next) await watches.set(watchKey(cluster, quote.mint), next);
    if (next?.state === "CHANGED") changed.push(next);
    steps.push({ mint: quote.mint, state: observed ? (next?.state ?? "OK") : "UNREAD", changes: next?.changes ?? [], notes: 0 });
  }
  /* A change whose notes were all written needs no walk over the markets again. */
  const owed = changed.filter((watch) => watch.notifiedFingerprint !== watch.fingerprint);
  if (!owed.length) return steps;
  const records = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${cluster}:`)).filter((record) => record.state === "LAUNCHED" && record.cluster === cluster);
  const nowMs = deps.now().getTime();
  for (const watch of owed) {
    let notes = 0;
    let whole = true;
    for (const record of records.filter((launch) => launch.pairMint === watch.mint)) {
      if (options.budgetMs !== undefined && Date.now() - started > options.budgetMs) {
        whole = false;
        break;
      }
      const identity = `launch:${cluster}:${record.token}:quote:${watch.mint}:${watch.fingerprint}`;
      const wrote = await writeCreatorNote(deps.store, { owner: record.creator, record, event: "quote", identity, pairSymbol: watch.symbol, nowMs }).catch(() => null);
      if (wrote === null) whole = false;
      else if (wrote) notes += 1;
    }
    if (whole) await watches.set(watchKey(cluster, watch.mint), { ...watch, notifiedFingerprint: watch.fingerprint });
    const at = steps.findIndex((step) => step.mint === watch.mint);
    steps[at] = { ...steps[at]!, notes };
  }
  return steps;
}

/** The watch as a market's page says it: what changed and since when; null while the pair has not been read. */
export function pairWatchView(watch: QuoteWatchRecord | null): Readonly<{ mint: string; symbol: string; state: "OK" | "CHANGED"; changes: MintProfileField[]; since: string | null; checkedAt: string }> | null {
  if (!watch) return null;
  return { mint: watch.mint, symbol: watch.symbol, state: watch.state, changes: [...watch.changes], since: watch.changedAt, checkedAt: watch.checkedAt };
}
