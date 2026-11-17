/**
 * «Вийти з усього» and «Зібрати все»: the overview, the Review that builds one approval, and the relay that
 * sends it.
 *
 * One approval is the person's own wallet signing, once, a package:
 *
 *   the positions left (or their fees collected), the stake accounts' steps, the wallet's coins swapped
 *   → what arrived swapped into the target
 *
 * Every transaction is built by the engine's own builder for that action (`ports.ts`) — the exit adds no instruction and
 * no fee: a swap carries the swap's own fee, leaving a pool or a market carries none. Before a wallet is asked:
 *
 * - every transaction is read from its bytes and held to its rule (`checks.ts`) — the wallet pays, the wallet signs,
 *   money moves only through the venue and back into the wallet's own accounts;
 * - every transaction that stands on the chain as it is now is run against it; a unit the network would refuse is left
 *   out and named. A swap of what a position brings stands on that position's transaction having landed, so it cannot be
 *   run before: it is held by its bytes — the wallet's own accounts, the floor, the cap — and the relay sends it with the
 *   network's own preflight, only after what it stands on has landed;
 * - what stands is sealed in a ticket (`ticket.ts`): the relay sends those bytes and no others.
 *
 * The relay sends in waves — everything that stands alone at once, then what stood on it — each transaction once; an
 * answer that is not clear is read from the chain by signature, never sent again. What did not land is said, step by step.
 *
 * No `server-only` here and no environment but the one handed in: the ports, the chain, the portfolio's read and the
 * clock are arguments, which is what lets the tests prove every branch on recorded answers and built bytes.
 */

import type { AddressLookupTableAccount } from "@solana/web3.js";

import { networkFeeOf } from "../../liquidity/studio/actions.ts";
import { NATIVE_SOL_MINT, USDC_MINT, unitsOf, type PortfolioAnswer, type PortfolioPosition } from "../model.ts";
import { ruleHolds } from "./checks.ts";
import { exitEstimate, exitPlan, type ExitAction, type ExitHeld, type ExitItem, type ExitMode, type ExitTarget } from "./model.ts";
import type { BuiltTx, ExitChain, ExitPorts, ExitSkipReason, UnitBuilt } from "./ports.ts";
import type { ExitRelayState } from "./steps.ts";
import { sweepsOf, type SweepSpec } from "./sweeps.ts";
import { MAX_EXIT_STEPS, MAX_STEP_LOOKUPS, TICKET_TTL_MS, checkExitSigned, exitTicketKeyHere, issueExitTicket, lookupsOf, readExitTicket, stepDigest, type ExitStep, type ExitStepKind } from "./ticket.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The door for people: closed unless the deployment opens it. */
export const PORTFOLIO_EXIT_ENV = "RYNTRA_PORTFOLIO_EXIT";

/** Whether this deployment builds an exit: its own switch, and a key to seal with. */
export function exitOpen(env: Env): boolean {
  return env[PORTFOLIO_EXIT_ENV]?.trim() === "open" && exitTicketKeyHere(env);
}

export type ExitFailureCode = "CLOSED" | "BAD_REQUEST" | "NOTHING_TO_DO" | "UNAVAILABLE" | "TICKET_INVALID" | "TICKET_EXPIRED" | "SIGNED_MISMATCH" | "NOT_SIGNED";
/** A refusal by its code; a route answers it with the contract's own status for that code (`http.server.ts`). */
export type ExitFailure = Readonly<{ ok: false; code: ExitFailureCode; reason: string }>;
const fail = (code: ExitFailureCode, reason: string): ExitFailure => ({ ok: false, code, reason });

export type ExitDeps = Readonly<{
  env: Env;
  ports: ExitPorts;
  chain: ExitChain;
  /** The wallet's portfolio, read now. */
  portfolio: (owner: string) => Promise<PortfolioAnswer>;
  /** A managed order's signed bytes to Jupiter's `/execute`, once. */
  execute: (signed: string, requestId: string) => Promise<Readonly<{ sent: boolean; reason: string | null }>>;
  /** After a relay: what was kept of this wallet no longer holds. */
  forget?: (owner: string) => void;
  now?: () => number;
  relayMs?: number;
  pollMs?: number;
}>;

/* ── the overview ─────────────────────────────────────────────────────── */

export type ExitOverview = Readonly<{
  owner: string;
  mode: ExitMode;
  target: ExitTarget;
  /** Whether this deployment builds the approval; the overview is read either way. */
  canExit: boolean;
  items: readonly ExitItem[];
  held: readonly ExitHeld[];
  /** «≈» of what the picked steps bring, before fees and slippage; nulls where a price did not read. */
  estimate: Readonly<{ usd: number | null; lamports: string | null; usdcRaw: string | null }>;
  solUsd: number | null;
  /** Every source of the portfolio answered: a list that is not complete says so. */
  complete: boolean;
  at: string;
}>;

/** `positions` — the ids the person left on; absent — the plan's own default. */
export type ExitAsk = Readonly<{ owner: string; mode: ExitMode; target: ExitTarget; positions?: readonly string[] | undefined }>;

/** What one approval would do, from the portfolio alone: nothing is built. */
export async function exitOverview(ask: ExitAsk, deps: Pick<ExitDeps, "env" | "portfolio" | "now">): Promise<ExitOverview> {
  const answer = await deps.portfolio(ask.owner);
  const plan = exitPlan(answer, ask.mode, ask.target, { only: ask.positions });
  return {
    owner: ask.owner,
    mode: ask.mode,
    target: ask.target,
    canExit: exitOpen(deps.env),
    items: plan.items.slice(0, 300),
    held: plan.held.slice(0, 300),
    /* Collecting swaps nothing: the fees come as the coins they are, so only their worth is said. */
    estimate: ask.mode === "collect" ? { ...exitEstimate(plan.items, ask.target, answer.solUsd), lamports: null, usdcRaw: null } : exitEstimate(plan.items, ask.target, answer.solUsd),
    solUsd: answer.solUsd,
    complete: answer.sources.every((source) => source.source === "jupiter-portfolio" || source.state === "read" || source.state === "off"),
    at: new Date((deps.now ?? Date.now)()).toISOString(),
  };
}

/* ── the Review ───────────────────────────────────────────────────────── */

export type ExitSummary = Readonly<{
  /** «≈» of what arrives in the target's coins: lamports of SOL, base units of USDC. The rent is apart. */
  receive: Readonly<{ lamports: string; usdcRaw: string }>;
  /** The rent of the accounts the package closes, back as SOL. */
  rentLamports: string;
  /** Ryntra's fee on the swaps — the swap's own, the highest of them, basis points; null — nothing is swapped, or no fee. */
  feeBps: number | null;
  transactions: number;
  /** What the package does, position by position. */
  done: readonly Readonly<{ id: string; action: ExitAction; partBps: number }>[];
  /** Stakes deactivated now: their SOL is free from the epoch named. */
  later: readonly Readonly<{ id: string; untilEpoch: number | null }>[];
  /** Picked, and not in the package: why. */
  skipped: readonly Readonly<{ id: string; reason: ExitSkipReason }>[];
  /** Coins that arrive and stay as they are: by design when only collecting (`reason` null), else why they are not swapped. */
  others: readonly Readonly<{ mint: string; decimals: number; amountRaw: string; reason: ExitSkipReason | null }>[];
  /** What no step takes out, with the portfolio's reason. */
  held: readonly ExitHeld[];
}>;

export type ExitReview = Readonly<{
  owner: string;
  mode: ExitMode;
  target: ExitTarget;
  ticket: string;
  /** The unsigned transactions, in the order the wallet signs them at once. */
  transactions: readonly string[];
  kinds: readonly ExitStepKind[];
  /** For each transaction, the position it acts on, or the mint a sweep swaps. */
  refs: readonly string[];
  expiresAt: string;
  /** How long from arriving the person may still sign, ms. */
  signableMs: number;
  summary: ExitSummary;
}>;

async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next;
        next += 1;
        out[at] = await work(items[at]!);
      }
    }),
  );
  return out;
}

const UNAVAILABLE: UnitBuilt = { ok: false, reason: "UNAVAILABLE" };
const half = (raw: bigint): bigint => raw / 2n;

/** One picked step, asked of the engine's builder for it. */
async function unitOf(position: PortfolioPosition, item: ExitItem, ask: ExitAsk, ports: ExitPorts): Promise<UnitBuilt> {
  const { owner } = ask;
  const { refs } = position;
  switch (position.protocol) {
    case "meteora-dlmm":
    case "meteora-damm-v2":
      if (!refs.position) return { ok: false, reason: "REFUSED" };
      return ports.pool({ owner, venue: position.protocol, position: refs.position, mode: item.action === "collect" ? "collect" : "exit", close: item.partBps === 10_000 });
    case "meteora-dlmm-pro":
      if (!refs.pool || !refs.nftMint) return { ok: false, reason: "REFUSED" };
      return ports.pro({ owner, pool: refs.pool, nftMint: refs.nftMint, mode: item.action === "collect" ? "collect" : "exit" });
    case "jupiter-lend":
      if (!refs.market) return { ok: false, reason: "REFUSED" };
      return ports.lend({ owner, market: refs.market });
    case "native-stake":
      if (!refs.position) return { ok: false, reason: "REFUSED" };
      return ports.stake({ owner, account: refs.position, op: item.action === "deactivate" ? "deactivate" : "withdraw" });
    case "wallet": {
      const coin = position.tokens[0];
      if (!coin || coin.amountRaw === null || coin.decimals === null || coin.amountRaw === "0") return { ok: false, reason: "NOTHING_TO_DO" };
      const swap = (amountRaw: bigint, outMint: string) => ports.swap({ owner, mint: coin.mint, decimals: coin.decimals!, amountRaw: amountRaw.toString(), outMint });
      const all = BigInt(coin.amountRaw);
      if (ask.target !== "SPLIT") return swap(all, ask.target === "SOL" ? NATIVE_SOL_MINT : USDC_MINT);
      /* Half and half: two swaps of the same coin, each standing alone. */
      const [toSol, toUsdc] = await Promise.all([swap(half(all), NATIVE_SOL_MINT), swap(all - half(all), USDC_MINT)]);
      if (!toSol.ok) return toSol;
      if (!toUsdc.ok) return toUsdc;
      const fees = [toSol.feeBps, toUsdc.feeBps].filter((bps): bps is number => bps !== null);
      return { ok: true, txs: [...toSol.txs, ...toUsdc.txs], chained: false, brings: [...toSol.brings, ...toUsdc.brings], rentLamports: toSol.rentLamports + toUsdc.rentLamports, feeBps: fees.length ? Math.max(...fees) : null };
    }
    default:
      return { ok: false, reason: "NO_ROUTE" };
  }
}

const kindOf = (item: ExitItem): ExitStepKind => (item.action === "collect" ? "collect" : item.action === "swap" ? "swap" : item.protocol === "native-stake" ? "stake" : "leave");

/** A unit's price in dollars for each mint the portfolio priced; SOL at the portfolio's own SOL price, USDC at a dollar where no row priced it. */
export function unitPrices(answer: Pick<PortfolioAnswer, "positions" | "solUsd">): Map<string, number> {
  const prices = new Map<string, number>();
  for (const position of answer.positions) {
    if (position.state !== "read" || position.origin === "projection") continue;
    for (const token of position.tokens) {
      if (token.usd === null || token.amountRaw === null || token.decimals === null || prices.has(token.mint)) continue;
      const units = unitsOf(token.amountRaw, token.decimals);
      if (units > 0 && token.usd > 0) prices.set(token.mint, token.usd / units);
    }
  }
  if (answer.solUsd !== null && answer.solUsd > 0) prices.set(NATIVE_SOL_MINT, answer.solUsd);
  if (!prices.has(USDC_MINT)) prices.set(USDC_MINT, 1);
  return prices;
}

type Kept = { item: ExitItem; built: Extract<UnitBuilt, { ok: true }> };

/** Every transaction of a build against its rule, with the tables its bytes name; the first reason it does not hold. */
function txsHold(txs: readonly BuiltTx[], tables: ReadonlyMap<string, AddressLookupTableAccount>, owner: string): ExitSkipReason | null {
  for (const tx of txs) {
    const lookups = lookupsOf(tx.wire);
    if (lookups === null || lookups.length > MAX_STEP_LOOKUPS) return "REFUSED";
    const own = lookups.map((key) => tables.get(key));
    if (own.some((table) => !table)) return "UNAVAILABLE";
    const held = ruleHolds(tx.rule, tx.wire, own as AddressLookupTableAccount[], owner);
    if (!held.ok) {
      console.warn(`portfolio exit review: bytes refused — ${held.reason.slice(0, 200)}`);
      return "REFUSED";
    }
  }
  return null;
}

const lookupsOfAll = (txs: readonly BuiltTx[]): string[] => txs.flatMap((tx) => lookupsOf(tx.wire) ?? []);

/**
 * One approval, built: the portfolio read now, what the person took in and out, each unit from the engine's own
 * builder, checked and run against the chain, the swaps into the target, and the seal. What is not in the package is
 * named, with why.
 */
export async function reviewExit(ask: ExitAsk, deps: ExitDeps): Promise<Readonly<{ ok: true; value: ExitReview }> | ExitFailure> {
  const now = deps.now ?? Date.now;
  if (!exitOpen(deps.env)) return fail("CLOSED", "Leaving positions in one approval is not served here.");
  const { ports, chain } = deps;
  try {
    const answer = await deps.portfolio(ask.owner);
    const plan = exitPlan(answer, ask.mode, ask.target, { only: ask.positions });
    const picked = plan.items.filter((item) => item.picked);
    if (picked.length === 0) return fail("NOTHING_TO_DO", ask.mode === "collect" ? "There is nothing to collect in this wallet's pools." : "Nothing in this wallet leaves in one step now.");
    const positions = new Map(answer.positions.map((position) => [position.id, position]));
    const skipped: { id: string; reason: ExitSkipReason }[] = [];

    /* Each unit from its builder; one that falls is its own «not now», never the whole package's. */
    const builds = await mapLimit(picked, 4, (item) => unitOf(positions.get(item.id)!, item, ask, ports).catch(() => UNAVAILABLE));
    const unitTables = await chain.tables([...new Set(builds.flatMap((built) => (built.ok ? lookupsOfAll(built.txs) : [])))]);
    let kept: Kept[] = [];
    await mapLimit(
      picked.map((item, index) => ({ item, built: builds[index]! })),
      4,
      async ({ item, built }) => {
        if (!built.ok) return void skipped.push({ id: item.id, reason: built.reason });
        if (built.txs.length === 0) return void skipped.push({ id: item.id, reason: "NOTHING_TO_DO" });
        const off = txsHold(built.txs, unitTables, ask.owner);
        if (off) return void skipped.push({ id: item.id, reason: off });
        /* What stands on the chain as it is: a chain's first transaction, or each of those that stand alone. */
        const alone = built.chained ? built.txs.slice(0, 1) : built.txs;
        const runs = await Promise.all(alone.map((tx) => chain.simulate(tx.wire).catch(() => false)));
        if (runs.some((ran) => !ran)) return void skipped.push({ id: item.id, reason: "SIMULATION_FAILED" });
        kept.push({ item, built });
      },
    );
    /* The portfolio's own order — biggest first — so that what does not fit is the smallest. */
    const order = new Map(picked.map((item, index) => [item.id, index]));
    kept.sort((a, b) => order.get(a.item.id)! - order.get(b.item.id)!);

    /* What the left positions bring is swapped into the target; collecting swaps nothing. */
    const specsOf = (units: readonly Kept[]): SweepSpec[] =>
      ask.mode === "exit" ? sweepsOf(units.map((unit) => (unit.item.action === "leave" ? unit.built.brings : [])), ask.target, answer.solUsd) : [];
    let specs = specsOf(kept);
    while (kept.length > 0 && kept.reduce((sum, unit) => sum + unit.built.txs.length, 0) + specs.length > MAX_EXIT_STEPS) {
      const last = kept[kept.length - 1]!;
      skipped.push({ id: last.item.id, reason: "NO_ROOM" });
      kept = kept.slice(0, -1);
      specs = specsOf(kept);
    }
    /*
     * A coin that is swapped from the wallet and also arrives from a position: the sweep takes what stands above the
     * wallet's balance at the Review, which the wallet's own swap would spend from under it. The sweep goes; the
     * wallet's coin waits for the next approval.
     */
    const swept = new Set(specs.map((spec) => spec.inMint));
    const clash = kept.filter((unit) => unit.item.action === "swap" && swept.has(positions.get(unit.item.id)?.tokens[0]?.mint ?? ""));
    if (clash.length > 0) {
      for (const unit of clash) skipped.push({ id: unit.item.id, reason: "NO_ROOM" });
      kept = kept.filter((unit) => !clash.includes(unit));
      specs = specsOf(kept);
    }
    if (kept.length === 0) return fail("NOTHING_TO_DO", "Nothing could be built for one approval now.");
    /* A fixed swap of SOL is sent only while the wallet holds what it holds now and what the swap wraps: read now, or no such swap. */
    const heldLamports = specs.some((spec) => spec.wrapLamports !== null) ? await chain.lamports(ask.owner).catch(() => null) : null;

    const prices = unitPrices(answer);
    const sweepBuilds = await mapLimit(specs, 4, (spec) => ports.sweep({ owner: ask.owner, spec, inUsd: prices.get(spec.inMint) ?? null, outUsd: prices.get(spec.outMint) ?? null }).catch(() => UNAVAILABLE));
    const sweepTables = await chain.tables([...new Set(sweepBuilds.flatMap((built) => (built.ok ? lookupsOfAll(built.txs) : [])))]);
    const sweepOff: (ExitSkipReason | null)[] = sweepBuilds.map((built, index) => {
      if (!built.ok) return built.reason;
      if (specs[index]!.wrapLamports !== null && heldLamports === null) return "UNAVAILABLE";
      return built.txs.length === 1 ? txsHold(built.txs, sweepTables, ask.owner) : "REFUSED";
    });
    /* A second leg stands on its first: without the first it is not sent, so it is not built in. */
    specs.forEach((spec, index) => {
      if (spec.after !== null && sweepOff[spec.after] !== null && sweepOff[index] === null) sweepOff[index] = sweepOff[spec.after]!;
    });

    /* The package, in the order the wallet signs it. */
    type Entry = { kind: ExitStepKind; ref: string; tx: BuiltTx; all: number[]; any: number[]; need: string | null };
    const entries: Entry[] = [];
    const lastOf: number[] = [];
    kept.forEach((unit, at) => {
      unit.built.txs.forEach((tx, index) => {
        entries.push({ kind: kindOf(unit.item), ref: unit.item.id, tx, all: unit.built.chained && index > 0 ? [entries.length - 1] : [], any: [], need: null });
      });
      lastOf[at] = entries.length - 1;
    });
    const sweepAt: (number | null)[] = specs.map(() => null);
    specs.forEach((spec, index) => {
      const built = sweepBuilds[index]!;
      if (sweepOff[index] !== null || !built.ok) return;
      const feeders = spec.feeders.map((unit) => lastOf[unit]!);
      const first = spec.after === null ? [] : [sweepAt[spec.after]!];
      /* A fixed swap of SOL spends the wallet's own SOL: every position that brings it must have landed, and the SOL must be there. */
      const fixed = spec.wrapLamports !== null && heldLamports !== null;
      entries.push({ kind: "sweep", ref: spec.inMint, tx: built.txs[0]!, all: fixed ? [...feeders, ...first] : first, any: fixed ? [] : feeders, need: null });
      sweepAt[index] = entries.length - 1;
    });
    /*
     * What the wallet must hold for a fixed swap of SOL to be sent: what it holds now, the SOL the swap wraps and the
     * rent the package brings back (rent is not the SOL that was to arrive) — less the network's fees for the whole
     * package, which the wallet pays out of the same lamports.
     */
    const packageFees = entries.reduce((sum, entry) => sum + networkFeeOf(entry.tx.wire), 0n);
    const rentBack = kept.reduce((sum, unit) => sum + unit.built.rentLamports, 0n);
    specs.forEach((spec, index) => {
      const at = sweepAt[index];
      if (at === null || at === undefined || spec.wrapLamports === null || heldLamports === null) return;
      const need = heldLamports + spec.wrapLamports + rentBack - packageFees;
      entries[at]!.need = (need > 0n ? need : 0n).toString();
    });

    const tables = new Map([...unitTables, ...sweepTables]);
    const steps: ExitStep[] = [];
    for (const entry of entries) {
      const lookups = lookupsOf(entry.tx.wire) ?? [];
      const digest = stepDigest(entry.tx.wire, lookups.map((key) => tables.get(key)!));
      if (!digest) return fail("UNAVAILABLE", "A transaction could not be read back; nothing was built.");
      steps.push({ kind: entry.kind, ref: entry.ref, digest, lookups, requestId: entry.tx.requestId, all: entry.all, any: entry.any, needLamports: entry.need });
    }
    const issuedAt = now();
    const ticket = issueExitTicket({ owner: ask.owner, mode: ask.mode, steps }, deps.env, issuedAt);
    if (!ticket) return fail("UNAVAILABLE", "This server cannot seal the approval; nothing was built.");
    const signableMs = await chain.signableMs().catch(() => 0);

    /* What arrives: the units' own coins, less what the sweeps take of them, with what the sweeps bring. */
    const arrives = new Map<string, { decimals: number; raw: bigint }>();
    const move = (mint: string, decimals: number, raw: bigint) => {
      const seen = arrives.get(mint) ?? { decimals, raw: 0n };
      arrives.set(mint, { decimals: seen.decimals, raw: seen.raw + raw });
    };
    for (const unit of kept) for (const bring of unit.built.brings) move(bring.mint, bring.decimals, bring.expectedRaw);
    const notSwapped = new Map<string, ExitSkipReason>();
    const fees: number[] = kept.flatMap((unit) => (unit.built.feeBps === null ? [] : [unit.built.feeBps]));
    specs.forEach((spec, index) => {
      const built = sweepBuilds[index]!;
      if (sweepAt[index] === null || !built.ok) {
        if (spec.inMint !== NATIVE_SOL_MINT && spec.inMint !== USDC_MINT) notSwapped.set(spec.inMint, sweepOff[index] ?? "UNAVAILABLE");
        return;
      }
      move(spec.inMint, spec.inDecimals, -spec.expectedRaw);
      for (const bring of built.brings) move(bring.mint, bring.decimals, bring.expectedRaw);
      if (built.feeBps !== null) fees.push(built.feeBps);
    });
    const amount = (mint: string): string => {
      const raw = arrives.get(mint)?.raw ?? 0n;
      return (raw > 0n ? raw : 0n).toString();
    };
    const others = [...arrives]
      .filter(([mint, coin]) => mint !== NATIVE_SOL_MINT && mint !== USDC_MINT && coin.raw > 0n)
      .map(([mint, coin]) => ({ mint, decimals: coin.decimals, amountRaw: coin.raw.toString(), reason: ask.mode === "collect" ? null : (notSwapped.get(mint) ?? "TOO_SMALL") }));

    return {
      ok: true,
      value: {
        owner: ask.owner,
        mode: ask.mode,
        target: ask.target,
        ticket,
        transactions: entries.map((entry) => entry.tx.wire),
        kinds: entries.map((entry) => entry.kind),
        refs: entries.map((entry) => entry.ref),
        expiresAt: new Date(issuedAt + TICKET_TTL_MS).toISOString(),
        signableMs: Math.max(0, Math.min(signableMs, TICKET_TTL_MS)),
        summary: {
          receive: { lamports: amount(NATIVE_SOL_MINT), usdcRaw: amount(USDC_MINT) },
          rentLamports: kept.reduce((sum, unit) => sum + unit.built.rentLamports, 0n).toString(),
          feeBps: fees.length ? Math.max(...fees) : null,
          transactions: entries.length,
          done: kept.map((unit) => ({ id: unit.item.id, action: unit.item.action, partBps: unit.item.partBps })),
          later: kept.filter((unit) => unit.item.action === "deactivate").map((unit) => ({ id: unit.item.id, untilEpoch: unit.item.untilEpoch })),
          skipped: skipped.slice(0, 100),
          others: others.slice(0, 50),
          held: plan.held.slice(0, 300),
        },
      },
    };
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
}

/* ── the relay ────────────────────────────────────────────────────────── */

export const EXIT_RELAY_MS = 50_000;
const CALL_MS = 8_000;

export type ExitRelay = Readonly<{
  results: readonly Readonly<{ kind: ExitStepKind; ref: string; signature: string; state: ExitRelayState; reason: string | null }>[];
  /** Every transaction landed. */
  settled: boolean;
}>;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const firstLine = (error: unknown): string => (error instanceof Error ? error.message.split("\n")[0]!.replace(/https?:\/\/[^\s"')]+/g, "<endpoint>").slice(0, 200) : "refused");

async function landed(chain: ExitChain, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  while (Date.now() < deadline) {
    const status = await chain.status(signature, Math.min(CALL_MS, Math.max(1, deadline - Date.now()))).catch(() => undefined);
    if (status?.err) return { state: "FAILED", reason: JSON.stringify(status.err).slice(0, 200) };
    if (status?.confirmed) return { state: "LANDED", reason: null };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { state: "UNKNOWN", reason: null };
}

/**
 * The wallet's signed bytes: held to the ticket, then sent once each — everything that stands alone at once, and each
 * transaction that stands on others as soon as they have landed. A step whose own did not land is not sent, and says
 * so. Nothing is sent twice: an answer that is not a clear refusal is read from the chain by signature.
 */
export async function submitExit(body: unknown, deps: ExitDeps): Promise<Readonly<{ ok: true; value: ExitRelay }> | ExitFailure> {
  const now = deps.now ?? Date.now;
  if (!body || typeof body !== "object") return fail("BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;
  if (!Array.isArray(signed)) return fail("BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  if (!exitOpen(deps.env)) return fail("CLOSED", "Leaving positions in one approval is not served here.");
  const read = readExitTicket(sealed, deps.env, now());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? fail("TICKET_EXPIRED", "The approval is older than its transactions; review again.") : fail("TICKET_INVALID", "The ticket is not one this server sealed.");
  const { ticket } = read;
  const { chain } = deps;
  /* The relay's whole time starts here: everything after fits inside the route's own minute. */
  const deadline = Date.now() + (deps.relayMs ?? EXIT_RELAY_MS);
  const tables = await chain.tables([...new Set(ticket.steps.flatMap((step) => step.lookups))]).catch(() => null);
  if (!tables) return fail("UNAVAILABLE", "The chain did not answer for the approval's lookup tables. Nothing was sent.");
  const checked = checkExitSigned(ticket, signed, tables);
  if (!checked.ok) return fail(checked.code, checked.code === "NOT_SIGNED" ? "The wallet's signature is missing or does not match." : "The signed bytes are not the ones the Review built.");

  const pollMs = deps.pollMs ?? 1_500;
  const left = () => Math.max(1, deadline - Date.now());
  const results: { kind: ExitStepKind; ref: string; signature: string; state: ExitRelayState; reason: string | null }[] = ticket.steps.map((step, index) => ({ kind: step.kind, ref: step.ref, signature: checked.signatures[index]!, state: "NOT_SENT", reason: null }));

  /** One transaction, once: true when the network may have taken it. */
  const sendOne = async (index: number): Promise<boolean> => {
    const step = ticket.steps[index]!;
    const wire = checked.wires[index]!;
    if (step.requestId) {
      const answer = await within(deps.execute(wire, step.requestId), left()).catch((error: unknown) => ({ sent: true, reason: firstLine(error) }));
      results[index]!.reason = answer.reason;
      return answer.sent;
    }
    try {
      await chain.send(wire, Math.min(CALL_MS, left()));
      return true;
    } catch (error) {
      /* The endpoint's words may stand on a later line: the whole of them is read, the first line is shown. */
      const whole = error instanceof Error ? error.message : "";
      /* The same bytes sent before are on the chain or on their way: read back like any other send. */
      if (/already been processed|AlreadyProcessed/i.test(whole)) return true;
      /* A preflight refusal means the network never took the bytes; anything else may have landed and is read back. */
      if (/simulation failed|preflight|blockhash not found/i.test(whole)) {
        results[index]!.reason = firstLine(error);
        return false;
      }
      return true;
    }
  };

  /*
   * Each step goes as soon as what it stands on has its answer — never before, and never held back by a step it does
   * not stand on. A ticket's step names only earlier steps, so this always ends.
   */
  const runs = new Map<number, Promise<void>>();
  const run = (index: number): Promise<void> => {
    const known = runs.get(index);
    if (known) return known;
    const step = ticket.steps[index]!;
    const going = (async () => {
      await Promise.all([...step.all, ...step.any].map(run));
      const stands = step.all.every((at) => results[at]!.state === "LANDED") && (step.any.length === 0 || step.any.some((at) => results[at]!.state === "LANDED"));
      if (!stands) {
        results[index]!.reason = "What this step stands on did not land; it was not sent.";
        return;
      }
      if (Date.now() >= deadline) return;
      if (step.needLamports !== null) {
        /*
         * The SOL this swap wraps must have arrived: with less in the wallet it would spend SOL held before. Not read is
         * not sent. An endpoint a moment behind the one that confirmed is asked again, a few times.
         */
        const need = BigInt(step.needLamports);
        let held: bigint | null = null;
        for (let tries = 0; tries < 3 && Date.now() < deadline; tries += 1) {
          held = await within(chain.lamports(ticket.owner), Math.min(CALL_MS, left())).catch(() => null);
          if (held !== null && held >= need) break;
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
        if (held === null || held < need) {
          results[index]!.reason = held === null ? "The wallet's SOL could not be read; the swap was not sent." : "Less SOL arrived than this swap wraps; it was not sent.";
          return;
        }
      }
      if (!(await sendOne(index))) return;
      const answer = await landed(chain, results[index]!.signature, deadline, pollMs);
      results[index]!.state = answer.state;
      results[index]!.reason = answer.reason ?? results[index]!.reason;
    })();
    runs.set(index, going);
    return going;
  };
  await Promise.all(ticket.steps.map((_, index) => run(index)));
  for (const result of results) if (result.state === "NOT_SENT" && result.reason === null) result.reason = "Not sent.";
  deps.forget?.(ticket.owner);
  console.info(`portfolio exit relay: ${ticket.mode} ${results.map((result) => `${result.kind}:${result.signature.slice(0, 8)}=${result.state}`).join(" ")}`);
  return { ok: true, value: { results: results.map((result) => ({ ...result, reason: result.reason?.slice(0, 240) ?? null })), settled: results.every((result) => result.state === "LANDED") } };
}
