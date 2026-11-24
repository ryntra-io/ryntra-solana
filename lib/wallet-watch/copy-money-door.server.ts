/**
 * «Повторюй за гаманцем» with money, in the product: the door of her copy's routes
 * (`app/api/wallet-watch/copy/money/**`) and what each verb does behind it.
 *
 * The door, in this order, for every verb:
 * 1. **the switch** — for the verbs that put money to work only (her review, her start, its finish): the deployment's
 *    `RYNTRA_AGENT_COPY=on` with the start wired (`copyMoneyOpen`) and the agent's mandate open on mainnet
 *    (`../mandate/service.server.ts` `mandateGate`); closed — `MONEY_CLOSED`, and nothing is read: no body, no proof, no
 *    store, no chain. **her way out never asks it** — her stop, her signed stop and her
 *    freeze (`COPY_EXIT_VERBS`) hang on the book's row, or the server's record of her review, and her wallet's proof alone;
 * 2. **the site** — a browser's request from another origin is refused (403); a request with a bearer is the phone's;
 * 3. **her wallet's proof for a change** (`requireWalletProof(…, "mutation")`, the same as her agents' and her care's
 *    doors — `../mandate/http.server.ts` `ownerProof`): 401 without one, 403 for another wallet than the body names;
 * 4. **a store that keeps the book** — a store that does not survive a cold start, or a deployment that writes nothing,
 *    answers 503.
 *
 * The verbs never sign: the server holds no key of hers, and the agent's key is the cron's (`./copy-money-minute.server.ts`).
 * - `reviewMoneyCopy` — her unsigned transactions (one approval): a new smart account of her own, the budget, the agent's
 *   SOL, the buy's policy and a sale's policy for each group of the leader's coins (`reviewCopyEnable`); the record is kept
 *   by the server under the review's name;
 * - `startMoneyCopy` — her start written as under way (`writeCopyPending`), her signed transactions relayed, then into the
 *   book **only the record the server kept** for that review, checked against the chain (`registerCopy`) — never a row the
 *   client sent. A start that landed only in part stays listed as unfinished, to finish or to take home;
 * - `finishMoneyCopy` — her transactions for what of her start is not on chain yet (`reviewCopyFinish`);
 * - `stopMoneyCopy` — her copy frozen, then her stop's transactions: the first takes every policy off and the budget home,
 *   then the coins, then the emptied accounts; a coin that cannot move is named with its reason (`reviewCopyStop`).
 *   An unfinished start, with no row in the book, is stopped from the server's record of her review;
 * - `sendMoneyCopyStop` — her signed stop relayed, each transaction on its own after the first; then what still stands is
 *   read (`copyStanding`): the copy marked stopped once its buy's policy is gone, and «the rest» kept while anything stands;
 * - `freezeMoneyCopy` — her switch over the copy's new orders (`setCopyFrozen`).
 * Each verb finds her copy by its policy and acts only when the book — or her review's record — names her wallet as its owner.
 */

import { PublicKey, type Connection } from "@solana/web3.js";
import { z } from "zod";

import { storeSurvivesColdStart, type GuardStore } from "../guard/store.ts";
import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";
import { ownerProof, type ProveOwner } from "../mandate/http.server.ts";
import { mandateGate, registryAgent, relayMandate, type DayCoins, type MandateGate } from "../mandate/service.server.ts";
import { NATIVE_MINT } from "../mandate/ssa.ts";
import { COPY_COINS_MAX } from "../mandate/terms.ts";
import { mutationOriginAllowed } from "../security.ts";
import { COPY_BOUNDS, COPY_MONEY_ENV, COPY_SHARES, copyBudgetIssue, copyBudgetOf, copyMoneyOpen, solOf } from "./copy-agent.ts";
import { copyDayOf, copyDaySpent, leaderCoins, type CopyMoneyRow } from "./copy-money.ts";
import {
  COPY_MONEY_PER_OWNER,
  COPY_PENDING_SETTLE_MS,
  COPY_STOP_CLOSE_TRANSACTIONS,
  COPY_STOP_COIN_TRANSACTIONS,
  changeCopyRow,
  copyAccountHers,
  copySettingsHers,
  copyStanding,
  dropCopyPending,
  listCopyPending,
  listCopyRows,
  markCopyPending,
  readCopyPending,
  readCopyReview,
  readCopyRow,
  registerCopy,
  reviewCopyEnable,
  reviewCopyFinish,
  reviewCopyStop,
  setCopyFrozen,
  writeCopyPending,
  type CopyPending,
} from "./copy-money.server.ts";
import { readActivity } from "./store.ts";

type Env = Readonly<Record<string, string | undefined>>;

/* ------------------------------------------------------------- the switch */

export type OpenCopyGate = Extract<MandateGate, { open: true; network: "mainnet" }>;
export type CopyMoneyGate = OpenCopyGate | Readonly<{ open: false }>;

/**
 * Whether her copy with money is open on this deployment: the switch on (`RYNTRA_AGENT_COPY=on`, with the signer's rule and
 * the start wired — `copyMoneyOpen`), and the agent's mandate open on mainnet, its agent the registry's. The leader's
 * trades are mainnet's: a copy elsewhere has nothing to copy.
 */
export function copyMoneyGate(env: Env): CopyMoneyGate {
  if (!copyMoneyOpen(env[COPY_MONEY_ENV])) return { open: false };
  const gate = mandateGate(env);
  return gate.open && gate.network === "mainnet" ? gate : { open: false };
}

/** The verbs of her way out — never behind the switch. */
export const COPY_EXIT_VERBS: ReadonlySet<string> = new Set(["stop", "stop-send", "freeze"]);

/**
 * What her way out acts on, whatever the switch: the book of copies with money is mainnet's, and the agent the
 * registry's. Her stop names no agent — it takes every policy off and everything home as her smart account's own signer —
 * so a registry without one changes nothing of it.
 */
export function copyExitGate(): OpenCopyGate {
  return { open: true, network: "mainnet", pool: null, agent: registryAgent() ?? PublicKey.default };
}

/* ------------------------------------------------------------- the door */

const LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
/** A stop's signed transactions are the largest body: at most 21 wires of at most 1 232 bytes. */
const MAX_BODY = 48_000;

/** Copies with money one wallet keeps at work at once — the paper copies' own bound (the engine's, kept where a copy is written). */
export { COPY_MONEY_PER_OWNER };
/** Her start's transactions at most: her account and budget, the buy's policy, a sale's policy for each group of five coins. */
export const COPY_START_ITEMS_MAX = 4;
/** Her stop's transactions at most: the stop itself, the coins, the emptied accounts. */
export const COPY_STOP_ITEMS_MAX = 1 + COPY_STOP_COIN_TRANSACTIONS + COPY_STOP_CLOSE_TRANSACTIONS;

const headersOf = (rate: RateLimitDecision): Record<string, string> => ({ ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) });

export function copyFailure(status: number, code: string, message: string, rate: RateLimitDecision, extra: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json({ error: { code, message }, ...extra }, { status, headers: headersOf(rate) });
}

const answer = (body: Readonly<Record<string, unknown>>, rate: RateLimitDecision): Response => Response.json(body, { headers: headersOf(rate) });

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
/** One signed transaction: at most 1 232 bytes, base64. */
const Wire = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(1_700);

export const COPY_REVIEW_SCHEMA = z
  .object({
    owner: Base58,
    leader: Base58,
    /** Her day's budget, SOL: any sum — the mandate's technical bounds only (`copyBudgetIssue`). */
    perDaySol: z.number().positive().finite().max(1e9),
    sharePct: z.number().refine((value) => (COPY_SHARES as readonly number[]).includes(value)),
    days: z.number().int().min(1),
    boundPct: z.number().refine((value) => (COPY_BOUNDS as readonly number[]).includes(value)),
    /** The leader's coins she keeps of those the server read; absent — all of them (at most ten). */
    coins: z.array(Base58).min(1).max(COPY_COINS_MAX).optional(),
  })
  .strict();

export const COPY_START_SCHEMA = z
  .object({
    owner: Base58,
    policy: Base58,
    /** The review's name: the record the server kept for her signature (`reviewCopyEnable`). */
    review: z.string().regex(/^[0-9a-f]{32}$/),
    /** Her signed transactions, in order; absent — only the book (her start asked again once they had landed). */
    items: z.array(Wire).min(1).max(COPY_START_ITEMS_MAX).optional(),
  })
  .strict();

/** A review's name — her unfinished start, which has no row in the book, is stopped from the server's record of it. */
const ReviewName = z.string().regex(/^[0-9a-f]{32}$/);

export const COPY_STOP_SCHEMA = z.object({ owner: Base58, policy: Base58, review: ReviewName.optional() }).strict();

export const COPY_STOP_SEND_SCHEMA = z.object({ owner: Base58, policy: Base58, items: z.array(Wire).min(1).max(COPY_STOP_ITEMS_MAX), review: ReviewName.optional() }).strict();

/** The rest of her start, from the server's record of her review. */
export const COPY_FINISH_SCHEMA = z.object({ owner: Base58, policy: Base58, review: ReviewName }).strict();

export const COPY_FREEZE_SCHEMA = z.object({ owner: Base58, policy: Base58, frozen: z.boolean() }).strict();

export type DoorDeps = Readonly<{
  env?: Env;
  /** Her wallet's proof for a change; the tests hand in their own. */
  prove?: ProveOwner;
  /** The store and whether this deployment writes to it; the Guard runtime's when not handed in. */
  store?: () => Promise<Readonly<{ store: GuardStore; writable: boolean }>>;
}>;

export type OpenDoor<T> = Readonly<{ gate: OpenCopyGate; body: T; rate: RateLimitDecision; store: GuardStore }>;

const guardStore = async (): Promise<Readonly<{ store: GuardStore; writable: boolean }>> => {
  const guard = (await import("../guard/runtime.ts")).getGuardRuntime();
  return { store: guard.store, writable: guard.writes.allowed && storeSurvivesColdStart(guard.store) };
};

/** The whole door: the switch, the rate, the site, the body, her wallet's proof, the store. A refusal answers here. */
export async function copyMoneyDoor<S extends z.ZodType>(request: Request, verb: string, schema: S, deps: DoorDeps = {}): Promise<OpenDoor<z.output<S>> | Response> {
  const rate = LIMITER.consume(`copy-money:${verb}:${clientIp(request.headers)}`);
  /* Closed: nothing of the request is read — no body, no proof, no store. Her way out is never closed. */
  const gate = COPY_EXIT_VERBS.has(verb) ? copyExitGate() : copyMoneyGate(deps.env ?? process.env);
  if (!gate.open) return copyFailure(403, "MONEY_CLOSED", "Copying with money is closed.", rate);
  if (!rate.allowed) return copyFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  /* A browser from elsewhere is refused before anything of it is read; a request with an Authorization header is the
     phone's, and the proof judges its bearer. */
  if (request.headers.get("authorization") === null && !mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return copyFailure(403, "FORBIDDEN_ORIGIN", "A change must be asked for from this site.", rate);
  }
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return copyFailure(413, "TOO_LARGE", "The request is too large.", rate);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return copyFailure(400, "VALIDATION_ERROR", "The body is not JSON.", rate);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return copyFailure(400, "VALIDATION_ERROR", "The body does not match the request.", rate);
  const body = parsed.data as z.output<S> & Readonly<{ owner: string }>;
  const refused = await ownerProof(request, body.owner, rate, deps.prove);
  if (refused) return refused;
  const runtime = await (deps.store ?? guardStore)().catch(() => null);
  if (!runtime || !runtime.writable) return copyFailure(503, "UNAVAILABLE", "The copy's book cannot be kept here now.", rate);
  return { gate, body, rate, store: runtime.store };
}

/* ------------------------------------------------------------- what the screen reads of her copies */

/**
 * A copy with money as «My bots» draws it: public addresses and numbers only. `pending` — her start landed only
 * in part, with no row in the book (`review` names the server's record of it); `rest` — something of hers still stands on
 * chain after her stop (or its check did not read): «Take the rest» stays while it does, after a reload too.
 */
export type MoneyCopyView = Readonly<{
  policy: string;
  leader: string;
  status: "working" | "stopped" | "pending";
  frozen: boolean;
  since: string;
  endsAt: string;
  ended: boolean;
  perDaySol: number;
  perTradeSol: number;
  todaySol: number;
  sharePct: number;
  boundPct: number;
  coins: number;
  bought: number;
  sold: number;
  missed: number;
  rest: boolean;
  review: string | null;
}>;

export function moneyCopyView(row: CopyMoneyRow, nowMs: number): MoneyCopyView {
  const ends = Number(row.mandate.expiresAt) * 1000;
  const landed = row.orders.filter((order) => order.status === "ok");
  return {
    policy: row.mandate.policy,
    leader: row.leader,
    status: row.status,
    frozen: row.frozen === true,
    since: row.since,
    endsAt: new Date(ends).toISOString(),
    ended: ends <= nowMs,
    perDaySol: solOf(row.mandate.perDay),
    perTradeSol: solOf(row.mandate.perTrade),
    todaySol: solOf(copyDaySpent(row, copyDayOf(row, nowMs))),
    sharePct: row.sharePct,
    boundPct: row.boundPct,
    coins: row.mandate.coins.length,
    bought: landed.filter((order) => order.side === "buy").length,
    sold: landed.filter((order) => order.side === "sell").length,
    missed: row.orders.filter((order) => order.status === "missed").length,
    rest: row.rest === true,
    review: null,
  };
}

/** Her unfinished start as «My bots» draws it — to finish, or (her stop from it begun) to take the rest home. */
function pendingCopyView(row: CopyMoneyRow, pending: CopyPending, nowMs: number): MoneyCopyView {
  return { ...moneyCopyView({ ...row, since: new Date(pending.at).toISOString() }, nowMs), status: "pending", rest: pending.stopped === true, review: pending.review };
}

/** How long the list waits for the chain's word on her unfinished starts, ms — not read, each is shown. */
export const PENDING_READ_MS = 4_000;

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => (timer = setTimeout(() => reject(new Error("timed out")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Her copies with money on mainnet, the newest first. Throws when the book does not answer. With `chain` — and
 * whatever the switch — her unfinished starts first: each whose smart account stands as hers on chain (or is not read);
 * one whose account is not hers past the time her transactions could land (`COPY_PENDING_SETTLE_MS`) is forgotten, and one
 * already in the book is the book's.
 */
export async function moneyCopiesOf(store: GuardStore, owner: string, nowMs: number, chain?: () => Pick<Connection, "getMultipleAccountsInfo">): Promise<readonly MoneyCopyView[]> {
  const rows = (await listCopyRows(store, "mainnet")).filter((row) => row.owner === owner);
  const book = [...rows].sort((a, b) => b.since.localeCompare(a.since)).map((row) => moneyCopyView(row, nowMs));
  if (!chain) return book;
  const inBook = new Set(rows.map((row) => row.mandate.policy));
  const marks = await listCopyPending(store, "mainnet", owner);
  const open: { mark: CopyPending; row: CopyMoneyRow }[] = [];
  for (const mark of marks) {
    if (inBook.has(mark.policy)) {
      await dropCopyPending(store, mark, false).catch(() => undefined);
      continue;
    }
    const reviewed = await readCopyReview(store, { cluster: "mainnet", owner, policy: mark.policy, review: mark.review });
    if (reviewed) open.push({ mark, row: reviewed.row });
  }
  if (!open.length) return book;
  const infos = await within(chain().getMultipleAccountsInfo(open.map(({ mark }) => new PublicKey(mark.settings)), "confirmed"), PENDING_READ_MS).catch(() => null);
  const human = new PublicKey(owner);
  const pending: MoneyCopyView[] = [];
  for (const [at, { mark, row }] of open.entries()) {
    if (infos && !copySettingsHers(infos[at], human)) {
      if (nowMs - mark.at > COPY_PENDING_SETTLE_MS) await dropCopyPending(store, mark, true).catch(() => undefined);
      continue;
    }
    pending.push(pendingCopyView(row, mark, nowMs));
  }
  return [...pending.sort((a, b) => b.since.localeCompare(a.since)), ...book];
}

/* ------------------------------------------------------------- the verbs */

/** The venue's quote of how much of a coin her day buys: Jupiter's, the very read every buy of the agent goes by. */
const jupiterDayCoins: DayCoins = async (coin, lamports) => {
  const [{ jupiterWorth }, { resolveJupiterSwapEndpoint }] = await Promise.all([import("../mandate/jupiter.server.ts"), import("../solana/quotes.ts")]);
  return jupiterWorth({ coin: NATIVE_MINT, budgetMint: coin, amount: lamports }, resolveJupiterSwapEndpoint());
};

type ChainDeps = Readonly<{ connection: Connection; now?: () => number }>;
type ReviewDeps = ChainDeps & Readonly<{ dayCoins?: DayCoins }> & Omit<Parameters<typeof reviewCopyEnable>[3], "dayCoins" | "store" | "now">;
type Relay = typeof relayMandate;

const statusOf = (code: string): number => (code === "VALIDATION_ERROR" ? 400 : code === "UNAVAILABLE" ? 503 : 422);

/**
 * Her review: the leader's coins as the server read them (`leaderCoins` of the wallet's own record — her list only narrows
 * them), her numbers as the mandate takes them, and her unsigned transactions. Every copy gets a smart account of its own:
 * a vault shared with another copy, or with her agent, would mix their budgets and their coins at a stop.
 */
export async function reviewMoneyCopy(door: OpenDoor<z.output<typeof COPY_REVIEW_SCHEMA>>, deps: ReviewDeps): Promise<Response> {
  const { body, gate, rate, store } = door;
  if (body.leader === body.owner) return copyFailure(400, "SELF", "That is your own wallet.", rate);
  const issue = copyBudgetIssue(body);
  if (issue) return copyFailure(400, "BUDGET", `Not a budget: ${issue}.`, rate);
  const working = await listCopyRows(store, gate.network).then(
    (rows) => rows.filter((row) => row.owner === body.owner && row.status === "working"),
    () => null,
  );
  if (!working) return copyFailure(503, "UNAVAILABLE", "The copy's book did not answer.", rate);
  if (working.some((row) => row.leader === body.leader)) return copyFailure(409, "ALREADY", "This wallet is copied with money already.", rate);
  if (working.length >= COPY_MONEY_PER_OWNER) return copyFailure(409, "LIMIT", `${COPY_MONEY_PER_OWNER} copies with money at most.`, rate);
  const activity = await readActivity(store, body.leader).then(
    (found) => ({ found }),
    () => null,
  );
  if (!activity) return copyFailure(503, "UNAVAILABLE", "The wallet's record did not answer.", rate);
  const offered = leaderCoins(activity.found?.trades ?? []);
  const asked = body.coins ? new Set(body.coins) : null;
  const coins = asked ? offered.filter((mint) => asked.has(mint)) : offered;
  if (!coins.length) return copyFailure(422, "NO_COINS", "The wallet has no coin to copy yet.", rate);
  const { connection, now, dayCoins, ...enable } = deps;
  const review = await reviewCopyEnable(
    { owner: body.owner, leader: body.leader, budget: copyBudgetOf(body), sharePct: body.sharePct, boundPct: body.boundPct, coins: coins.map((mint) => ({ mint })), smartAccount: null },
    gate,
    connection,
    { ...enable, dayCoins: dayCoins ?? jupiterDayCoins, store, ...(now ? { now } : {}) },
  ).catch(() => null);
  if (!review) return copyFailure(503, "UNAVAILABLE", "The chain did not answer.", rate);
  if (!review.ok) return copyFailure(statusOf(review.code), review.code, review.reason, rate);
  return answer(
    {
      network: gate.network,
      review: review.review,
      policy: review.row.mandate.policy,
      transactions: review.transactions,
      perDay: review.row.mandate.perDay,
      perTrade: review.row.mandate.perTrade,
      fundLamports: review.fundLamports,
      worstLamports: review.worstLamports,
      coins: review.row.mandate.coins.map((coin) => coin.mint),
      skipped: review.skipped,
    },
    rate,
  );
}

/**
 * Her start: her signed transactions relayed in order (each read first — she pays and alone signs, nothing but her smart
 * account, the token and system programs), then the record the server kept for her review into the book, once the chain
 * holds what it names (`registerCopy`). Asked again without transactions, it only writes the book: a start whose answer was
 * lost is never signed twice.
 *
 * The server's own record of her review is read first, and her start is written
 * as under way (`writeCopyPending`) **before** anything is relayed — a book that does not take it relays nothing. Her
 * transactions land one by one: when the first lands and a next does not, her budget is in her vault and no copy is in the
 * book. Her start then stays listed as unfinished (`moneyCopiesOf`), whatever the switch, until it is finished
 * (`finishMoneyCopy`, then this verb) or taken home (her stop from the review); `partial` says whether her smart account
 * already stands as hers. A relay refused before it sent anything leaves nothing: its mark goes.
 */
export async function startMoneyCopy(door: OpenDoor<z.output<typeof COPY_START_SCHEMA>>, deps: ChainDeps & Readonly<{ relay?: Relay }>): Promise<Response> {
  const { body, gate, rate, store } = door;
  const now = deps.now ?? Date.now;
  const ask = { cluster: gate.network, owner: body.owner, policy: body.policy, review: body.review } as const;
  /* In the book already, as hers: her start came back twice — the copy stands, and nothing is relayed again. */
  const keptCopy = async (): Promise<Response | null> => {
    const kept = await readCopyRow(store, gate.network, body.policy).catch(() => null);
    if (!kept || kept.owner !== body.owner) return null;
    await dropCopyPending(store, ask, false).catch(() => undefined);
    return answer({ network: gate.network, copy: moneyCopyView(kept, now()) }, rate);
  };
  if (body.items) {
    const reviewed = await readCopyReview(store, ask).then(
      (found) => ({ found }),
      () => null,
    );
    if (!reviewed) return copyFailure(503, "UNAVAILABLE", "The copy's book did not answer.", rate);
    if (!reviewed.found) return (await keptCopy()) ?? copyFailure(422, "REFUSED", "No such copy to start — review it again.", rate);
    const row = reviewed.found.row;
    const marked = await writeCopyPending(store, row, body.review, now()).then(
      () => true,
      () => false,
    );
    if (!marked) return copyFailure(503, "UNAVAILABLE", "The copy's book cannot be kept here now.", rate);
    const relayed = await (deps.relay ?? relayMandate)({ owner: body.owner, items: body.items }, gate.network, deps.connection).catch(() => null);
    if (!relayed || !relayed.ok) {
      const signatures = relayed?.signatures ?? [];
      /* Refused before anything went out (unreadable, not hers alone, not this network): nothing of it can land. */
      if (relayed && relayed.code !== "FAILED" && signatures.length === 0) {
        await dropCopyPending(store, ask, false).catch(() => undefined);
        return copyFailure(400, relayed.code, relayed.reason, rate, { signatures, partial: false });
      }
      const partial = (await copyAccountHers(row, deps.connection)) !== false;
      if (!relayed) return copyFailure(503, "UNAVAILABLE", "The chain did not answer.", rate, { signatures, partial });
      return copyFailure(422, relayed.code, relayed.reason, rate, { signatures, partial });
    }
  }
  const registered = await registerCopy(ask, gate.agent, { store, connection: deps.connection, now }).catch(() => null);
  if (!registered) return copyFailure(503, "UNAVAILABLE", "The copy's book did not answer.", rate);
  if (!registered.ok) {
    const kept = await keptCopy();
    if (kept) return kept;
    const pending = await readCopyPending(store, gate.network, body.owner, body.policy).catch(() => null);
    const status = registered.code === "BUSY" ? 503 : registered.code === "ALREADY" || registered.code === "LIMIT" ? 409 : 422;
    return copyFailure(status, registered.code, registered.reason, rate, { partial: pending !== null });
  }
  await dropCopyPending(store, ask, false).catch(() => undefined);
  return answer({ network: gate.network, copy: moneyCopyView(registered.row, now()) }, rate);
}

/**
 * The rest of her unfinished start: her unsigned transactions for what of it is not on chain yet, built from the
 * server's own record of her review (`reviewCopyFinish`); she signs them, and her start relays them and writes the book. No
 * transaction — everything stands: her start only writes the book. A start whose stop has begun is not finished.
 */
export async function finishMoneyCopy(door: OpenDoor<z.output<typeof COPY_FINISH_SCHEMA>>, deps: ChainDeps): Promise<Response> {
  const { body, gate, rate, store } = door;
  const ask = { cluster: gate.network, owner: body.owner, policy: body.policy, review: body.review } as const;
  const found = await Promise.all([readCopyReview(store, ask), readCopyPending(store, gate.network, body.owner, body.policy)]).catch(() => null);
  if (!found) return copyFailure(503, "UNAVAILABLE", "The copy's book did not answer.", rate);
  const [reviewed, pending] = found;
  if (!reviewed) return copyFailure(404, "NOT_FOUND", "No such start of yours.", rate);
  if (pending?.stopped) return copyFailure(409, "STOPPED", "This start is being taken back.", rate);
  const finish = await reviewCopyFinish(reviewed.row, gate, deps.connection).catch(() => null);
  if (!finish) return copyFailure(503, "UNAVAILABLE", "The chain did not answer.", rate);
  if (!finish.ok) return copyFailure(finish.code === "UNAVAILABLE" ? 503 : finish.code === "NOTHING" ? 409 : 422, finish.code, finish.reason, rate);
  return answer({ network: gate.network, policy: body.policy, review: body.review, transactions: finish.transactions }, rate);
}

/** Her copy from the book, only when it is hers; null — no such copy of hers; throws when the book does not answer. */
async function hersOrNull(store: GuardStore, owner: string, policy: string): Promise<CopyMoneyRow | null> {
  const row = await readCopyRow(store, "mainnet", policy);
  return row && row.owner === owner ? row : null;
}

/**
 * What her stop acts on: her copy in the book; or, with no row in the book, her unfinished start, from the
 * server's own record of her review (and its mark, when it stands). Null — neither is hers; throws when the book does not
 * answer.
 */
type StopTarget = Readonly<{ kind: "book"; row: CopyMoneyRow }> | Readonly<{ kind: "review"; row: CopyMoneyRow; at: number; review: string; pending: CopyPending | null }>;

async function stopTargetOf(store: GuardStore, body: Readonly<{ owner: string; policy: string; review?: string | undefined }>): Promise<StopTarget | null> {
  const row = await hersOrNull(store, body.owner, body.policy);
  if (row) return { kind: "book", row };
  if (!body.review) return null;
  const ask = { cluster: "mainnet", owner: body.owner, policy: body.policy, review: body.review } as const;
  const [reviewed, pending] = await Promise.all([readCopyReview(store, ask), readCopyPending(store, "mainnet", body.owner, body.policy)]);
  return reviewed ? { kind: "review", row: reviewed.row, at: pending?.at ?? reviewed.at, review: body.review, pending } : null;
}

/** The mark of her unfinished start, for the screen's word on it: gone once nothing of it stands; kept while anything does. */
async function settlePending(store: GuardStore, target: Extract<StopTarget, { kind: "review" }>, standing: Readonly<{ rest: boolean }> | null): Promise<void> {
  const ask = { cluster: "mainnet" as const, owner: target.row.owner, policy: target.row.mandate.policy, review: target.review };
  if (standing && !standing.rest) await dropCopyPending(store, ask, true);
  else if (target.pending && !target.pending.stopped) await markCopyPending(store, target.pending, { stopped: true });
}

/**
 * Her stop's transactions: her copy frozen first — no order of it goes out that could land before her stop — then the
 * first transaction takes every policy off and the budget home, the next take the coins home, the last close the emptied
 * accounts. A coin that cannot move now stays in her vault and is named with its reason (`skipped`); `left` — coins her next
 * stop takes. Only her own copy: another wallet's policy is no copy of hers (404). Whatever the switch.
 *
 * Nothing left to move (`NOTHING`) — no policy of the copy stands: the book marks it stopped, with «the rest»
 * only for the coins named as staying. Her unfinished start, with no row in the book, is stopped from the server's record of
 * her review (`review`): no order of the agent's was ever written for it, so nothing is frozen; only an account that stands
 * on chain as hers is stopped.
 */
export async function stopMoneyCopy(door: OpenDoor<z.output<typeof COPY_STOP_SCHEMA>>, deps: Readonly<{ connection: Parameters<typeof reviewCopyStop>[2]; now?: () => number }>): Promise<Response> {
  const { body, gate, rate, store } = door;
  const now = deps.now ?? Date.now;
  const target = await stopTargetOf(store, body).then(
    (found) => ({ found }),
    () => null,
  );
  if (!target) return copyFailure(503, "UNAVAILABLE", "The copy's book did not answer.", rate);
  if (!target.found) return copyFailure(404, "NOT_FOUND", "No such copy of yours.", rate);
  const found = target.found;
  if (found.kind === "review") {
    const hers = await copyAccountHers(found.row, deps.connection);
    if (hers === null) return copyFailure(503, "UNAVAILABLE", "Your copy's account did not read — tap stop again.", rate);
    if (!hers) {
      /* Nothing of her start stands as hers: past the time her transactions could land, it is forgotten. */
      if (now() - found.at > COPY_PENDING_SETTLE_MS) await dropCopyPending(store, { cluster: "mainnet", owner: body.owner, policy: body.policy, review: found.review }, true).catch(() => undefined);
      return copyFailure(409, "NOTHING", "Nothing left to stop.", rate, { skipped: [] });
    }
  }
  const review = await reviewCopyStop(found.row, gate.agent, deps.connection, found.kind === "book" ? { store, now } : { now }).catch(() => null);
  if (!review) return copyFailure(503, "UNAVAILABLE", "The chain did not answer — tap stop again.", rate);
  if (!review.ok) {
    if (review.code === "NOTHING") {
      const stays = (review.skipped ?? []).length > 0;
      if (found.kind === "book") {
        const iso = new Date(now()).toISOString();
        await changeCopyRow(store, found.row, ({ rest: _rest, ...current }) => ({ ...current, status: "stopped", ...(stays ? { rest: true as const } : {}), updatedAt: iso })).catch(() => undefined);
      } else await settlePending(store, found, { rest: stays }).catch(() => undefined);
    }
    return copyFailure(review.code === "UNAVAILABLE" ? 503 : review.code === "NOTHING" ? 409 : 422, review.code, review.reason, rate, { skipped: review.skipped ?? [] });
  }
  return answer({ network: gate.network, transactions: review.transactions, skipped: review.skipped, left: review.left, unclosed: review.unclosed }, rate);
}

/**
 * Her signed stop, relayed: the first transaction — the stop itself — first; when it does not land, nothing else is sent.
 * Then each of the rest on its own: a coin that fails to move, or an account a stranger's grain keeps open, fails alone.
 * Whatever the switch.
 *
 * What stands is read before and after (`copyStanding`). Before — when nothing her stop takes off stands (no
 * policy, no budget: «the rest» of an earlier stop), every transaction is a coin's or a close's and goes on its own, so one
 * that fails never holds the others back. After — the copy is marked stopped once its buy's policy is gone, and «the rest»
 * kept on its row while anything stands, or the read did not answer: the screen offers «Take the rest» after a reload too.
 * Her unfinished start's stop, from the server's record of her review: once nothing stands, its record and mark are gone.
 */
export async function sendMoneyCopyStop(
  door: OpenDoor<z.output<typeof COPY_STOP_SEND_SCHEMA>>,
  deps: Readonly<{ connection: Connection; relay?: Relay; now?: () => number }>,
): Promise<Response> {
  const { body, gate, rate, store } = door;
  const now = deps.now ?? Date.now;
  const target = await stopTargetOf(store, body).then(
    (found) => ({ found }),
    () => null,
  );
  if (!target) return copyFailure(503, "UNAVAILABLE", "The copy's book did not answer.", rate);
  if (!target.found) return copyFailure(404, "NOT_FOUND", "No such copy of yours.", rate);
  const found = target.found;
  const before = await copyStanding(found.row, gate.agent, deps.connection);
  /* A read that failed is taken as a stop still to land: its first transaction must, before any other is sent. */
  const stopFirst = before === null || before.policies > 0 || before.budget;
  const relay = deps.relay ?? relayMandate;
  const signatures: string[] = [];
  let failed = 0;
  for (const [index, item] of body.items.entries()) {
    const sent = await relay({ owner: body.owner, items: [item] }, gate.network, deps.connection).catch(() => null);
    if (sent?.ok) {
      signatures.push(...sent.signatures);
      continue;
    }
    if (index === 0 && stopFirst) return copyFailure(sent ? 422 : 503, sent?.code ?? "UNAVAILABLE", sent?.reason ?? "The chain did not answer.", rate, { signatures: sent?.signatures ?? [] });
    failed += 1;
  }
  const after = await copyStanding(found.row, gate.agent, deps.connection);
  const stopped = after !== null && !after.buy;
  const rest = after === null || after.rest;
  if (found.kind === "book") {
    const iso = new Date(now()).toISOString();
    await changeCopyRow(store, found.row, ({ rest: was, ...current }) => {
      const status = stopped ? ("stopped" as const) : current.status;
      if (status === current.status && (was === true) === rest) return null;
      return { ...current, status, ...(rest ? { rest: true as const } : {}), updatedAt: iso };
    }).catch(() => undefined);
  } else await settlePending(store, found, after).catch(() => undefined);
  return answer({ network: gate.network, signatures, failed, stopped, rest }, rate);
}

/** Her freeze over the copy's new orders: on — it starts nothing; off — it works again. Only her own copy. */
export async function freezeMoneyCopy(door: OpenDoor<z.output<typeof COPY_FREEZE_SCHEMA>>, deps: Readonly<{ now?: () => number }> = {}): Promise<Response> {
  const { body, gate, rate, store } = door;
  const turned = await setCopyFrozen(store, { cluster: gate.network, owner: body.owner, policy: body.policy, frozen: body.frozen }, deps.now).catch(() => null);
  if (!turned) return copyFailure(503, "UNAVAILABLE", "The switch cannot be kept here now. Try again in a moment.", rate);
  if (!turned.ok) return copyFailure(404, "NOT_FOUND", "No such copy of yours.", rate);
  return answer({ network: gate.network, frozen: turned.frozen }, rate);
}
