/**
 * «Перевірка» on the server — the facts the four lines need besides the order
 * (contract 1.20.0). The quote route and the order route start this read
 * beside the venue's order, so it costs no time of its own, and count the
 * lines on the order they answer (`check.ts`).
 *
 * The company is the universe's row, read as its page reads it — the name,
 * the issuer, the unit, the fee the chain states now — with the decimals and
 * the multiplier of the mint read for this very answer; SOL's price is the one
 * the Spot header shows. A pair that is not a company against USDC, a row the
 * universe does not hold, or a read that failed is no check: the answer says
 * `check: null` rather than lines counted on a guess.
 */

import type { MintReadSuccess } from "../solana/mint.ts";
import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";
import { readSpotMarket } from "../spot/markets.server.ts";
import { shapeOnchainMint } from "./asset.server.ts";
import { buildSwapCheck, checkSide, type CheckBasis, type CheckOrderFigures, type CheckSide, type CheckWords, type SwapCheck } from "./check.ts";
import { eventLine, isWatched, windowState } from "./conversion-watch.ts";
import { lifecycleEventFor } from "./lifecycle-events.ts";
import { companyDisplayName } from "./shelf.ts";
import { multiplierFromChain } from "./units.ts";
import { findStockRow, type StockRow } from "./universe.server.ts";

export type CheckContext = Readonly<{
  side: CheckSide;
  stockMint: string;
  row: StockRow;
  solUsd: number | null;
  solObservedAt: string | null;
}>;

/**
 * How long an answer that is otherwise ready waits for the check's reads, and
 * how long SOL's price waits for the venue: the lines are disclosure beside
 * the order, never a delay of it. A read that lands later is kept for the
 * next answer.
 */
export const CHECK_WAIT_MS = 2_500;
export const SOL_WAIT_MS = 1_500;
/** SOL's last price read is used for the network's fee and the reserve while the venue is slow, up to ten minutes old — its time goes with it. */
export const SOL_KEPT_MS = 10 * 60_000;

let lastSol: Readonly<{ usd: number; observedAt: string; atMs: number }> | null = null;

const later = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms).unref?.());

/** SOL's price as the Spot header reads it; while the venue is slow, the last one read, with its own time; else none. */
async function solPrice(nowMs: number): Promise<Readonly<{ usd: number | null; observedAt: string | null }>> {
  const read = readSpotMarket(WRAPPED_SOL_MINT)
    .then((answer) => {
      const price = answer.ok && answer.market && typeof answer.market.price === "number" && Number.isFinite(answer.market.price) && answer.market.price > 0 ? answer.market.price : null;
      if (price === null || !answer.ok) return null;
      lastSol = { usd: price, observedAt: answer.observedAt, atMs: Date.now() };
      return { usd: price, observedAt: answer.observedAt };
    })
    .catch(() => null);
  const answered = await Promise.race([read, later(SOL_WAIT_MS, null)]);
  if (answered) return answered;
  if (lastSol && nowMs - lastSol.atMs < SOL_KEPT_MS) return { usd: lastSol.usd, observedAt: lastSol.observedAt };
  return { usd: null, observedAt: null };
}

/**
 * The company's row and SOL's price for a pair, or null when the pair is not
 * a company bought with USDC or sold into it, or the company cannot be read.
 * Never throws: a check is disclosure beside the order, never a reason to
 * refuse one.
 */
export async function readCheckContext(inputMint: string, outputMint: string): Promise<CheckContext | null> {
  const pair = checkSide(inputMint, outputMint);
  if (!pair) return null;
  const [found, sol] = await Promise.all([findStockRow(pair.stockMint).catch(() => null), solPrice(Date.now()).catch(() => ({ usd: null, observedAt: null }))]);
  if (!found || !found.ok || !found.row || found.row.representation.mint !== pair.stockMint) return null;
  return { side: pair.side, stockMint: pair.stockMint, row: found.row, solUsd: sol.usd, solObservedAt: sol.observedAt };
}

/** The check's reads, waited for at most `waitMs` once the answer is otherwise ready; later than that, the answer goes without its lines. */
export function awaitCheckContext(pending: Promise<CheckContext | null>, waitMs: number = CHECK_WAIT_MS): Promise<CheckContext | null> {
  return Promise.race([pending.catch(() => null), later(waitMs, null)]);
}

/**
 * The issuer's event said to a buyer before a purchase (the IPO and
 * conversion watch) — a private company's token whose issuer opened a window
 * to swap it, while the window is open; null otherwise.
 */
export function buyerEventLine(row: StockRow, nowMs: number): CheckWords | null {
  if (row.representation.instrument.class !== "pre-ipo") return null;
  const event = lifecycleEventFor(row.representation.mint);
  if (!isWatched(event) || windowState(event, nowMs) !== "open") return null;
  return { en: eventLine(event, "buyer", "en", nowMs), uk: eventLine(event, "buyer", "uk", nowMs) };
}

export type SwapCheckOfInput = Readonly<{
  context: CheckContext | null;
  basis: CheckBasis;
  order: CheckOrderFigures;
  /** The decimals both mints were read with for this answer. */
  decimals: Readonly<Record<string, number>>;
  /** The company's mint as the chain stated it for this answer — its multiplier in force now. */
  mintRead: MintReadSuccess | null;
  nowMs: number;
}>;

/**
 * The four lines on this answer's order, or null when there is no company to
 * say them about. Never throws: a figure the chain states out of every range
 * the lines are counted in is no check, and the order is answered as it is.
 */
export function swapCheckOf(input: SwapCheckOfInput): SwapCheck | null {
  try {
    return countCheck(input);
  } catch {
    return null;
  }
}

function countCheck(input: SwapCheckOfInput): SwapCheck | null {
  const { context } = input;
  if (!context) return null;
  const rep = context.row.representation;
  const decimals = input.decimals[context.stockMint];
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) return null;
  const privateCompany = rep.instrument.class === "pre-ipo";
  /* The multiplier as the company's page reads it: the chain's, judged now, else the universe's. */
  const onchain = input.mintRead ? shapeOnchainMint(input.mintRead) : null;
  const chain = onchain && !("error" in onchain) && onchain.scaledUi ? multiplierFromChain(onchain.scaledUi, input.nowMs) : null;
  return buildSwapCheck({
    side: context.side,
    basis: input.basis,
    order: input.order,
    company: {
      mint: rep.mint,
      symbol: rep.symbol,
      name: companyDisplayName(rep.underlying.name ?? rep.name, privateCompany ? null : rep.underlying.symbol),
      issuer: rep.issuer.id,
      unit: rep.instrument.unitBasis === "token" ? "token" : "share",
      privateCompany,
      decimals,
      multiplier: chain?.current ?? context.row.multiplier?.current ?? null,
      issuerFeeBps: context.row.transferFee?.basisPoints ?? null,
    },
    solUsd: context.solUsd,
    solObservedAt: context.solObservedAt,
    event: context.side === "buy" ? buyerEventLine(context.row, input.nowMs) : null,
  });
}
