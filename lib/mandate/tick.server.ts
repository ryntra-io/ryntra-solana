/**
 * The agent at work: one pass over its book, on the gate's network. For each mandate it works for, it reads what stands on
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
 * The book never loses a trade. A trade is written down with its signature before it is sent, so a function
 * killed right after sending leaves a row the next pass reads; until the chain has answered, no new buy. A row is called
 * «did not land» only when the RPC answered it has none and the blockhash is past its end; a read that failed is no answer.
 *
 * The key is the agent's alone, handed in as a `KeySigner` (the switch of `./agent-service.server.ts`: the deployment's
 * on devnet, or in KMS); this file reads no environment and holds no key.
 */

import { PublicKey, type AddressLookupTableAccount, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { GuardStore } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { bookOf, claimKey, fundOf, mandateOf, planOfEntry, readBook, readEntry, TRADES_KEPT, withTrade, writeEntry, type BookEntry, type BookStatus, type OpenGate } from "./book.server.ts";
import { frozenOn, isFrozen } from "./freeze.server.ts";
import { reconcile } from "./mission.ts";
import { DIP_WINDOW_MS, exitOf, planMarks, ruleOf, type ExchangeSession, type Mark } from "./plans.ts";
import { policyCarriesFee, type FeeSides } from "./fee.ts";
import { feeMintOf } from "./terms.ts";
import { isTokenProgram, type Coin } from "./token-2022.ts";
import { tokenAccountOf, type Mandate } from "./human.ts";
import { tradeTerms } from "./result.ts";
import { agentTrade, fateOf, policyOf, type TradeOutcome } from "./run.server.ts";
import { mandateSigner, type AgentJournal, type AgentSigner } from "./signer.server.ts";
import { storeScreen, type AgentScreen } from "./ryntra-coins.server.ts";
import { readPolicyHead, refusalOf } from "./ssa.ts";
import { AUTOSTOP, autostop, decide, steadyRhythm, type AgentTrade, type PauseReason } from "./strategy.ts";
import { exitFor, watchesExit } from "./exit.server.ts";
import { positionOf, positionSales, positionTrades, type ExitMarket } from "./exit.ts";
import { botSaleFor } from "./bots.server.ts";
import { gridOpenBuys } from "../bots/money/rules.ts";
import { botBuysOpen, botOfPlan, type EngineSwitches } from "../bots/money/gates.ts";

/** A dip's or a grid's price is read at most this often: the day's high from about 144 marks. */
export const MARK_EVERY_MS = 10 * 60_000;
/** The marks a mandate keeps: the last day's, at most this many. */
export const MARKS_KEPT = 160;
/** A price older than this is not the price now: the rule waits for a fresh one. */
export const MARK_FRESH_MS = 30 * 60_000;
/**
 * The widest step between two marks a signal's averages are read over — two of the agent's marks (a pass every
 * five minutes, a mark at most every ten; one quote missed is still under it). Wider, the averages are «unread».
 */
export const MARK_GAP_MS = 2 * MARK_EVERY_MS;

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
  /** The coin bought as the venue read it, and the chain's epoch when it withholds a transfer fee: its rate is the epoch's. */
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
  /**
   * The vault's sale of `amount` of the coin the agent keeps (`terms.heldCoin`), the money to her own account of
   * the budget's token, Ryntra's fee inside it — built, not sent; `promisedOut` in the budget's token. Absent — the venue
   * does not sell, and the agent only holds.
   */
  sell?(mandate: Mandate, amount: bigint, coin: PublicKey): Promise<VenueBuy>;
}>;

export type TickDeps = Readonly<{
  gate: OpenGate;
  store: GuardStore;
  connection: Connection;
  key: KeySigner;
  journal: AgentJournal;
  venue: Venue;
  /** What the agent never buys and whom it never trades with; the store's own registry when not handed in. */
  screen?: AgentScreen;
  now?: () => number;
  /** The one trade, end to end — `./run.server.ts` `agentTrade`; the tests hand in their own chain. */
  trade?: typeof agentTrade;
  /**
   * A stock's exchange now, for a plan bought only in its hours (`./agent-service.server.ts` `stockSessionOf`);
   * asked only when a buy is due. Absent, or no answer — the session is not known and the buy waits.
   */
  session?: (mint: string, now: number) => Promise<ExchangeSession | null>;
  /** The coin's trading now, for the exit's fade (`./exit.ts`); absent, or no answer — the fade is not applied. */
  market?: (mint: string) => Promise<ExitMarket>;
  /**
   * The deployment's switches, read by the cron's route from its environment and handed in
   * (`./agent-service.server.ts` `agentMinute`); this file reads none. Absent — every one closed:
   * - `agentExit` (`RYNTRA_AGENT_EXIT`) closed — the agent sells only by her stop (`./exit.ts` «stop»): half at 2x, the
   *   fade, the clock and a bot's own sales wait; buys of a budget that is no bot go on as ever;
   * - a bot's money (`RYNTRA_BOTS_*_MONEY`, `../bots/money/gates.ts` `botBuysOpen`) closed — that bot buys no new level and
   *   nothing on its signal; its sales go on while the agent's exit is open, her stop always.
   */
  switches?: EngineSwitches;
}>;

export type PassLine = Readonly<{ policy: string; did: "bought" | "failed" | "refused" | "waited" | "unread" | "frozen" | "sold" | "paused" | BookStatus }>;

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
 * Her account of the coin under its own program: a coin of Token-2022 lives in her Token-2022 account. A mint
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
 * The price now for a dip or a grid — what one whole coin fetches at the venue, the very quote the autostop
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

const buyerOf = (entry: BookEntry): PublicKey => new PublicKey(entry.record.salePolicy && entry.record.held ? entry.record.vault : entry.record.owner);

/** The entry with its open trades read again from the chain, kept in the book when anything changed. */
async function withSettled(entry: BookEntry, deps: TickDeps, known?: PublicKey): Promise<BookEntry> {
  if (!entry.trades.some(isOpen)) return entry;
  const receiver = known ?? (await receiverOf(deps, buyerOf(entry), new PublicKey(entry.receiveMint)));
  const trades = await settled(entry.trades, deps.connection, (signature) => deps.venue.received(signature, receiver));
  if (trades.every((row, index) => row === entry.trades[index])) return entry;
  const next = { ...entry, trades };
  await writeEntry(deps.store, next);
  return next;
}

/** Who the agent still works for: at work, or paused only because it could not read — that lifts once it reads. */
/* Not a pause for `blind` — the price of what it keeps unread: its exit lifts that (`./exit.server.ts`), not the buys. */
const atWork = (entry: BookEntry) => entry.status === "working" || (entry.status === "paused" && entry.pausedBy === "unread");

/** One pass over the book. A mandate that cannot be read costs only itself: its clock runs, the others go on. */
export async function runAgentPass(deps: TickDeps): Promise<readonly PassLine[]> {
  const now = deps.now ?? Date.now;
  const trade = deps.trade ?? agentTrade;
  const lines: PassLine[] = [];
  let traded = 0;
  const started = now();
  const book = await readBook(deps.store, deps.gate.network);
  /* Her «Freeze» switches, read once; a list not read is no switch off — nothing new is bought this pass. */
  const frozen = await frozenOn(deps.store, deps.gate.network).catch(() => null);
  for (const entry of book) {
    if (lines.length > 0 && now() - started >= PASS_STARTS_WITHIN_MS) break;
    /* A mandate whose agent keeps its coin is watched for its exit while it may still sell, at work or not. */
    const watching = watchesExit(entry);
    /* No longer trading, yet a trade it made may still have to be counted. */
    if (!atWork(entry) && !watching) {
      await withSettled(entry, deps).catch(() => entry);
      continue;
    }
    /* Frozen: what is on its way is still read back by its signature; nothing new starts. */
    if (!frozen || frozen.has(entry.record.policy)) {
      await withSettled(entry, deps).catch(() => entry);
      lines.push({ policy: entry.record.policy, did: frozen ? "frozen" : "unread" });
      continue;
    }
    if (traded >= TRADES_PER_PASS) break;
    let line: PassLine["did"] | null = null;
    try {
      /* The exit first: a sale, a wait for a price, or a pause is this pass's one move for the mandate. */
      /* What its buys brought is read first: the position the exit weighs is the chain's, not a guess. */
      const exit = watching ? await exitFor(await withSettled(entry, deps), deps, now, trade) : { line: null, entry };
      line = exit.line;
      /* Then a bot's own sale — a grid's level, a signal's leave; any other plan answers nothing without a read. */
      const bot = line === null && watching ? await botSaleFor(exit.entry, deps, now, trade) : { line, entry: exit.entry };
      line = bot.line;
      if (line === null && atWork(bot.entry)) line = await workFor(bot.entry, deps, now, trade);
      else if (line === null) await withSettled(bot.entry, deps).catch(() => bot.entry);
    } catch {
      line = await notRead(deps.store, entry.record.policy, now(), entry.cluster).catch(() => "unread" as const);
    }
    if (line === null) continue;
    lines.push({ policy: entry.record.policy, did: line });
    if (line === "bought" || line === "failed" || line === "refused" || line === "sold") traded += 1;
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
  /* Signed before Ryntra's fee rule: every agent trade pays the fee, so the agent no longer trades for it. */
  if (!policyCarriesFee(policy.data, feeMintOf(mandate.terms))) return settle(deps.store, given, "ended", at);
  /* Signed for another agent's key (the agent moved to KMS): no trade of this one could pass it. The person's stop needs no agent. */
  if (!namesAgent(policy.data, mandate.terms.agent)) return settle(deps.store, given, "ended", at);
  const coin = new PublicKey(given.receiveMint);
  const { receiver, decimals } = await coinOf(deps, mandate.terms.heldCoin ? mandate.vault : mandate.terms.human, coin);
  const entry = await withSettled(given, deps, receiver);
  const left = await deps.connection.getTokenAccountBalance(mandate.budgetAccount, "confirmed").then(
    (balance) => BigInt(balance.value.amount),
    () => null,
  );
  /* The person's strategy: its prices, its exit, its launch's age. It holds a buy back; it never adds one. */
  const plan = planOfEntry(entry);
  /* Its pace slows the rhythm; it never quickens it. */
  const decision = decide({ strategy: entry.strategy, perTrade: mandate.terms.perTrade, perDay: mandate.terms.perDay, expiresAt: mandate.terms.expiresAt, trades: entry.trades, budgetLeft: left, now: at, pace: plan.pace ?? null });
  if (decision.action === "end") return settle(deps.store, entry, decision.reason === "ended" ? "ended" : decision.reason === "spent" ? "spent" : "paused", at, decision.reason === "failing" ? "failing" : undefined);

  let working: BookEntry = entry;
  if (planMarks(plan) && decimals !== null) {
    const marks = await withMark(entry.marks ?? [], at, () => deps.venue.worth(mandate, 10n ** BigInt(decimals), coin));
    if (marks !== entry.marks && marks.length) working = { ...working, marks, ...(working.anchor === undefined ? { anchor: marks.at(-1)!.price } : {}) };
  }
  if (plan.id === "early" && working.bornAt !== undefined && at - working.bornAt > plan.maxAgeH * 3_600_000) return settle(deps.store, working, "paused", at, "late");
  /*
   * An agent that keeps its coin and sells it judges its buys by the position it holds now — the buys since its
   * last full exit, the coins its sales took out priced back in at the price now — so a half taken at 2x is no loss.
   */
  const position = mandate.terms.heldCoin ? positionTrades(entry.trades, entry.sales ?? []) : entry.trades;
  /*
   * A grid that sells stands in the levels it holds now — a level sold left with what it fetched, so a grid
   * that sold every level holds nothing to judge and buys again as the price comes down to its levels.
   */
  const sellingGrid = plan.id === "grid" && plan.sell === true && mandate.terms.heldCoin !== undefined;
  const ownTrades = sellingGrid ? gridOpenBuys(position, positionSales(entry.sales ?? [])) : position;
  const done = ownTrades.filter((row) => row.status === "ok");
  const bought = done.reduce((sum, row) => sum + BigInt(row.receivedRaw ?? "0"), 0n);
  const spent = done.reduce((sum, row) => sum + BigInt(row.spentRaw), 0n);
  const kept = sellingGrid ? bought : mandate.terms.heldCoin ? positionOf({ buys: entry.trades, sales: entry.sales ?? [], vaultRaw: null }).heldRaw : bought;
  /* The exit is looked at on every pass while it holds coins; the quote, once, serves the autostop too. */
  let worth: bigint | null | undefined = bought > 0n ? undefined : 0n;
  /* The coins it still holds, quoted; with some sold, the price now carried over to all it bought — the same price. */
  const quote = async () =>
    worth === undefined ? (worth = kept <= 0n ? null : await deps.venue.worth(mandate, kept, coin).then((value) => (kept === bought ? value : (value * bought) / kept), () => null)) : worth;
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
  /*
   * The engine's switch: a bot whose money (or the agent's own exit) the deployment closed buys nothing — no
   * new level, nothing on its signal. Its sales had their turn before this one; what it holds comes home by them or by
   * her stop. Any other plan is not asked.
   */
  const bot = botOfPlan(plan);
  if (bot !== null && !botBuysOpen(bot, deps.switches)) {
    if (working !== entry) await writeEntry(deps.store, working);
    return "waited";
  }

  /* A buy is due: the agent looks first. The quote is read only now, so a quiet hour costs no reads. */
  const look = autostop({ trades: ownTrades, worthRaw: (await quote()) ?? null, budgetLeft: left, unreadSince: entry.unreadSince ?? null, now: at });
  if (look.action === "pause") return settle(deps.store, working, "paused", at, look.reason);
  if (look.action === "wait") {
    if (entry.unreadSince === undefined) await writeEntry(deps.store, { ...working, unreadSince: at, updatedAt: at });
    else if (working !== entry) await writeEntry(deps.store, working);
    return "waited";
  }
  /*
   * The money adds up before every spend — the budget she moved in is what the done trades spent plus what the
   * vault holds on chain. A vault holding less than the book can explain is money moved outside the book: nothing more.
   */
  const books = reconcile({ budgetRaw: fundOf(entry), leftRaw: left, trades: entry.trades, full: entry.trades.length >= TRADES_KEPT });
  if (books.state === "off") return settle(deps.store, working, "paused", at, "mismatch");
  /* A level sold opens again. */
  const held = done.flatMap((row) => (row.level === undefined ? [] : [row.level]));
  /* A plan bought only in the exchange's hours reads the stock's session now — only here, with a buy due. */
  const session: ExchangeSession | undefined = plan.hours ? (((await deps.session?.(given.receiveMint, at).catch(() => null)) ?? null) ?? "unknown") : undefined;
  /* A signal on the coin's trading reads it now — only here, with a buy due; not read, the signal waits. */
  const market = plan.id === "signal" && plan.trigger.kind === "volume" ? ((await deps.market?.(given.receiveMint).catch(() => null)) ?? null) : undefined;
  const rule = ruleOf({
    plan,
    now: at,
    marks: freshMarks(working.marks, at),
    anchor: working.anchor ?? null,
    held,
    position: { spent, worth: (await quote()) ?? null },
    bornAt: working.bornAt ?? null,
    ...(session === undefined ? {} : { session }),
    ...(market === undefined ? {} : { market }),
    markGapMs: MARK_GAP_MS,
  });
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

  /* Her switch read again just before the spend — a freeze turned on while this pass ran stops this buy. */
  if (await isFrozen(deps.store, entry.cluster, entry.record.policy).catch(() => true)) return "frozen";
  /* One claim per slot of the rhythm: a second instance on the same pass finds it taken and waits. */
  const { everyMs } = steadyRhythm(mandate.terms.perTrade, mandate.terms.perDay, plan.pace ?? null);
  const slot = Math.floor(at / everyMs);
  if (!(await bookOf(deps.store).insertIfAbsent(claimKey(entry.cluster, entry.record.policy, slot), { claimedAt: at }))) return "waited";

  const signer: AgentSigner = mandateSigner(deps.key, { mandate, policy: policyOf(mandate), journal: deps.journal, screen: deps.screen ?? storeScreen(deps.store, deps.gate.network) });
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
