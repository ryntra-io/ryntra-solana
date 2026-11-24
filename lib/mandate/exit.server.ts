/**
 * The agent leaves a trade on its own, at work: on every pass, for a mandate whose agent keeps its coin in her
 * vault (`./terms.ts` `heldCoin`), before any buy, it reads what it holds and what that is worth now, asks the person's
 * rules (`./exit.ts`) and, when they say so, sells — through the venue, under the mandate's sale policy, judged and signed
 * by its own signer (`./signer.server.ts`), the money landing in her own account of the budget's token and nowhere else.
 *
 * The same care as every buy (`./tick.server.ts`): a sale is written down with its signature before it is sent, its fate
 * read back by that signature, never sent twice for one minute (one claim per minute in the book), never sent while she
 * froze the agent, and never on a figure it could not read — a price not read is a wait, then a pause she hears of. A full
 * exit (the stop, the fade, the clock) pauses the agent: it sold everything by her rules and buys no more until she says.
 * A sale is never more than the day's limit of the sale's policy still lets out (`./exit.ts` `saleRoom`): what does not
 * fit is sold as the limit comes back. Three refused or failed sales in a row pause its buys and tell her, and it tries
 * again after `EXIT_RETRY_MS` — her stop after `EXIT_STOP_RETRY_MS` — it does not keep paying the network to
 * hear «no», and it never gives up on her stop. A sale that could not be built at all — the network, Jupiter's rate, the
 * route — counts for nothing: it tries again next minute, and tells her once if that lasts. Her stop removed the buy's
 * policy: the agent sells nothing more, whatever still stands beside it.
 *
 * What it did goes into the book beside the trades (`sales`) and, for the drive, as events (`events`, the
 * format of `./exit.ts` `AgentEvent`), which the agent's report reads from the same book. This file holds no key and reads
 * no environment.
 *
 * - the engine's switch (`TickDeps.switches`, handed in by the cron's route): the agent's own exit closed, it sells only
 *   by her stop — half at 2x, the fade, the clock and a bot's sales wait;
 * - one sale for one state of the book: two instances that read the same book a minute apart never both sell
 *   (`saleClaimKeys`);
 * - her stop asked for: for `STOP_ASKED_HOLD_MS` after the stop's transaction was built for her, the agent starts no sale
 *   but a stop of her rules — a sale landing first would leave her vault short of the exact balance her stop takes home,
 *   and her stop would fail;
 * - a grid's level is sold only when the route's minimum covers its cost and the network's fees of its round trip
 *   (`../bots/money/rules.ts` `gridNetworkRaw`); short of it, the level waits for the next mark and the buys go on.
 */

import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { GuardStore } from "../guard/store.ts";

import { bookOf, heldOfRecord, mandateOf, readEntry, TRADES_KEPT, writeEntry, type BookEntry } from "./book.server.ts";
import type { MandateNetwork, StopSale } from "./service.server.ts";
import { agentHolding } from "./sale.ts";
import type { SalesView } from "./sale.server.ts";
import {
  costAfterSale,
  EXIT_FADE_AFTER_MS,
  EXIT_UNREAD_MS,
  exitDecision,
  exitRetryMs,
  exitFrom,
  isFullExit,
  NO_MARKET,
  positionOf,
  saleRoom,
  withEvent,
  type AgentEvent,
  type AgentSale,
  type ExitWhy,
} from "./exit.ts";
import { isFrozen } from "./freeze.server.ts";
import type { Mandate } from "./human.ts";
import { gridCoversCost, gridNetworkRaw } from "../bots/money/rules.ts";
import { tradeTerms } from "./result.ts";
import { agentTrade, fateOf, policyOf, type TradeOutcome } from "./run.server.ts";
import { storeScreen } from "./ryntra-coins.server.ts";
import { mandateSigner } from "./signer.server.ts";
import { refusalOf } from "./ssa.ts";
import { AUTOSTOP, FAILURES_TO_PAUSE, type PauseReason } from "./strategy.ts";
import { heldAccountOf, proceedsAccountOf } from "./terms.ts";
import type { TickDeps } from "./tick.server.ts";

/**
 * The switch of the agent's own exit: a budget is signed with the sale's policy only while `RYNTRA_AGENT_EXIT=on` — the
 * point to roll back to. Off, budgets are signed as before, and mandates already signed with a sale keep selling.
 */
export const AGENT_EXIT_ENV = "RYNTRA_AGENT_EXIT";
export const agentExitOn = (value: string | undefined): boolean => value?.trim() === "on";

/** What a pass did for a mandate's exit; null — nothing to do, the buys' turn. `stopped` — her stop removed the buy's policy. */
export type ExitLine = "sold" | "failed" | "refused" | "waited" | "unread" | "frozen" | "paused" | "stopped";

export type ExitAnswer = Readonly<{ line: ExitLine | null; entry: BookEntry }>;

/** One claim per minute of a mandate's sales: a second instance on the same pass finds it taken. */
export const saleClaimKey = (cluster: string, policy: string, minute: number) => `x:${cluster}:${policy}:${minute}`;

/**
 * One sale for one state of the book (the review of #1944: «a double sale on the minute's edge»). The minute's
 * claim alone let two instances that read the same book at 12:00:59 and 12:01:00 both sell the same coins. Each sale now
 * also claims the state it was decided on — how many sales the book holds and when the last was — in this bucket and
 * the one before, in one atomic claim: two instances on the same state, a minute apart or within the same bucket, share
 * a key, and only one sells. A sale that was not sent gives the state's claims back; a process that died before sending
 * holds them at most two buckets.
 */
export const SALE_STATE_BUCKET_MS = 5 * 60_000;
export const saleStateKey = (cluster: string, policy: string, state: string, bucket: number) => `xs:${cluster}:${policy}:${state}:${bucket}`;
export const saleStateOf = (sales: readonly AgentSale[]): string => `${sales.length}.${sales.at(-1)?.at ?? 0}`;

/** The claims of one sale: the minute's, and the state's in this bucket and the one before. */
export function saleClaimKeys(cluster: string, policy: string, sales: readonly AgentSale[], at: number): Readonly<{ minute: string; state: readonly string[] }> {
  const state = saleStateOf(sales);
  const bucket = Math.floor(at / SALE_STATE_BUCKET_MS);
  return { minute: saleClaimKey(cluster, policy, Math.floor(at / 60_000)), state: [saleStateKey(cluster, policy, state, bucket), saleStateKey(cluster, policy, state, bucket - 1)] };
}

/**
 * Her stop was asked for (the review of #1944: «the agent's sale racing her stop»): her stop's transaction
 * takes home the exact balance of the coin it read, so a sale of the agent's that lands between its review and her
 * signature leaves the vault short and her stop fails whole. The stop's route marks the policy when it builds her
 * transaction; for `STOP_ASKED_HOLD_MS` — longer than its blockhash lives — the agent starts no sale but a stop of her
 * own rules. Anyone may build her unsigned stop, so the mark never holds back her stop: at worst a stranger delays a
 * half at 2x by two minutes.
 */
export const STOP_ASKED_HOLD_MS = 2 * 60_000;
export const stopAskedKey = (cluster: string, policy: string) => `q:${cluster}:${policy}`;

/** The stop's route: mark that her stop's transaction was just built for this buying policy. */
export const askedStop =
  (deps: Readonly<{ store: GuardStore; network: MandateNetwork; now?: () => number }>) =>
  async (policy: PublicKey): Promise<void> => {
    await bookOf(deps.store).set(stopAskedKey(deps.network, policy.toBase58()), { claimedAt: (deps.now ?? Date.now)() });
  };

/** Whether her stop was asked for within the hold; a mark not read holds too — two minutes, not a sale against her stop. */
async function stopAsked(store: GuardStore, cluster: string, policy: string, at: number): Promise<boolean> {
  const mark = await bookOf(store)
    .get(stopAskedKey(cluster, policy))
    .catch(() => ({ claimedAt: at }));
  return Boolean(mark && "claimedAt" in mark && at - mark.claimedAt < STOP_ASKED_HOLD_MS);
}

/** How many token accounts the sale's setup opens that do not stand yet — the agent pays their rent; not read, all of them. */
async function accountsOpened(connection: Pick<Connection, "getMultipleAccountsInfo">, setup: readonly TransactionInstruction[]): Promise<number> {
  const opened = setup.filter((instruction) => instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).flatMap((instruction) => (instruction.keys[1] ? [instruction.keys[1].pubkey] : []));
  if (!opened.length) return 0;
  const read = await Promise.resolve()
    .then(() => connection.getMultipleAccountsInfo(opened, "confirmed"))
    .catch(() => null);
  return read === null ? opened.length : read.filter((info) => info === null).length;
}

/**
 * Whether the agent watches this mandate's exit: it keeps its coin, its rules are in the book, and it may still sell — at
 * work, its budget spent, or paused for any reason but money it cannot explain (`mismatch`, which nothing lifts). Sales
 * that keep failing never end the watch: they space its tries (`sellNow`).
 */
export function watchesExit(entry: BookEntry): boolean {
  if (!entry.exit || !heldOfRecord(entry.record)) return false;
  if (entry.status === "working" || entry.status === "spent") return true;
  return entry.status === "paused" && entry.pausedBy !== "mismatch";
}

/** The entry with one more sale, the oldest past the book's length let go. */
export function withSale(entry: BookEntry, sale: AgentSale, now: number): BookEntry {
  return { ...entry, sales: [...(entry.sales ?? []), sale].slice(-TRADES_KEPT), updatedAt: now };
}

/** What a sale's outcome is in the book. */
export function saleOf(outcome: TradeOutcome, base: Pick<AgentSale, "at" | "why" | "soldRaw" | "costRaw">, got: bigint | null, minOut: bigint | null): AgentSale {
  const least = minOut === null ? {} : { minOutRaw: minOut.toString() };
  switch (outcome.status) {
    case "landed":
      return outcome.ok
        ? { ...base, status: "ok", signature: outcome.signature, gotRaw: got === null ? null : got.toString(), ...least, reason: null }
        : { ...base, status: "failed", signature: outcome.signature, gotRaw: null, reason: outcome.refusal?.reason ?? "failed on chain" };
    case "refused-in-simulation":
      return { ...base, status: "failed", signature: null, gotRaw: null, reason: outcome.reason };
    case "refused-by-agent":
      return { ...base, status: "refused", signature: null, gotRaw: null, reason: outcome.reason };
    case "unknown":
      return { ...base, status: "failed", signature: outcome.signature, gotRaw: null, ...least, unsettled: true, validUntilHeight: outcome.validUntilHeight, reason: "not confirmed in time" };
  }
}

const heads = (entry: BookEntry) => ({ v: 1 as const, policy: entry.record.policy, owner: entry.record.owner, coin: entry.receiveMint });

function soldEvent(entry: BookEntry, sale: AgentSale, share: 50 | 100): AgentEvent {
  return {
    ...heads(entry),
    kind: "sold",
    at: sale.at,
    why: sale.why,
    share,
    soldRaw: sale.soldRaw,
    gotRaw: sale.gotRaw,
    costRaw: sale.costRaw,
    signature: sale.signature ?? "",
    ...(sale.partial ? { partial: true as const } : {}),
    ...(sale.level !== undefined ? { level: sale.level } : {}),
  };
}

/** Her rules call for a sale and it does not go: the event she hears at once (`./exit.ts` `AgentEvent`). */
const failedEvent = (entry: BookEntry, why: ExitWhy, at: number, tries: number, retryAt: number): AgentEvent => ({ ...heads(entry), kind: "exit_failed", at, why, tries, retryAt });

/** The entry paused by its exit — only from work: a mandate whose budget is spent stays spent — and the event she hears. */
function pausedBy(entry: BookEntry, why: ExitWhy | "unread" | "refused", reason: PauseReason, at: number): BookEntry {
  const told = { ...entry, events: withEvent(entry.events, { ...heads(entry), kind: "paused", at, why }), updatedAt: at };
  return entry.status === "working" ? { ...told, status: "paused", pausedBy: reason } : told;
}

/** The sales whose fate, or whose money, the last pass could not read, read again — and what a landed one tells her. */
export async function withSettledSales(entry: BookEntry, connection: Pick<Connection, "getTransaction" | "getBlockHeight">, read: (signature: string) => Promise<bigint | null>, at: number): Promise<BookEntry> {
  const sales = entry.sales ?? [];
  const open = (sale: AgentSale) => Boolean(sale.signature) && (sale.unsettled === true || (sale.status === "ok" && sale.gotRaw === null));
  if (!sales.some(open)) return entry;
  let next: BookEntry = entry;
  const settledRows: AgentSale[] = [];
  for (const sale of sales) {
    if (!open(sale)) {
      settledRows.push(sale);
      continue;
    }
    if (!sale.unsettled) {
      const got = await read(sale.signature!).catch(() => null);
      settledRows.push(got === null ? sale : { ...sale, gotRaw: got.toString() });
      continue;
    }
    const { unsettled: _open, validUntilHeight, ...rest } = sale;
    const height = validUntilHeight === undefined ? null : await connection.getBlockHeight("finalized").catch(() => null);
    const fate = await fateOf(connection, sale.signature!);
    if (fate.state === "unread") settledRows.push(sale);
    else if (fate.state === "absent") settledRows.push(height !== null && validUntilHeight !== undefined && height > validUntilHeight + AUTOSTOP.settledBlocks ? { ...rest, reason: "did not land" } : sale);
    else if (!fate.ok) settledRows.push({ ...rest, reason: refusalOf(fate.logs)?.reason ?? "failed on chain" });
    else {
      const got = await read(sale.signature!).catch(() => null);
      const landed: AgentSale = { ...rest, status: "ok", gotRaw: got === null ? null : got.toString(), reason: null };
      settledRows.push(landed);
      /* It landed after all: she hears of it now, and a full exit pauses the agent as if it had been read at once. */
      next = { ...next, events: withEvent(next.events, soldEvent(next, landed, landed.why === "half" ? 50 : 100)) };
      if (isFullExit(landed.why)) next = pausedBy(next, landed.why, landed.why, at);
    }
  }
  if (settledRows.every((row, index) => row === sales[index]) && next === entry) return entry;
  next = { ...next, sales: settledRows, updatedAt: at };
  return next;
}

/** Failed or refused sales at the end of the book, in a row; one still in flight is no failure. */
export function failingSales(sales: readonly AgentSale[]): number {
  let count = 0;
  for (const sale of [...sales].reverse()) {
    if (sale.unsettled) continue;
    if (sale.status === "ok") break;
    count += 1;
  }
  return count;
}

/**
 * The exit's turn on this pass: what the agent holds, what it is worth, the person's rules, and the sale they call for.
 * Returns the line and the entry as the book now holds it — the buys' turn reads that one, never an older copy.
 */
export async function exitFor(given: BookEntry, deps: TickDeps, now: () => number, trade: typeof agentTrade = agentTrade): Promise<ExitAnswer> {
  const rules = exitFrom(given.exit);
  if (!rules || !watchesExit(given) || !deps.venue.sell) return { line: null, entry: given };
  const at = now();
  const mandate = mandateOf(given, deps.gate);
  const held = mandate.terms.heldCoin;
  if (!held || !mandate.salePolicy) return { line: null, entry: given };
  const proceeds = proceedsAccountOf(mandate.terms);
  const entry = await withSettledSales(given, deps.connection, (signature) => deps.venue.received(signature, proceeds), at);
  if (entry !== given) await writeEntry(deps.store, entry);
  /* The book alone says nothing is held: no read at all. */
  const booked = positionOf({ buys: entry.trades, sales: entry.sales ?? [], vaultRaw: null });
  if (booked.heldRaw === 0n && !booked.unread) return { line: null, entry };
  /*
   * Her stop removed the buy's policy: she stopped the agent, and nothing more is sold — even were the sale's policy still
   * to stand beside it. Her withdraw takes the coin back.
   */
  if (!(await deps.connection.getAccountInfo(mandate.policy, "confirmed"))) {
    const { pausedBy: _was, exitUnreadSince: _unread, exitStuckSince: _stuck, ...rest } = entry;
    const next: BookEntry = { ...rest, status: "stopped", updatedAt: at };
    await writeEntry(deps.store, next);
    return { line: "stopped", entry: next };
  }
  if (!(await deps.connection.getAccountInfo(mandate.salePolicy, "confirmed"))) return { line: null, entry };
  const vaultRaw = await deps.connection.getTokenAccountBalance(heldAccountOf(mandate.vault, held), "confirmed").then(
    (balance) => BigInt(balance.value.amount),
    () => null,
  );
  const position = positionOf({ buys: entry.trades, sales: entry.sales ?? [], vaultRaw });
  if (position.heldRaw === 0n && !position.unread) return { line: null, entry };
  const worthRaw = position.unread ? null : await deps.venue.worth(mandate, position.heldRaw, held.mint).catch(() => null);
  const age = position.openedAt === null ? null : at - position.openedAt;
  /* The day's trading is read only when the fade could speak: the rule is on and the position is old enough. */
  const market = rules.fadeBps !== null && age !== null && age >= EXIT_FADE_AFTER_MS && deps.market ? await deps.market(held.mint.toBase58()).catch(() => NO_MARKET) : NO_MARKET;
  /* A position not read whole is a price not read: the rules wait, then pause — never «nothing held». */
  const weighed = position.unread && position.heldRaw === 0n ? { ...position, heldRaw: vaultRaw ?? 1n } : position;
  const asked = exitDecision({ rules, position: { ...weighed, worthRaw }, market, now: at, unreadSince: entry.exitUnreadSince ?? null });
  /* The engine's switch: the agent's own exit closed, her stop alone still sells; any other rule holds. */
  const decision = asked.do === "sell" && asked.why !== "stop" && deps.switches?.agentExit !== true ? ({ do: "hold" } as const) : asked;
  switch (decision.do) {
    case "hold": {
      /* Everything read: the clock of the unread price is over, and a pause for not seeing lifts; no sale is due. */
      const blind = entry.status === "paused" && entry.pausedBy === "blind";
      if (entry.exitUnreadSince === undefined && entry.exitStuckSince === undefined && !blind) return { line: null, entry };
      const { exitUnreadSince: _seen, exitStuckSince: _stuck, pausedBy: was, ...rest } = entry;
      const next: BookEntry = blind ? { ...rest, status: "working", updatedAt: at } : { ...rest, ...(was ? { pausedBy: was } : {}), updatedAt: at };
      await writeEntry(deps.store, next);
      return { line: null, entry: next };
    }
    case "wait": {
      if (entry.exitUnreadSince !== undefined) return { line: "unread", entry };
      const next: BookEntry = { ...entry, exitUnreadSince: at, updatedAt: at };
      await writeEntry(deps.store, next);
      return { line: "unread", entry: next };
    }
    case "pause": {
      /* She hears of it once: the agent sells nothing and buys nothing it cannot price. */
      const since = entry.exitUnreadSince ?? at;
      if ((entry.events ?? []).some((event) => event.kind === "paused" && event.why === "unread" && event.at >= since)) return { line: "unread", entry };
      const next = pausedBy(entry, "unread", "blind", at);
      await writeEntry(deps.store, next);
      return { line: "paused", entry: next };
    }
    case "sell":
      return sellNow(entry, mandate, decision, position, deps, at, trade);
  }
}

/**
 * One sale, end to end: `decision.why` names which.
 * `lot` — a grid's level: the level the sale sold, and the cost its coins carry out of the position (the level's own buy,
 * not the position's average).
 */
export async function sellNow(
  entry: BookEntry,
  mandate: Mandate,
  decision: Readonly<{ why: ExitWhy; share: 50 | 100; amountRaw: bigint }>,
  position: Readonly<{ heldRaw: bigint; costRaw: bigint }>,
  deps: TickDeps,
  at: number,
  trade: typeof agentTrade,
  lot: Readonly<{ level: number; carriedRaw: bigint }> | null = null,
): Promise<ExitAnswer> {
  const held = mandate.terms.heldCoin!;
  const proceeds = proceedsAccountOf(mandate.terms);
  /* Refused again and again: the next try waits after the last — her stop five minutes, any other sale half an hour — and never stops for good. */
  const tries = failingSales(entry.sales ?? []);
  const last = entry.sales?.at(-1);
  const retryMs = exitRetryMs(decision.why);
  if (tries >= FAILURES_TO_PAUSE && last && at - last.at < retryMs) return { line: "waited", entry };
  /* The day's limit of the sale's policy: what it still lets out today; the rest of the rules' amount waits for it. */
  const room = saleRoom(entry.sales ?? [], held.dailyMax, at);
  if (room <= 0n) return { line: "waited", entry };
  const amount = decision.amountRaw < room ? decision.amountRaw : room;
  const partial = amount < decision.amountRaw;
  /* Her switch, read just before the sale: a frozen agent starts nothing. */
  if (await isFrozen(deps.store, entry.cluster, entry.record.policy).catch(() => true)) return { line: "frozen", entry };
  /* Her stop's transaction was just built — no sale of the agent's may land before it but a stop of her rules. */
  if (decision.why !== "stop" && (await stopAsked(deps.store, entry.cluster, entry.record.policy, at))) return { line: "waited", entry };
  /* One sale a minute, and one for the state of the book it was decided on — atomically (`saleClaimKeys`). */
  const claims = saleClaimKeys(entry.cluster, entry.record.policy, entry.sales ?? [], at);
  if (!(await bookOf(deps.store).insertAllIfAbsent([claims.minute, ...claims.state].map((key) => ({ key, value: { claimedAt: at } }))))) return { line: "waited", entry };
  /* Nothing was sent: the state's claims go back, so the next minute may try again; the minute's stays. */
  const release = async () => {
    for (const key of claims.state) await bookOf(deps.store).delete(key).catch(() => undefined);
  };
  const signer = mandateSigner(deps.key, { mandate, policy: policyOf(mandate), journal: deps.journal, screen: deps.screen ?? storeScreen(deps.store, deps.gate.network) });
  const average = position.costRaw - costAfterSale(position.costRaw, position.heldRaw, amount);
  /* A grid's level carries its own buy's cost — never more than the position still holds, and only the share it sold. */
  const own = lot ? (lot.carriedRaw * amount) / decision.amountRaw : null;
  const carried = own === null ? average : own < position.costRaw ? own : position.costRaw;
  const base = { at, why: decision.why, soldRaw: amount.toString(), costRaw: carried.toString(), ...(partial ? { partial: true as const } : {}), ...(lot ? { level: lot.level } : {}) };
  let outcome: TradeOutcome;
  let minOut: bigint | null = null;
  /* From here on the sale may be on its way, whatever happens to this process. */
  const written: { open?: TradeOutcome } = {};
  try {
    const built = await deps.venue.sell!(mandate, amount, held.mint);
    minOut = tradeTerms({ programId: built.instruction.programId, accounts: built.instruction.keys.map((key) => key.pubkey), data: built.instruction.data })?.minOut ?? null;
    /*
     * A grid's level: the route's minimum — Ryntra's fee already out of it on either lane — covers the level's own cost and
     * the network's fees of its round trip (the signatures, the rent of an account the sale opens), or nothing is
     * signed. The level waits for the next mark (`gridShort`) — and this pass goes on to the buys: a price between the
     * level's line and its cost does not stop the grid.
     */
    if (own !== null && lot && !gridCoversCost({ outRaw: minOut, costRaw: own + gridNetworkRaw({ accountsOpened: await accountsOpened(deps.connection, built.setup) }) })) {
      await release();
      const short: BookEntry = { ...entry, gridShort: { level: lot.level, at }, updatedAt: at };
      await writeEntry(deps.store, short);
      return { line: null, entry: short };
    }
    outcome = await trade({
      connection: deps.connection,
      mandate,
      signer,
      side: "sell",
      venueInstruction: built.instruction,
      setup: built.setup,
      promisedOut: built.promisedOut,
      feeSides: built.feeSides,
      fee: built.fee,
      ...(built.lookupTables ? { lookupTables: built.lookupTables } : {}),
      ...(built.epoch === undefined ? {} : { epoch: built.epoch }),
      beforeSend: async ({ signature, validUntilHeight }) => {
        const open: TradeOutcome = { status: "unknown", signature, size: 0, validUntilHeight };
        await writeEntry(deps.store, withSale(entry, saleOf(open, base, null, minOut), at));
        written.open = open;
      },
    });
  } catch {
    /* Nothing was signed and sent: the network, Jupiter's rate or the route — no answer of the chain, so no failed sale. */
    if (!written.open) {
      await release();
      return notBuilt(entry, decision.why, tries, deps, at);
    }
    outcome = written.open;
  }
  const got = outcome.status === "landed" && outcome.ok ? await deps.venue.received(outcome.signature, proceeds).catch(() => null) : null;
  const row = saleOf(outcome, base, got, minOut);
  /* A sale was built: the stretch of ones that could not be is over. */
  const { exitStuckSince: _stuck, ...built } = withSale(entry, row, at);
  let next: BookEntry = built;
  if (row.status === "ok") {
    next = { ...next, events: withEvent(next.events, soldEvent(next, row, decision.share)) };
    /* A full exit pauses the buys — once: the rest of a stop the day's limit held back pauses nothing twice. */
    if (isFullExit(decision.why) && !(entry.status === "paused" && entry.pausedBy === decision.why)) next = pausedBy(next, decision.why, decision.why, at);
  } else if (!row.unsettled && failingSales(next.sales ?? []) === FAILURES_TO_PAUSE) {
    /* The third «no» in a row: the buys pause, she hears it at once, and the next try is `exitRetryMs` away. */
    next = pausedBy(next, "refused", "failing", at);
    next = { ...next, events: withEvent(next.events, failedEvent(next, decision.why, at, FAILURES_TO_PAUSE, at + retryMs)) };
  }
  await writeEntry(deps.store, next);
  return { line: row.status === "ok" ? "sold" : row.status, entry: next };
}

/**
 * A sale that could not be built: the stretch is kept (`exitStuckSince`), the next minute tries again, and once it has
 * lasted `EXIT_UNREAD_MS` she hears of it — once for the stretch.
 */
async function notBuilt(entry: BookEntry, why: ExitWhy, tries: number, deps: TickDeps, at: number): Promise<ExitAnswer> {
  const since = entry.exitStuckSince ?? at;
  let next: BookEntry = { ...entry, exitStuckSince: since, updatedAt: at };
  const told = (entry.events ?? []).some((event) => event.kind === "exit_failed" && event.at >= since);
  if (!told && at - since >= EXIT_UNREAD_MS) next = { ...next, events: withEvent(next.events, failedEvent(entry, why, at, tries, at + 60_000)) };
  await writeEntry(deps.store, next);
  return { line: "waited", entry: next };
}

/**
 * What the agent's book says her stop also removes (`./service.server.ts` `reviewStop`): the sale's policy beside the
 * buying one and the coin the agent keeps — only hers, of the same smart account; null when the book knows no sale for
 * it. A word only: the stop finds the sale on chain and checks this against it, and with the buy's policy standing it
 * needs no word at all.
 */
export const stopSale =
  (deps: Readonly<{ store: GuardStore; network: MandateNetwork }>): StopSale =>
  async ({ owner, settings, policy }) => {
    const entry = await readEntry(deps.store, policy.toBase58(), deps.network);
    const held = entry ? heldOfRecord(entry.record) : null;
    if (!entry || !held || entry.record.owner !== owner.toBase58() || entry.record.settings !== settings.toBase58()) return null;
    return { salePolicy: new PublicKey(entry.record.salePolicy!), held: { mint: held.mint, program: held.program } };
  };

/**
 * What the window and the report show for an agent that keeps its coin (the shape of `./sale.server.ts` `salesView`): what
 * it holds for her — what it bought less what it sold, never more than the vault holds — what its sales sold and brought
 * her, and its last sale. Only sales that landed count; one still in flight holds its coins out, brings nothing yet.
 */
export function agentSalesView(entry: Pick<BookEntry, "record" | "trades" | "sales">, vaultRaw: bigint | null): SalesView {
  const sales = entry.sales ?? [];
  const bought = entry.trades.reduce((sum, trade) => sum + (trade.status === "ok" ? BigInt(trade.receivedRaw ?? "0") : 0n), 0n);
  const out = sales.filter((sale) => sale.status === "ok" || sale.unsettled === true).reduce((sum, sale) => sum + BigInt(sale.soldRaw), 0n);
  const sold = sales.filter((sale) => sale.status === "ok").reduce((sum, sale) => sum + BigInt(sale.soldRaw), 0n);
  const got = sales.filter((sale) => sale.status === "ok").reduce((sum, sale) => sum + BigInt(sale.gotRaw ?? "0"), 0n);
  const last = sales.at(-1) ?? null;
  return {
    heldRaw: agentHolding(bought, out, vaultRaw).toString(),
    soldRaw: sold.toString(),
    gotRaw: got.toString(),
    lastSale: last
      ? { policy: entry.record.salePolicy ?? entry.record.policy, status: last.status === "ok" ? "sold" : last.unsettled ? "signed" : "failed", signature: last.signature, soldRaw: last.soldRaw, receivedRaw: last.gotRaw, reason: last.reason }
      : null,
  };
}
