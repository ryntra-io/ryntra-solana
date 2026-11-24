/**
 * One pass of the paper agent: the agent's own pass (`../tick.server.ts` `workFor`), step for step, with the
 * chain's figures replaced by the live route's quotes and the trade by a paper row. Nothing here signs, sends or reads
 * a wallet; the reads are handed in (`./reads.server.ts` on mainnet, fixtures in the tests).
 *
 * The same rules, imported: the mandate's rhythm, day's cap and end (`decide`), its own pause before a buy (`autostop`),
 * the plan's exit, rule and a dip's or a grid's price marks (`exitOf`, `ruleOf`, `withMark`), an early plan's age and a
 * stock's exchange hours.
 * What the agent does with money, the paper agent does on paper — and only that:
 * - a buy due by the rules is the trade cap: Ryntra's fee at the pair's rate taken from it, the rest priced by the
 *   route's quote now; the coins that quote names are the paper agent's;
 * - a pair the table names no agent fee for is no agent trade (`../fee.ts`): a failed paper trade, as the agent's own;
 * - a price it could not read is no guess: the pass waits, and after `AUTOSTOP.unreadMs` the agent pauses, as the agent;
 * - the person's exit pauses it and holds — the agent with money does not sell on mainnet today;
 * - A bot's own sale — a grid's level one step up, everything once a «cross» signal turned — is the agent's
 *   own turn before any buy (`../bots.server.ts`), on paper: the same rule (`../../bots/money/rules.ts`), the route's
 *   quote for exactly those coins, Ryntra's fee at the pair's rate taken from what she would receive. A bot's budget spent,
 *   it still sells what it holds until its week is over.
 */

import { exitOf, planFrom, planLeaves, planMarks, ruleOf, STEADY, type ExchangeSession, type Mark, type StrategyPlan } from "../plans.ts";
import { AUTOSTOP, autostop, decide, type PauseReason } from "../strategy.ts";
import { MARK_FRESH_MS, MARK_GAP_MS, withMark } from "../tick.server.ts";
import { agentFeeRaw } from "../fee-rates.ts";
import { botOfPlan } from "../../bots/money/gates.ts";
import { gridCoversCost, gridLots, gridNetworkRaw, gridOpenBuys, gridSaleDue, gridSaleNext } from "../../bots/money/rules.ts";
import { budgetOf, costOf, heldOf, leftOf, paperAtWork, paperBuy, PAPER_TRADES_KEPT, routedOf, type PaperAgent, type PaperDoneBy, type PaperSale, type PaperTrade } from "./model.ts";

/** The live reads of one coin a pass needs. Each throws when not read; nothing is guessed. */
export type PaperReads = Readonly<{
  /** The coins `lamports` of SOL buy at the route's price now (Ryntra's fee already taken off the input). */
  buy(lamports: bigint): Promise<bigint>;
  /** Exactly `coins` sold back into SOL at the route's price now, lamports, before Ryntra's fee. */
  worth(coins: bigint): Promise<bigint>;
  /** Ryntra's fee on buying the coin and on selling it back, basis points, by the table; null — not an agent trade. */
  fees(): Promise<Readonly<{ buyBps: number | null; sellBps: number | null }>>;
  /**
   * A stock's exchange now, for a plan bought only in its hours — asked only when a buy is due, as the agent
   * asks it. Absent, or no answer — the session is not known and the buy waits.
   */
  session?(now: number): Promise<ExchangeSession | null>;
  /** The coin's trading now, for a signal on the trading — asked only when a buy is due; absent — the signal waits. */
  market?(): Promise<Readonly<{ volumeH6Usd: number | null; volumeH24Usd: number | null }> | null>;
}>;

export type PaperDid = "bought" | "failed" | "waited" | "unread" | "paused" | "done" | "sold";

export type PaperStep = Readonly<{ agent: PaperAgent; did: PaperDid }>;

/** The marks the rule may read: none when the newest is not fresh — an old price is not the price now (as the agent's pass). */
const freshMarks = (marks: readonly Mark[] | undefined, at: number): readonly Mark[] => (marks?.length && at - marks.at(-1)!.at <= MARK_FRESH_MS ? marks : []);

const withTrade = (agent: PaperAgent, trade: PaperTrade): readonly PaperTrade[] => [...agent.trades, trade].slice(-PAPER_TRADES_KEPT);

function settle(agent: PaperAgent, at: number, status: "paused", pausedBy: PauseReason): PaperStep;
function settle(agent: PaperAgent, at: number, status: "done", doneBy: PaperDoneBy): PaperStep;
function settle(agent: PaperAgent, at: number, status: "paused" | "done", why: PauseReason | PaperDoneBy): PaperStep {
  const { pausedBy: _paused, unreadSince: _seen, ...rest } = agent;
  const next: PaperAgent = status === "done" ? { ...rest, status, doneBy: why as PaperDoneBy, updatedAt: at } : { ...rest, status, pausedBy: why as PauseReason, updatedAt: at };
  return { agent: next, did: status === "done" ? "done" : "paused" };
}

/** A pass that could not read: its clock starts, or — run out — it pauses, as the agent's `notRead`. */
function notRead(agent: PaperAgent, at: number): PaperStep {
  if (agent.unreadSince !== undefined && at - agent.unreadSince >= AUTOSTOP.unreadMs) return settle(agent, at, "paused", "unread");
  return { agent: { ...agent, unreadSince: agent.unreadSince ?? at, updatedAt: at }, did: "unread" };
}

/** The buys a bot on paper is judged by — a grid's open levels, a signal's since its last sale; the rest, all. */
function ownTrades(agent: PaperAgent, plan: StrategyPlan): readonly PaperTrade[] {
  const sales = agent.sales ?? [];
  if (plan.id === "grid" && plan.sell) return gridOpenBuys(agent.trades, sales);
  const last = sales.filter((sale) => sale.why === "signal").at(-1);
  return last ? agent.trades.filter((trade) => trade.at > last.at) : agent.trades;
}

/** A paper agent with one more sale, the newest kept. */
const withSale = (agent: PaperAgent, sale: PaperSale): readonly PaperSale[] => [...(agent.sales ?? []), sale].slice(-PAPER_TRADES_KEPT);

/**
 * A bot's own turn on paper, before any buy, as the agent's (`../bots.server.ts` `botSaleFor`): the grid's
 * deepest level due, weighed against its own line with the route's quote for exactly its coins, or everything once a
 * «cross» signal turned. Its marks are read here too, so a bot whose budget is spent still sells. A quote not read is no
 * sale; the buys' turn then reads what it needs and keeps its own clock.
 */
async function paperBotSale(given: PaperAgent, plan: StrategyPlan, reads: PaperReads, at: number): Promise<PaperStep> {
  let working = given;
  if (planMarks(plan)) {
    const marks = await withMark(given.marks ?? [], at, () => reads.worth(BigInt(given.unitRaw)));
    if (marks !== given.marks && marks.length) working = { ...working, marks, ...(working.anchor === undefined ? { anchor: marks.at(-1)!.price } : {}) };
  }
  const waited: PaperStep = { agent: working, did: "waited" };
  const held = heldOf(working);
  if (held <= 0n) return waited;
  const marks = freshMarks(working.marks, at);
  const anchor = working.anchor ?? null;
  let sale: Readonly<{ why: "grid" | "signal"; coins: bigint; cost: bigint; level?: number }> | null = null;
  if (plan.id === "grid") {
    const lots = gridLots(working.trades, working.sales ?? []);
    const lot = gridSaleNext({ anchor, stepBps: plan.stepBps, lots, price: marks.at(-1)?.price ?? null });
    if (lot && anchor !== null) {
      const coins = lot.coinsRaw < held ? lot.coinsRaw : held;
      sale = { why: "grid", coins, cost: coins === lot.coinsRaw ? lot.costRaw : (lot.costRaw * coins) / lot.coinsRaw, level: lot.level };
      const quote = await reads.worth(coins).catch(() => null);
      if (!gridSaleDue({ anchor, stepBps: plan.stepBps, level: lot.level, coinsRaw: coins, quoteRaw: quote, unitRaw: BigInt(working.unitRaw) })) return waited;
    }
  } else if (planLeaves(plan, { marks, anchor, now: at, markGapMs: MARK_GAP_MS })) {
    sale = { why: "signal", coins: held, cost: costOf(working) };
  }
  if (!sale) return waited;
  const [quote, fees] = await Promise.all([reads.worth(sale.coins).catch(() => null), reads.fees().catch(() => null)]);
  if (quote === null || quote <= 0n || fees === null || fees.sellBps === null) return waited;
  const fee = agentFeeRaw(quote, fees.sellBps);
  /* A grid's level on paper as with money: what the sale brings after the fee covers the level's own cost and the network's fees of its round trip. */
  if (sale.why === "grid" && !gridCoversCost({ outRaw: quote - fee, costRaw: sale.cost + gridNetworkRaw() })) return waited;
  const row: PaperSale = { at, why: sale.why, status: "ok", soldRaw: sale.coins.toString(), gotRaw: (quote - fee).toString(), costRaw: sale.cost.toString(), feeRaw: fee.toString(), paper: true, signature: null, ...(sale.level === undefined ? {} : { level: sale.level }) };
  const sold: PaperAgent = { ...working, sales: withSale(working, row), exitBps: fees.sellBps, updatedAt: at };
  /* What it still holds, quoted back at once: the screen's result never leaves the sale out. */
  const left = heldOf(sold);
  const worth = left > 0n ? await reads.worth(left).catch(() => null) : 0n;
  return { agent: { ...sold, worthRaw: worth === null ? null : worth.toString(), worthAt: worth === null ? null : at }, did: "sold" };
}

/** One pass for one paper agent at `at`. A paper agent that no longer trades comes back untouched. */
export async function paperStep(given: PaperAgent, reads: PaperReads, at: number): Promise<PaperStep> {
  if (!paperAtWork(given)) return { agent: given, did: "waited" };
  if (at >= given.endsAt) return settle(given, at, "done", "week");
  const plan = planFrom(given.plan) ?? STEADY;
  /* A bot's own sale first — one move a pass, as the agent with money. */
  if (botOfPlan(plan) === null) return paperBuyStep(given, plan, reads, at);
  const turn = await paperBotSale(given, plan, reads, at);
  return turn.did === "sold" ? turn : paperBuyStep(turn.agent, plan, reads, at);
}

/** The buys' turn of a pass — the agent's `workFor`, on paper. */
async function paperBuyStep(given: PaperAgent, plan: StrategyPlan, reads: PaperReads, at: number): Promise<PaperStep> {
  const budget = budgetOf(given);
  const left = leftOf(given);
  const decision = decide({ strategy: plan.id, perTrade: budget.perTrade, perDay: budget.perDay, expiresAt: BigInt(Math.floor(given.endsAt / 1000)), trades: given.trades, budgetLeft: left, now: at, pace: plan.pace ?? null });
  /* A bot whose budget is spent still holds coins to sell — its week goes on without buys. */
  if (decision.action === "end" && decision.reason === "spent" && botOfPlan(plan) !== null && heldOf(given) > 0n) return { agent: { ...given, updatedAt: at }, did: "waited" };
  if (decision.action === "end") return decision.reason === "failing" ? settle(given, at, "paused", "failing") : settle(given, at, "done", decision.reason === "spent" ? "spent" : "week");

  let working: PaperAgent = given;
  if (planMarks(plan)) {
    const marks = await withMark(given.marks ?? [], at, () => reads.worth(BigInt(given.unitRaw)));
    if (marks !== given.marks && marks.length) working = { ...working, marks, ...(working.anchor === undefined ? { anchor: marks.at(-1)!.price } : {}) };
  }
  if (plan.id === "early" && working.bornAt !== null && at - working.bornAt > plan.maxAgeH * 3_600_000) return settle(working, at, "paused", "late");

  const held = heldOf(given);
  const spent = costOf(given);
  /* The coins it holds, quoted back once a pass: the exit, the autostop, the rule and the screen read the same figure. */
  let worth: bigint | null = held > 0n ? null : 0n;
  if (held > 0n) {
    worth = await reads.worth(held).catch(() => null);
    if (worth !== null) working = { ...working, worthRaw: worth.toString(), worthAt: at };
  }
  if (plan.exit && held > 0n) {
    const exit = exitOf(plan.exit, { spent, worth });
    if (exit) return settle(working, at, "paused", exit);
  }

  const { unreadSince: _seen, pausedBy: _paused, ...reading } = working;
  if (decision.action === "wait") {
    /*
     * Everything a wait needs was read (the agent reads no price on a wait but its exit's): an old blip must not count
     * towards a later one. The quote for the screen, when it fails, leaves the last figure and its time standing.
     */
    return { agent: { ...reading, ...(given.pausedBy ? { pausedBy: given.pausedBy } : {}), updatedAt: at }, did: "waited" };
  }

  /* A buy is due: the agent looks first, with the same figures — a bot by the buys it still stands in. */
  const own = given.sales?.length ? ownTrades(given, plan) : given.trades;
  const look = autostop({ trades: own, worthRaw: own.some((trade) => trade.status === "ok") ? worth : null, budgetLeft: left, unreadSince: given.unreadSince ?? null, now: at });
  if (look.action === "pause") return settle(working, at, "paused", look.reason);
  if (look.action === "wait") return { agent: { ...working, unreadSince: working.unreadSince ?? at, updatedAt: at }, did: "waited" };

  const levels = own.flatMap((trade) => (trade.status === "ok" && trade.level !== undefined ? [trade.level] : []));
  const session: ExchangeSession | undefined = plan.hours ? (((await reads.session?.(at).catch(() => null)) ?? null) ?? "unknown") : undefined;
  const market = plan.id === "signal" && plan.trigger.kind === "volume" ? ((await reads.market?.().catch(() => null)) ?? null) : undefined;
  const rule = ruleOf({
    plan,
    now: at,
    marks: freshMarks(working.marks, at),
    anchor: working.anchor ?? null,
    held: levels,
    position: { spent, worth },
    bornAt: working.bornAt,
    ...(session === undefined ? {} : { session }),
    ...(market === undefined ? {} : { market }),
    markGapMs: MARK_GAP_MS,
  });
  if (rule.do === "exit") return settle(working, at, "paused", rule.why);
  if (rule.do === "hold") {
    if (rule.why === "too-old") return settle(working, at, "paused", "late");
    return { agent: { ...reading, status: "working", updatedAt: at }, did: "waited" };
  }

  /* The paper buy: the pair's fee by the table, the route's quote for the rest. */
  const fees = await reads.fees().catch(() => null);
  if (fees === null) return notRead(working, at);
  const level = rule.level === undefined ? {} : { level: rule.level };
  if (fees.buyBps === null) {
    const refused: PaperTrade = { at, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: "the agent does not trade this pair", paper: true, feeRaw: "0", ...level };
    return { agent: { ...reading, status: "working", trades: withTrade(given, refused), updatedAt: at }, did: "failed" };
  }
  const coins = await reads.buy(routedOf(decision.amount, fees.buyBps)).catch(() => null);
  if (coins === null || coins <= 0n) return notRead(working, at);
  const trade = paperBuy({ at, amount: decision.amount, feeBps: fees.buyBps, coins, ...level });
  const trades = withTrade(given, trade);
  /* Every coin it now holds, quoted back at once: the screen's result never leaves the newest buy out. */
  const after = await reads.worth(held + coins).catch(() => null);
  return {
    agent: {
      ...reading,
      status: "working",
      trades,
      worthRaw: after === null ? null : after.toString(),
      worthAt: after === null ? null : at,
      exitBps: fees.sellBps,
      updatedAt: at,
    },
    did: "bought",
  };
}
