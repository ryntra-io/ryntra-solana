/**
 * «Сітка» and «Сигнали» on the person's budget, at work: on every pass, after her own exit rules had their
 * turn (`./exit.server.ts` `exitFor`) and before any buy, a bot's own rule may sell (`../bots/money/rules.ts`):
 * - the grid (`grid:…,sell:1`) sells one level's coins once the price stands one step above that level — the deepest such
 *   level first, one a pass, and only when the venue's quote for exactly those coins is at the level's line;
 * - a «cross» signal sells everything once its fast average stands under the slow.
 *
 * The sale is the agent's own sale, end to end (`./exit.server.ts` `sellNow`): under the mandate's sale policy,
 * judged and signed by its own signer, the money landing in her own account of the budget's token and nowhere else (the
 * chain holds that, `./terms.ts` `salePolicyOf`); written down before it is sent, never twice a minute, never while she
 * froze the agent, never over the day's limit of the sale's policy; three refusals in a row space the tries and tell her.
 * What it did goes into the book (`sales`, `events`) — the drive tells her each sale with «Stop» under it.
 *
 * A mandate of any other plan — regular buys, a dip, a grid that only buys, an early launch — is not touched here: this
 * turn answers «nothing to do» without a single read, so a budget signed before this task works exactly as it did.
 * This file holds no key and reads no environment.
 *
 * With the agent's own exit closed on the deployment (`TickDeps.switches`), a bot sells nothing of its own — her
 * stop has its turn in `exitFor`. A grid's level is weighed first by the venue's quote alone (no route is built while
 * even the quote does not pay the level's cost and the network's fees), and a level the route last could not make pay is
 * not built again before the next mark — the pass goes on to the buys either way.
 */

import type { Connection, PublicKey } from "@solana/web3.js";

import { botOfPlan } from "../bots/money/gates.ts";
import { gridCoversCost, gridLots, gridNetworkRaw, gridSaleDue, gridSaleNext } from "../bots/money/rules.ts";
import { mandateOf, planOfEntry, writeEntry, type BookEntry } from "./book.server.ts";
import { positionOf, positionSales, positionTrades } from "./exit.ts";
import { sellNow, watchesExit, type ExitAnswer } from "./exit.server.ts";
import { planLeaves, planMarks, type Mark } from "./plans.ts";
import { agentTrade } from "./run.server.ts";
import { heldAccountOf } from "./terms.ts";
import { isTokenProgram } from "./token-2022.ts";
import { MARK_EVERY_MS, MARK_FRESH_MS, MARK_GAP_MS, withMark, type TickDeps } from "./tick.server.ts";

/** The marks a rule may read: none when the newest is not fresh — an old price is not the price now. */
const freshMarks = (marks: readonly Mark[] | undefined, at: number): readonly Mark[] => (marks?.length && at - marks.at(-1)!.at <= MARK_FRESH_MS ? marks : []);

/** The coin's decimals — its mint's 45th byte under either token program; null when not read. */
async function decimalsOf(connection: Pick<Connection, "getAccountInfo">, mint: PublicKey): Promise<number | null> {
  const info = await connection.getAccountInfo(mint, "confirmed").catch(() => null);
  if (!info || !isTokenProgram(info.owner) || info.data.length <= 44) return null;
  const decimals = info.data[44]!;
  return decimals <= 18 ? decimals : null;
}

/** Whether a book's entry runs a bot of this task: the grid that sells its levels, or a signal, with a coin kept to sell. */
export const runsBot = (entry: BookEntry): boolean => botOfPlan(planOfEntry(entry)) !== null && watchesExit(entry);

/**
 * The bot's own turn on this pass: the sale its rule calls for, or nothing. Returns the line and the entry as the book now
 * holds it — the buys' turn reads that one, never an older copy.
 */
export async function botSaleFor(given: BookEntry, deps: TickDeps, now: () => number, trade: typeof agentTrade = agentTrade): Promise<ExitAnswer> {
  const none = (entry: BookEntry): ExitAnswer => ({ line: null, entry });
  const plan = planOfEntry(given);
  if (botOfPlan(plan) === null || !watchesExit(given) || !deps.venue.sell) return none(given);
  /* The engine's switch: the agent's own exit closed, a bot's own sales wait; her stop sold in `exitFor`. */
  if (deps.switches?.agentExit !== true) return none(given);
  const mandate = mandateOf(given, deps.gate);
  const held = mandate.terms.heldCoin;
  if (!held || !mandate.salePolicy) return none(given);
  /* The book alone says nothing is held: no read at all. */
  const booked = positionOf({ buys: given.trades, sales: given.sales ?? [], vaultRaw: null });
  if (booked.heldRaw === 0n && !booked.unread) return none(given);
  const at = now();
  const decimals = await decimalsOf(deps.connection, held.mint);
  if (decimals === null) return none(given);
  const unit = 10n ** BigInt(decimals);
  /* The price marks, read here too: a budget spent still sells its levels, and its buys' turn no longer reads them. */
  let entry = given;
  if (planMarks(plan)) {
    const marks = await withMark(entry.marks ?? [], at, () => deps.venue.worth(mandate, unit, held.mint));
    if (marks !== entry.marks && marks.length) {
      entry = { ...entry, marks, ...(entry.anchor === undefined ? { anchor: marks.at(-1)!.price } : {}) };
      await writeEntry(deps.store, entry);
    }
  }
  const marks = freshMarks(entry.marks, at);
  const anchor = entry.anchor ?? null;
  if (!(await deps.connection.getAccountInfo(mandate.salePolicy, "confirmed"))) return none(entry);
  const vaultRaw = await deps.connection.getTokenAccountBalance(heldAccountOf(mandate.vault, held), "confirmed").then(
    (balance) => BigInt(balance.value.amount),
    () => null,
  );
  const position = positionOf({ buys: entry.trades, sales: entry.sales ?? [], vaultRaw });
  /* A figure of the position not read — a buy's coins, a sale in flight, the vault — is no sale: her rules' turn waits on it. */
  if (position.heldRaw === 0n || position.unread) return none(entry);

  if (plan.id === "grid") {
    const sales = entry.sales ?? [];
    const lots = gridLots(positionTrades(entry.trades, sales), positionSales(sales));
    const lot = gridSaleNext({ anchor, stepBps: plan.stepBps, lots, price: marks.at(-1)?.price ?? null });
    if (!lot || anchor === null) return none(entry);
    /* The route last could not make this level pay — not built again before the next mark; the buys go on. */
    if (entry.gridShort?.level === lot.level && at - entry.gridShort.at < MARK_EVERY_MS) return none(entry);
    /* Never more than the vault holds of the coin: her rules may have sold a share of every level before. */
    const coins = lot.coinsRaw < position.heldRaw ? lot.coinsRaw : position.heldRaw;
    const quote = await deps.venue.worth(mandate, coins, held.mint).catch(() => null);
    if (!gridSaleDue({ anchor, stepBps: plan.stepBps, level: lot.level, coinsRaw: coins, quoteRaw: quote, unitRaw: unit })) return none(entry);
    const carried = coins === lot.coinsRaw ? lot.costRaw : (lot.costRaw * coins) / lot.coinsRaw;
    /*
     * The cheap weighing first: the quote, before Ryntra's fee and the route's slippage, is the most the sale can
     * bring; short of the level's cost and the round trip's signatures, no route is built (no `/build` a minute for a price
     * between the line and the cost) and the pass goes on to the buys.
     */
    if (!gridCoversCost({ outRaw: quote, costRaw: carried + gridNetworkRaw() })) return none(entry);
    return sellNow(entry, mandate, { why: "grid", share: 100, amountRaw: coins }, position, deps, at, trade, { level: lot.level, carriedRaw: carried });
  }
  if (!planLeaves(plan, { marks, anchor, now: at, markGapMs: MARK_GAP_MS })) return none(entry);
  return sellNow(entry, mandate, { why: "signal", share: 100, amountRaw: position.heldRaw }, position, deps, at, trade);
}
