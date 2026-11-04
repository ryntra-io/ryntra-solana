/**
 * CITY-175 — the agent at work: one pass over its book, on the gate's network. For each mandate it works for, it reads what stands on
 * chain, asks the strategy (`./strategy.ts`) and, when a buy is due, makes it end to end — the venue's instruction for
 * the vault, inside the person's policy, judged and signed by the agent's own signer (`./signer.server.ts`), sent through
 * our RPC and read back (`./run.server.ts`). What happened goes into the book, the coins bought land in the person's
 * wallet in the same instruction.
 *
 * The agent never trades for a mandate that was taken back or has ended — it marks it so and leaves it; it never trades
 * the same slot twice (one claim per slot in the book, so two instances never both buy); and it never retries a trade on
 * its own: a refusal is the chain's answer, written down, and the next slot is the next try. Just before each buy it
 * asks `autostop` (`./strategy.ts`) with the chain's figures: whether what it bought is losing, and whether it can see.
 *
 * The book never loses a trade (CITY-179). A trade is written down with its signature before it is sent, so a function
 * killed right after sending leaves a row the next pass reads; until the chain has answered, no new buy. A row is called
 * «did not land» only when the RPC answered it has none and the blockhash is past its end; a read that failed is no answer.
 *
 * The key is the agent's alone, handed in as a `KeySigner` (the switch of `./agent-service.server.ts`: the deployment's
 * on devnet, or in KMS — CITY-179); this file reads no environment and holds no key.
 */

import { PublicKey, type AddressLookupTableAccount, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { GuardStore } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { bookOf, claimKey, mandateOf, planOfEntry, readBook, readEntry, withTrade, writeEntry, type BookEntry, type BookStatus, type OpenGate } from "./book.server.ts";
import { DIP_WINDOW_MS, exitOf, ruleOf, type Mark } from "./plans.ts";
import { policyCarriesFee, type FeeSides } from "./fee.ts";
import { feeMintOf } from "./terms.ts";
import { isTokenProgram, type Coin } from "./token-2022.ts";
import { tokenAccountOf, type Mandate } from "./human.ts";
import { tradeTerms } from "./result.ts";
import { agentTrade, fateOf, policyOf, type TradeOutcome } from "./run.server.ts";
import { mandateSigner, type AgentJournal, type AgentSigner } from "./signer.server.ts";
import { readPolicyHead, refusalOf } from "./ssa.ts";
import { AUTOSTOP, autostop, decide, steadyRhythm, type AgentTrade, type PauseReason } from "./strategy.ts";

/** A dip's or a grid's price is read at most this often (CITY-193): the day's high from about 144 marks. */
export const MARK_EVERY_MS = 10 * 60_000;
/** The marks a mandate keeps: the last day's, at most this many. */
export const MARKS_KEPT = 160;
/** A price older than this is not the price now: the rule waits for a fresh one. */
export const MARK_FRESH_MS = 30 * 60_000;

/** The most mandates one pass trades for: a pass fits a minute of the function's time. */
export const TRADES_PER_PASS = 6;

/**
 * After this long a pass starts no new mandate: the function has 60 s (`maxDuration`), and a trade already started takes
 * up to ~30 s — reads, the route, the signature, 12 s for the chain's answer. Whoever did not fit goes next pass.
 */
export const PASS_STARTS_WITHIN_MS = 25_000;

export type VenueBuy = Readonly<{
  instruction: TransactionInstruction;
  setup: readonly TransactionInstruction[];
  /** What the venue's quote says the person gets, base units of the coin. */
  promisedOut: bigint;
  /** The catalogue's facts of the pair the venue priced Ryntra's fee by (`./fee.ts`); the signer reads the rate from them again. */
  feeSides: FeeSides;
  /** The fee as its own instruction, where the venue does not carry it (devnet). */
  fee?: TransactionInstruction;
  lookupTables?: readonly AddressLookupTableAccount[];
  /** The coin bought as the venue read it, and the chain's epoch when it withholds a transfer fee: its rate is the epoch's (CITY-184). */
  coin?: Coin;
  epoch?: bigint;
}>;

export type Venue = Readonly<{
  /** The vault's buy of `coin` with `amount` of its budget, Ryntra's fee inside it, the output to `receiver` — built, not sent. */
  buy(mandate: Mandate, amount: bigint, receiver: PublicKey, coin: PublicKey): Promise<VenueBuy>;
  /** What landed on `receiver` in that transaction, read from the chain; null when not read. */
  received(signature: string, receiver: PublicKey): Promise<bigint | null>;
  /** Exactly `amount` of `coin` sold back at the price now, in the budget's token; throws when not read. */
  worth(mandate: Mandate, amount: bigint, coin: PublicKey): Promise<bigint>;
}>;

export type TickDeps = Readonly<{
  gate: OpenGate;
  store: GuardStore;
  connection: Connection;
  key: KeySigner;
  journal: AgentJournal;
  venue: Venue;
  now?: () => number;
  /** The one trade, end to end — `./run.server.ts` `agentTrade`; the tests hand in their own chain. */
  trade?: typeof agentTrade;
}>;

export type PassLine = Readonly<{ policy: string; did: "bought" | "failed" | "refused" | "waited" | "unread" | BookStatus }>;

/** What a trade's outcome is in the book. */
export function tradeOf(outcome: TradeOutcome, amount: bigint, received: bigint | null, at: number, minOut: bigint | null = null): AgentTrade {
  switch (outcome.status) {
    case "landed":
      return outcome.ok
        ? { at, status: "ok", signature: outcome.signature, spentRaw: amount.toString(), receivedRaw: received === null ? null : received.toString(), ...(minOut === null ? {} : { minOutRaw: minOut.toString() }), reason: null }
        : {
            at,
            status: "failed",
            signature: outcome.signature,
            spentRaw: "0",
            receivedRaw: null,
            reason: outcome.refusal?.reason ?? "failed on chain",
            ...(outcome.refusal?.code === "ProgramInteractionInsufficientTokenAllowance" ? { allowance: true } : {}),
          };
    case "refused-in-simulation":
      return { at, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: outcome.reason, ...(/day's budget is spent/.test(outcome.reason) ? { allowance: true } : {}) };
    case "refused-by-agent":
      return { at, status: "refused", signature: null, spentRaw: "0", receivedRaw: null, reason: outcome.reason };
    case "unknown":
      /* Sent, its fate unread: a try until the next pass reads the chain afresh (`settled`), and no buy until it has. */
      return { at, status: "failed", signature: outcome.signature, spentRaw: "0", receivedRaw: null, reason: "not confirmed in time", unsettledRaw: amount.toString(), validUntilHeight: outcome.validUntilHeight, ...(minOut === null ? {} : { minOutRaw: minOut.toString() }) };
  }
}

/** A trade with a figure still to read: its fate, or what it brought. */
const isOpen = (trade: AgentTrade) => trade.unsettledRaw !== undefined || (trade.status === "ok" && trade.receivedRaw === null);

/**
 * The trades whose figures the last pass could not read, read again from the chain: a trade whose fate was unknown becomes
 * what the chain says it was; a trade that landed gets what it brought. It «did not land» only when the RPC answered it has
 * none and the block height, read first and finalized, is past its blockhash's end. Unchanged rows are returned as they are.
 */
export async function settled(trades: readonly AgentTrade[], connection: Pick<Connection, "getTransaction" | "getBlockHeight">, read: (signature: string) => Promise<bigint | null>): Promise<readonly AgentTrade[]> {
  return Promise.all(
    trades.map(async (trade) => {
      if (!isOpen(trade) || !trade.signature) return trade;
      if (trade.unsettledRaw === undefined) {
        const received = await read(trade.signature).catch(() => null);
        return received === null ? trade : { ...trade, receivedRaw: received.toString() };
      }
      const { unsettledRaw, validUntilHeight, ...rest } = trade;
      const height = validUntilHeight === undefined ? null : await connection.getBlockHeight("finalized").catch(() => null);
      const fate = await fateOf(connection, trade.signature);
      if (fate.state === "unread") return trade;
      if (fate.state === "absent") return height !== null && validUntilHeight !== undefined && height > validUntilHeight + AUTOSTOP.settledBlocks ? { ...rest, reason: "did not land" } : trade;
      if (!fate.ok) {
        const refusal = refusalOf(fate.logs);
        return { ...rest, reason: refusal?.reason ?? "failed on chain", ...(refusal?.code === "ProgramInteractionInsufficientTokenAllowance" ? { allowance: true } : {}) };
      }
      const received = await read(trade.signature).catch(() => null);
      return { ...rest, status: "ok" as const, spentRaw: unsettledRaw, receivedRaw: received === null ? null : received.toString(), reason: null };
    }),
  );
}

/**
 * Her account of the coin under its own program: a coin of Token-2022 lives in her Token-2022 account (CITY-184). A mint
 * not read is no guess at Token's account — what reached her would be read off the wrong one; the pass leaves it unknown.
 */
async function receiverOf(deps: TickDeps, owner: PublicKey, coin: PublicKey): Promise<PublicKey> {
  return (await coinOf(deps, owner, coin)).receiver;
}

/** Her account of the coin, and the coin's decimals — a mint's 45th byte under either program. */
async function coinOf(deps: TickDeps, owner: PublicKey, coin: PublicKey): Promise<Readonly<{ receiver: PublicKey; decimals: number | null }>> {
  const info = await deps.connection.getAccountInfo(coin, "confirmed");
  if (!info || !isTokenProgram(info.owner)) throw new Error("the coin's mint could not be read");
  const decimals = info.data.length > 44 ? info.data[44]! : null;
  return { receiver: tokenAccountOf(owner, coin, info.owner), decimals: decimals !== null && decimals <= 18 ? decimals : null };
}

/**
 * CITY-193: the price now for a dip or a grid — what one whole coin fetches at the venue, the very quote the autostop
 * reads — added to the marks at most every `MARK_EVERY_MS`, the last day's kept. A quote not read adds nothing.
 */
export async function withMark(marks: readonly Mark[], at: number, quote: () => Promise<bigint>): Promise<readonly Mark[]> {
  const last = marks.at(-1);
  if (last && at - last.at < MARK_EVERY_MS) return marks;
  const price = await quote().then(
    (value) => Number(value),
    () => null,
  );
  if (price === null || !(price > 0)) return marks;
  return [...marks, { at, price }].filter((mark) => at - mark.at <= DIP_WINDOW_MS).slice(-MARKS_KEPT);
}

/** The marks the rule may read: none when the newest is not fresh — an old price is not the price now. */
const freshMarks = (marks: readonly Mark[] | undefined, at: number): readonly Mark[] => (marks?.length && at - marks.at(-1)!.at <= MARK_FRESH_MS ? marks : []);

/** The entry with its open trades read again from the chain, kept in the book when anything changed. */
async function withSettled(entry: BookEntry, deps: TickDeps, known?: PublicKey): Promise<BookEntry> {
  if (!entry.trades.some(isOpen)) return entry;
  const receiver = known ?? (await receiverOf(deps, new PublicKey(entry.record.owner), new PublicKey(entry.receiveMint)));
  const trades = await settled(entry.trades, deps.connection, (signature) => deps.venue.received(signature, receiver));
  if (trades.every((row, index) => row === entry.trades[index])) return entry;
  const next = { ...entry, trades };
  await writeEntry(deps.store, next);
  return next;
}

/** Who the agent still works for: at work, or paused only because it could not read — that lifts once it reads. */
const atWork = (entry: BookEntry) => entry.status === "working" || (entry.status === "paused" && entry.pausedBy === "unread");

/** One pass over the book. A mandate that cannot be read costs only itself: its clock runs, the others go on. */
export async function runAgentPass(deps: TickDeps): Promise<readonly PassLine[]> {
  const now = deps.now ?? Date.now;
  const trade = deps.trade ?? agentTrade;
  const lines: PassLine[] = [];
  let traded = 0;
  const started = now();
  const book = await readBook(deps.store, deps.gate.network);
  for (const entry of book) {
    if (lines.length > 0 && now() - started >= PASS_STARTS_WITHIN_MS) break;
    /* No longer trading, yet a trade it made may still have to be counted. */
    if (!atWork(entry)) {
      await withSettled(entry, deps).catch(() => entry);
      continue;
    }
    if (traded >= TRADES_PER_PASS) break;
    let line: PassLine["did"];
    try {
      line = await workFor(entry, deps, now, trade);
    } catch {
      line = await notRead(deps.store, entry.record.policy, now(), entry.cluster).catch(() => "unread" as const);
    }
    lines.push({ policy: entry.record.policy, did: line });
    if (line === "bought" || line === "failed" || line === "refused") traded += 1;
  }
  return lines;
}

async function settle(store: GuardStore, entry: BookEntry, status: BookStatus, now: number, pausedBy?: PauseReason): Promise<BookStatus> {
  const { pausedBy: _was, ...rest } = entry;
  await writeEntry(store, { ...rest, status, ...(pausedBy ? { pausedBy } : {}), updatedAt: now });
  return status;
}

/** A pass could not read a mandate at all: its clock starts, or — run out — it pauses. The book's own row, read afresh: never an older copy over a trade just written. */
async function notRead(store: GuardStore, policy: string, now: number, cluster: BookEntry["cluster"]): Promise<"unread" | BookStatus> {
  const entry = await readEntry(store, policy, cluster);
  if (!entry || !atWork(entry)) return "unread";
  if (entry.unreadSince !== undefined && now - entry.unreadSince >= AUTOSTOP.unreadMs) return settle(store, entry, "paused", now, "unread");
  if (entry.unreadSince === undefined) await writeEntry(store, { ...entry, unreadSince: now, updatedAt: now });
  return "unread";
}

/** The agent cannot reach the chain at all, so no pass runs: every mandate's clock runs all the same. */
export async function markUnread(store: GuardStore, now: number, cluster: BookEntry["cluster"] = "devnet"): Promise<void> {
  for (const entry of await readBook(store, cluster)) if (atWork(entry)) await notRead(store, entry.record.policy, now, cluster);
}

/**
 * Whether the policy names this agent as its one signer. A policy that cannot be read throws: that is a pass that did not
 * read, whose clock runs (`notRead`) — never a mandate ended for good.
 */
function namesAgent(data: Uint8Array, agent: PublicKey): boolean {
  const head = readPolicyHead(data);
  return head.signers.length === 1 && head.signers[0]!.key.equals(agent);
}

async function workFor(given: BookEntry, deps: TickDeps, now: () => number, trade: typeof agentTrade): Promise<PassLine["did"]> {
  const mandate = mandateOf(given, deps.gate);
  const at = now();
  /* Taken back by the person: from her one signature on, the agent leaves this mandate alone. */
  const policy = await deps.connection.getAccountInfo(mandate.policy, "confirmed");
  if (!policy) return settle(deps.store, given, "stopped", at);
  /* Signed before Ryntra's fee rule (CITY-183): every agent trade pays the fee, so the agent no longer trades for it. */
  if (!policyCarriesFee(policy.data, feeMintOf(mandate.terms))) return settle(deps.store, given, "ended", at);
  /* Signed for another agent's key (CITY-186: the agent moved to KMS): no trade of this one could pass it. The person's stop needs no agent. */
  if (!namesAgent(policy.data, mandate.terms.agent)) return settle(deps.store, given, "ended", at);
  const coin = new PublicKey(given.receiveMint);
  const { receiver, decimals } = await coinOf(deps, mandate.terms.human, coin);
  const entry = await withSettled(given, deps, receiver);
  const left = await deps.connection.getTokenAccountBalance(mandate.budgetAccount, "confirmed").then(
    (balance) => BigInt(balance.value.amount),
    () => null,
  );
  const decision = decide({ strategy: entry.strategy, perTrade: mandate.terms.perTrade, perDay: mandate.terms.perDay, expiresAt: mandate.terms.expiresAt, trades: entry.trades, budgetLeft: left, now: at });
  if (decision.action === "end") return settle(deps.store, entry, decision.reason === "ended" ? "ended" : decision.reason === "spent" ? "spent" : "paused", at, decision.reason === "failing" ? "failing" : undefined);

  /* CITY-193 — the person's strategy: its prices, its exit, its launch's age. It holds a buy back; it never adds one. */
  const plan = planOfEntry(entry);
  let working: BookEntry = entry;
  if ((plan.id === "dip" || plan.id === "grid") && decimals !== null) {
    const marks = await withMark(entry.marks ?? [], at, () => deps.venue.worth(mandate, 10n ** BigInt(decimals), coin));
    if (marks !== entry.marks && marks.length) working = { ...working, marks, ...(working.anchor === undefined ? { anchor: marks.at(-1)!.price } : {}) };
  }
  if (plan.id === "early" && working.bornAt !== undefined && at - working.bornAt > plan.maxAgeH * 3_600_000) return settle(deps.store, working, "paused", at, "late");
  const done = entry.trades.filter((row) => row.status === "ok");
  const bought = done.reduce((sum, row) => sum + BigInt(row.receivedRaw ?? "0"), 0n);
  const spent = done.reduce((sum, row) => sum + BigInt(row.spentRaw), 0n);
  /* The exit is looked at on every pass while it holds coins; the quote, once, serves the autostop too. */
  let worth: bigint | null | undefined = bought > 0n ? undefined : 0n;
  const quote = async () => (worth === undefined ? (worth = await deps.venue.worth(mandate, bought, coin).catch(() => null)) : worth);
  if (plan.exit && bought > 0n && !entry.trades.some(isOpen)) {
    const exit = exitOf(plan.exit, { spent, worth: await quote() });
    if (exit) return settle(deps.store, working, "paused", at, exit);
  }

  const { unreadSince: _seen, pausedBy: _paused, ...reading } = working;
  if (decision.action === "wait") {
    /* Everything this pass needed was read: an old blip must not count towards a later one. */
    if (entry.unreadSince !== undefined && left !== null && !entry.trades.some(isOpen)) await writeEntry(deps.store, { ...reading, ...(entry.pausedBy ? { pausedBy: entry.pausedBy } : {}) });
    else if (working !== entry) await writeEntry(deps.store, working);
    return "waited";
  }

  /* A buy is due: the agent looks first. The quote is read only now, so a quiet hour costs no reads. */
  const look = autostop({ trades: entry.trades, worthRaw: (await quote()) ?? null, budgetLeft: left, unreadSince: entry.unreadSince ?? null, now: at });
  if (look.action === "pause") return settle(deps.store, working, "paused", at, look.reason);
  if (look.action === "wait") {
    if (entry.unreadSince === undefined) await writeEntry(deps.store, { ...working, unreadSince: at, updatedAt: at });
    else if (working !== entry) await writeEntry(deps.store, working);
    return "waited";
  }
  const held = done.flatMap((row) => (row.level === undefined ? [] : [row.level]));
  const rule = ruleOf({ plan, now: at, marks: freshMarks(working.marks, at), anchor: working.anchor ?? null, held, position: { spent, worth: (await quote()) ?? null }, bornAt: working.bornAt ?? null });
  if (rule.do === "exit") return settle(deps.store, working, "paused", at, rule.why);
  if (rule.do === "hold") {
    if (rule.why === "too-old") return settle(deps.store, working, "paused", at, "late");
    /* Not the moment by the strategy: what it saw is kept, the clock of what it could not read is over. */
    const kept: BookEntry = { ...reading, ...(entry.status === "working" ? {} : { status: "working" as const }) };
    if (working !== entry || entry.unreadSince !== undefined || entry.status !== "working") await writeEntry(deps.store, kept);
    return "waited";
  }
  const level = rule.level === undefined ? {} : { level: rule.level };
  /* It sees everything: the clock is over, and a pause for not seeing with it. */
  const seeing: BookEntry = { ...reading, status: "working" };
  if (working !== entry || entry.unreadSince !== undefined || entry.status !== "working") await writeEntry(deps.store, seeing);

  /* One claim per slot of the rhythm: a second instance on the same pass finds it taken and waits. */
  const { everyMs } = steadyRhythm(mandate.terms.perTrade, mandate.terms.perDay);
  const slot = Math.floor(at / everyMs);
  if (!(await bookOf(deps.store).insertIfAbsent(claimKey(entry.cluster, entry.record.policy, slot), { claimedAt: at }))) return "waited";

  const signer: AgentSigner = mandateSigner(deps.key, { mandate, policy: policyOf(mandate), journal: deps.journal });
  let outcome: TradeOutcome;
  let minOut: bigint | null = null;
  /* From here on the trade may be on its way, whatever happens to this process. */
  const written: { open?: TradeOutcome } = {};
  try {
    const built = await deps.venue.buy(mandate, decision.amount, receiver, coin);
    minOut = tradeTerms({ programId: built.instruction.programId, accounts: built.instruction.keys.map((key) => key.pubkey), data: built.instruction.data })?.minOut ?? null;
    outcome = await trade({
      connection: deps.connection,
      mandate,
      signer,
      venueInstruction: built.instruction,
      setup: built.setup,
      promisedOut: built.promisedOut,
      feeSides: built.feeSides,
      fee: built.fee,
      ...(built.lookupTables ? { lookupTables: built.lookupTables } : {}),
      ...(built.coin ? { coin: built.coin } : {}),
      ...(built.epoch === undefined ? {} : { epoch: built.epoch }),
      beforeSend: async ({ signature, validUntilHeight }) => {
        const open: TradeOutcome = { status: "unknown", signature, size: 0, validUntilHeight };
        await writeEntry(deps.store, withTrade(seeing, { ...tradeOf(open, decision.amount, null, at, minOut), ...level }, at));
        written.open = open;
      },
    });
  } catch (error) {
    outcome = written.open ?? { status: "refused-in-simulation", reason: error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "not built" };
  }
  const received = outcome.status === "landed" && outcome.ok ? await deps.venue.received(outcome.signature, receiver).catch(() => null) : null;
  const row: AgentTrade = { ...tradeOf(outcome, decision.amount, received, at, minOut), ...level };
  await writeEntry(deps.store, withTrade(seeing, row, at));
  return row.status === "ok" ? "bought" : row.status;
}

/** The agent's journal in the store's `agentSignatures`: written once per row, or the signature is not given back. */
export function agentJournal(store: () => GuardStore, log: (line: string) => void = (line) => console.info(line)): AgentJournal {
  return async (row) => {
    const key = `solana:${row.cluster}:agent:${row.at}:${row.messageSha256.slice(0, 16)}:${row.outcome}`;
    const written = await store().collection<typeof row>("agentSignatures").insertIfAbsent(key, row);
    if (!written) throw new Error("the agent's journal already has this row");
    try {
      log(JSON.stringify({ event: "agent.signature", ...row }));
    } catch {
      /* The store holds the row. */
    }
  };
}

/** What landed on `receiver` in the transaction: its token balance after, less before. */
export async function receivedIn(connection: Pick<Connection, "getTransaction">, signature: string, receiver: PublicKey): Promise<bigint | null> {
  const read = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!read?.meta) return null;
  const keys = read.transaction.message.getAccountKeys({ accountKeysFromLookups: read.meta.loadedAddresses ?? null });
  let index = -1;
  for (let i = 0; i < keys.length; i += 1) if (keys.get(i)?.equals(receiver)) index = i;
  if (index < 0) return null;
  const amount = (list: typeof read.meta.preTokenBalances) => BigInt(list?.find((balance) => balance.accountIndex === index)?.uiTokenAmount.amount ?? "0");
  const delta = amount(read.meta.postTokenBalances) - amount(read.meta.preTokenBalances);
  return delta >= 0n ? delta : null;
}
