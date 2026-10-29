/**
 * «Чесний PnL» (DSC-2) — one standard for what a wallet or a book of trades made, wherever Ryntra shows a result:
 * «Стеження за гаманцями» (SOL-R4), the «Журнал», the platform's own metric in the admin, and — on their request — the
 * Growth line's boards. The market's bare «PnL» hides the fees and what was never sold; this one says both, and says
 * how much of the figure is known.
 *
 * The rules (`HONEST_PNL_METHOD` carries them in words, for every surface to print the same):
 *
 * - **Fees counted.** A trade's own fees — the network's, a venue's, Ryntra's — come off the result: a buy's fee joins
 *   its cost, a sale's comes off what it brought, a fee paid on its own (an opening fill) is a loss when paid.
 * - **Realized and unrealized apart.** Realized — what sales brought against the average cost of what they closed.
 *   Unrealized — what is still held, at the price it would leave at now.
 * - **The exit price, not the screen's.** What is held is valued as if sold now: the pool's own depth moves the price
 *   against the sale (a constant-product pool: value `÷ (1 + value / depth)`), the exit's fees come off. No depth known —
 *   the holding's value is not known; a price nobody quotes — not known either. Never the last trade's price.
 * - **Completeness in %.** The share of the turnover whose result is known: a leg without a price, a sale of what was
 *   bought before the read, a holding without a price or a depth — each is a part not known, weighed by its value (one
 *   without a value weighs as the median leg). Below `VERDICT_MIN_COMPLETENESS_PCT` the result is `null`.
 * - **An unknown result is never 0 and never a plus.** `result` is null when not enough is known, and the verdict is
 *   `UNKNOWN` — a wallet whose result is not known is in no one's «in the plus».
 * - **Drawdown.** The deepest fall of the cumulative result from its peak, at the points of the trades (between trades
 *   no price is read) and the holdings' value now — in the unit and as a share of the capital at work.
 * - **Periods 7 · 30 · 90 days.** A period's result is its own trades: sales within it against their average cost, and
 *   what was bought within it and is still held, at the exit price now. A holding bought before the period is the
 *   whole read's, not the period's.
 *
 * Pure and client-safe: no clock unless given, no network. Amounts are numbers in the result's unit (SOL or dollars).
 */

export const HONEST_PNL_STANDARD = "ryntra.honest-pnl/1" as const;
export const PNL_PERIOD_DAYS = [7, 30, 90] as const;
export type PnlPeriodDays = (typeof PNL_PERIOD_DAYS)[number];
/** Below this share of the turnover known, a result is not given. */
export const VERDICT_MIN_COMPLETENESS_PCT = 95;
export const DAY_S = 86_400;
/**
 * A Solana swap's network fee when the transaction's own is not on record — the base fee and a priority fee a meme swap
 * needs to land, the same figures «Реальність послідовника» (SOL-R3) states. Said as an estimate wherever it is used.
 */
export const ESTIMATED_NETWORK_FEE_SOL = 0.000105;
const EPS = 1e-12;

export type PnlUnit = "SOL" | "USD";

/** One trade of an asset against the unit: a buy or a sale. */
export type PnlLeg = Readonly<{
  id: string;
  asset: string;
  /** Unix seconds; null when not known. */
  at: number | null;
  side: "buy" | "sell";
  /** Units of the asset, > 0. */
  amount: number;
  /** What was paid or got, in the unit, fees outside it excluded; null — not priced. */
  value: number | null;
  /** Fees paid outside `value`, in the unit; null — not read. */
  fee: number | null;
}>;

/** A result a venue already computed — a closed position of perps, a fee paid on its own (`gross` 0). */
export type PnlClose = Readonly<{
  id: string;
  asset: string;
  at: number | null;
  /** What the close made before fees, in the unit; null — not reported. */
  gross: number | null;
  /** Fees of this close, in the unit; null — not read. */
  fee: number | null;
  /** The capital the close was made on (its cost or notional), in the unit; null — not known. */
  capital: number | null;
}>;

/** A position still open whose value is not read (no mark): it is a part not known, never a zero. */
export type PnlUnmarked = Readonly<{ id: string; asset: string; at: number | null; capital: number | null }>;

/** How an asset held would leave now. */
export type ExitMark = Readonly<{
  /** Its price now per unit of the asset, in the result's unit; null — nobody quotes it. */
  price: number | null;
  /** The pool's depth on the unit's side, in the unit; `DEEP` — a market the size does not move; null — not known. */
  depth: number | "DEEP" | null;
  /** The exit's fee as a share of what the sale brings (Ryntra's, a venue's). */
  feeShare: number;
  /** The exit's fixed fee, in the unit (the network's). */
  feeFixed: number;
}>;

export type HonestPnlInput = Readonly<{
  unit: PnlUnit;
  /** Now, unix seconds — the end of every period. */
  nowS: number;
  legs?: readonly PnlLeg[];
  closes?: readonly PnlClose[];
  unmarked?: readonly PnlUnmarked[];
  /** What is held now by asset, read apart from the trades: a holding below the trades' open was sent away without a sale. Null — not known. */
  held?: ReadonlyMap<string, number | null>;
  marks?: ReadonlyMap<string, ExitMark>;
}>;

export type PnlVerdict = "PLUS" | "MINUS" | "FLAT" | "UNKNOWN" | "EMPTY";

export type HonestPnlWindow = Readonly<{
  /** 7, 30 or 90; null for the whole read or a calendar window. */
  days: number | null;
  from: number | null;
  to: number;
  /** Realized after fees, of the known parts; null when sales were made and none is known. */
  realized: number | null;
  /** What is held, at the exit price, less its cost; null when something is held and none of it is valued. */
  unrealized: number | null;
  /** Realized and unrealized of the known parts — said beside the completeness, never as the result. */
  known: number | null;
  /** The result — only when at least `VERDICT_MIN_COMPLETENESS_PCT` of the turnover is known. */
  result: number | null;
  /** Fees paid within the window, known ones — already inside the result. */
  fees: number;
  /** The capital at work: the cost of what was closed and of what is held. */
  capital: number;
  pct: number | null;
  /** The share of the turnover whose result is known; null with nothing traded. */
  completenessPct: number | null;
  verdict: PnlVerdict;
  /** The deepest fall of the cumulative result from its peak; null with no point to measure. */
  drawdown: Readonly<{ value: number; pct: number | null }> | null;
  /** Trades (legs and closes) within the window. */
  trades: number;
}>;

export type HonestAsset = Readonly<{
  asset: string;
  realized: number | null;
  unrealized: number | null;
  /** What is held, as it would leave now (after depth and the exit's fees); null — not valued. */
  exitValue: number | null;
  /** What is held — at a cost known, and not. */
  held: number;
  heldUnknownCost: number;
  /** The cost of what is held, its fees inside. */
  heldCost: number;
  fees: number;
  result: number | null;
  completenessPct: number | null;
}>;

export type HonestPnl = Readonly<{
  standard: typeof HONEST_PNL_STANDARD;
  unit: PnlUnit;
  asOf: number;
  whole: HonestPnlWindow;
  periods: Readonly<Record<PnlPeriodDays, HonestPnlWindow>>;
  assets: readonly HonestAsset[];
}>;

/* ------------------------------------------------------------- the pieces */

/**
 * A piece of the result: a part of a trade or of a holding, known or not. The window sums its pieces; a piece split
 * between known and not becomes two.
 */
type Piece = Readonly<{
  asset: string;
  at: number | null;
  kind: "buy" | "sell" | "close" | "open";
  known: boolean;
  /** Its effect on the result (after fees); 0 for a buy (its fee is in the cost). Null when not known. */
  effect: number | null;
  /** Its weight in the turnover; null — weighed as the median. */
  weight: number | null;
  /** The capital it stands for (cost closed, cost held). */
  capital: number;
  fee: number;
  /** Only for `open`: the share of the holding bought within a window, from the asset's buys. */
  buys?: readonly Readonly<{ at: number | null; amount: number }>[];
  heldAmount?: number;
}>;

type Book = { knownQty: number; knownCost: number; unknownQty: number; fees: number };

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** What `amount` of an asset would bring if sold now: depth against it, the exit's fees off. Null — not known. */
export function exitValue(amount: number, mark: ExitMark | undefined): number | null {
  if (!(amount > EPS)) return 0;
  if (!mark || !finite(mark.price) || mark.price < 0 || mark.depth === null) return null;
  const spot = amount * mark.price;
  if (mark.depth !== "DEEP" && !(mark.depth > 0)) return null;
  const moved = mark.depth === "DEEP" ? spot : spot / (1 + spot / mark.depth);
  return Math.max(0, moved * (1 - Math.max(0, mark.feeShare)) - Math.max(0, mark.feeFixed));
}

type Holding = Readonly<{ knownQty: number; unknownQty: number; knownCost: number; exit: number | null }>;

function piecesOf(input: HonestPnlInput): { pieces: Piece[]; holdings: Map<string, Holding> } {
  const pieces: Piece[] = [];
  const holdings = new Map<string, Holding>();
  const legs = [...(input.legs ?? [])].sort((a, b) => (a.at ?? Number.NEGATIVE_INFINITY) - (b.at ?? Number.NEGATIVE_INFINITY));
  const books = new Map<string, Book>();
  const buysOf = new Map<string, { at: number | null; amount: number }[]>();
  for (const leg of legs) {
    if (!(leg.amount > EPS)) continue;
    const book = books.get(leg.asset) ?? { knownQty: 0, knownCost: 0, unknownQty: 0, fees: 0 };
    books.set(leg.asset, book);
    const priced = finite(leg.value) && leg.value >= 0 && finite(leg.fee) && leg.fee >= 0;
    const fee = finite(leg.fee) && leg.fee >= 0 ? leg.fee : 0;
    book.fees += fee;
    if (leg.side === "buy") {
      buysOf.set(leg.asset, [...(buysOf.get(leg.asset) ?? []), { at: leg.at, amount: leg.amount }]);
      if (priced) {
        book.knownQty += leg.amount;
        book.knownCost += leg.value! + leg.fee!;
      } else book.unknownQty += leg.amount;
      pieces.push({ asset: leg.asset, at: leg.at, kind: "buy", known: priced, effect: priced ? 0 : null, weight: finite(leg.value) ? leg.value : null, capital: 0, fee });
      continue;
    }
    /* A sale closes what is held, known and unknown cost alike in their proportion; beyond what is held — bought before the read. */
    const total = book.knownQty + book.unknownQty;
    const closing = Math.min(leg.amount, total);
    const knownPart = total > EPS ? closing * (book.knownQty / total) : 0;
    const unknownPart = leg.amount - knownPart;
    const knownShare = knownPart / leg.amount;
    const cost = book.knownQty > EPS ? book.knownCost * (knownPart / book.knownQty) : 0;
    if (total > EPS) {
      book.knownCost -= cost;
      book.knownQty -= knownPart;
      book.unknownQty -= Math.min(book.unknownQty, closing - knownPart);
    }
    const weight = finite(leg.value) ? leg.value : null;
    if (priced && knownShare > EPS) {
      pieces.push({ asset: leg.asset, at: leg.at, kind: "sell", known: true, effect: (leg.value! - leg.fee!) * knownShare - cost, weight: weight === null ? null : weight * knownShare, capital: cost, fee: fee * knownShare });
    }
    const unknownShare = priced ? unknownPart / leg.amount : 1;
    if (unknownShare > EPS) {
      pieces.push({ asset: leg.asset, at: leg.at, kind: "sell", known: false, effect: null, weight: weight === null ? null : weight * unknownShare, capital: 0, fee: priced ? fee * unknownShare : fee });
    }
  }

  /* What is held: capped by what the wallet holds now, then valued as it would leave. */
  for (const [asset, book] of books) {
    let knownQty = book.knownQty > EPS ? book.knownQty : 0;
    let unknownQty = book.unknownQty > EPS ? book.unknownQty : 0;
    let knownCost = knownQty > 0 ? book.knownCost : 0;
    const heldNow = input.held?.get(asset);
    const open = knownQty + unknownQty;
    if (finite(heldNow) && heldNow < open) {
      const keep = open > 0 ? Math.max(0, heldNow) / open : 0;
      knownQty *= keep;
      unknownQty *= keep;
      knownCost *= keep;
    }
    const buys = buysOf.get(asset) ?? [];
    const amount = knownQty + unknownQty;
    const value = knownQty > EPS ? exitValue(knownQty, input.marks?.get(asset)) : null;
    holdings.set(asset, { knownQty, unknownQty, knownCost, exit: value });
    if (knownQty > EPS) {
      pieces.push({ asset, at: null, kind: "open", known: value !== null, effect: value === null ? null : value - knownCost, weight: knownCost, capital: knownCost, fee: 0, buys, heldAmount: amount });
    }
    if (unknownQty > EPS) pieces.push({ asset, at: null, kind: "open", known: false, effect: null, weight: null, capital: 0, fee: 0, buys, heldAmount: amount });
  }

  for (const close of input.closes ?? []) {
    const known = finite(close.gross) && finite(close.fee) && close.fee >= 0;
    const fee = finite(close.fee) && close.fee >= 0 ? close.fee : 0;
    pieces.push({ asset: close.asset, at: close.at, kind: "close", known, effect: known ? close.gross! - close.fee! : null, weight: finite(close.capital) && close.capital > 0 ? close.capital : null, capital: known && finite(close.capital) && close.capital > 0 ? close.capital : 0, fee });
  }
  for (const open of input.unmarked ?? []) {
    pieces.push({ asset: open.asset, at: null, kind: "open", known: false, effect: null, weight: finite(open.capital) && open.capital > 0 ? open.capital : null, capital: 0, fee: 0, buys: [{ at: open.at, amount: 1 }], heldAmount: 1 });
  }
  return { pieces, holdings };
}

/* ------------------------------------------------------------- the window */

/** The median of the known weights — what a piece without a value weighs. */
function medianWeight(pieces: readonly Piece[]): number {
  const known = pieces.map((piece) => piece.weight).filter((weight): weight is number => weight !== null && weight > EPS).sort((a, b) => a - b);
  if (known.length === 0) return 1;
  const mid = known.length >> 1;
  return known.length % 2 ? known[mid]! : (known[mid - 1]! + known[mid]!) / 2;
}

const within = (at: number | null, from: number | null, to: number) => (from === null ? true : at !== null && at >= from && at < to);

/** The pieces of a window: trades within it, and the share of each holding bought within it. */
function windowPieces(pieces: readonly Piece[], from: number | null, to: number): Piece[] {
  if (from === null) return [...pieces];
  const out: Piece[] = [];
  for (const piece of pieces) {
    if (piece.kind !== "open") {
      if (within(piece.at, from, to)) out.push(piece);
      continue;
    }
    const bought = (piece.buys ?? []).filter((buy) => within(buy.at, from, to)).reduce((sum, buy) => sum + buy.amount, 0);
    const share = piece.heldAmount && piece.heldAmount > EPS ? Math.min(1, bought / piece.heldAmount) : 0;
    if (share <= EPS) continue;
    out.push({ ...piece, effect: piece.effect === null ? null : piece.effect * share, weight: piece.weight === null ? null : piece.weight * share, capital: piece.capital * share });
  }
  return out;
}

function drawdownOf(pieces: readonly Piece[], capital: number): HonestPnlWindow["drawdown"] {
  const points = pieces
    .filter((piece) => piece.known && piece.effect !== null && (piece.kind === "sell" || piece.kind === "close"))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const open = pieces.filter((piece) => piece.kind === "open" && piece.known && piece.effect !== null);
  if (points.length === 0 && open.length === 0) return null;
  let level = 0;
  let peak = 0;
  let deepest = 0;
  const step = (effect: number) => {
    level += effect;
    peak = Math.max(peak, level);
    deepest = Math.max(deepest, peak - level);
  };
  for (const point of points) step(point.effect!);
  /* The holdings at their exit value now: the last point of the curve. */
  if (open.length > 0) step(open.reduce((sum, piece) => sum + piece.effect!, 0));
  return { value: deepest, pct: capital > EPS ? (deepest / capital) * 100 : null };
}

function windowOf(pieces: readonly Piece[], median: number, days: number | null, from: number | null, to: number): HonestPnlWindow {
  const inside = windowPieces(pieces, from, to);
  const weightOf = (piece: Piece) => piece.weight ?? median;
  const total = inside.reduce((sum, piece) => sum + weightOf(piece), 0);
  const knownWeight = inside.filter((piece) => piece.known).reduce((sum, piece) => sum + weightOf(piece), 0);
  const completenessPct = inside.length === 0 ? null : total > EPS ? Math.round((knownWeight / total) * 1000) / 10 : 100;
  const sumOf = (kinds: readonly Piece["kind"][]) => {
    const list = inside.filter((piece) => kinds.includes(piece.kind));
    if (list.length === 0) return 0;
    const known = list.filter((piece) => piece.known && piece.effect !== null);
    return known.length === 0 ? null : known.reduce((sum, piece) => sum + piece.effect!, 0);
  };
  const realized = sumOf(["sell", "close"]);
  const unrealized = sumOf(["open"]);
  /* Only what some known sale, close or holding says: buys alone make no known part, never a «0». */
  const knownPieces = inside.filter((piece) => piece.known && piece.kind !== "buy" && piece.effect !== null);
  const known = knownPieces.length === 0 ? null : knownPieces.reduce((sum, piece) => sum + piece.effect!, 0);
  const enough = completenessPct !== null && completenessPct >= VERDICT_MIN_COMPLETENESS_PCT;
  const capital = inside.reduce((sum, piece) => sum + (piece.known ? piece.capital : 0), 0);
  const result = enough && known !== null ? known : null;
  const flat = result !== null && Math.abs(result) <= Math.max(EPS, capital * 1e-9);
  const verdict: PnlVerdict = inside.length === 0 ? "EMPTY" : result === null ? "UNKNOWN" : flat ? "FLAT" : result > 0 ? "PLUS" : "MINUS";
  return {
    days,
    from,
    to,
    realized,
    unrealized,
    known,
    result,
    fees: inside.reduce((sum, piece) => sum + piece.fee, 0),
    capital,
    pct: result !== null && capital > EPS ? (result / capital) * 100 : null,
    completenessPct,
    verdict,
    drawdown: drawdownOf(inside, capital),
    trades: inside.filter((piece) => piece.kind !== "open").length,
  };
}

/** The standard on one input: the whole read, the three periods ending now, and each asset. */
export function honestPnl(input: HonestPnlInput): HonestPnl {
  const { pieces, holdings } = piecesOf(input);
  const median = medianWeight(pieces);
  const end = input.nowS + 1;
  const periods = {} as Record<PnlPeriodDays, HonestPnlWindow>;
  for (const days of PNL_PERIOD_DAYS) periods[days] = windowOf(pieces, median, days, input.nowS - days * DAY_S, end);
  const assets = [...new Set(pieces.map((piece) => piece.asset))].map((asset): HonestAsset => {
    const window = windowOf(
      pieces.filter((piece) => piece.asset === asset),
      median,
      null,
      null,
      end,
    );
    const holding = holdings.get(asset);
    const held = (holding?.knownQty ?? 0) + (holding?.unknownQty ?? 0);
    return {
      asset,
      realized: window.realized,
      unrealized: window.unrealized,
      /* Valued only when all of it is: a part of unknown cost leaves the whole holding's value said as not known. */
      exitValue: held <= EPS ? 0 : (holding?.unknownQty ?? 0) > EPS ? null : (holding?.exit ?? null),
      held,
      heldUnknownCost: holding?.unknownQty ?? 0,
      heldCost: holding?.knownCost ?? 0,
      fees: window.fees,
      result: window.result,
      completenessPct: window.completenessPct,
    };
  });
  return { standard: HONEST_PNL_STANDARD, unit: input.unit, asOf: input.nowS, whole: windowOf(pieces, median, null, null, end), periods, assets };
}

/** The standard over a calendar window [from, to) — a month of the platform's metric. */
export function honestPnlWindow(input: HonestPnlInput, from: number, to: number): HonestPnlWindow {
  const { pieces } = piecesOf(input);
  return windowOf(pieces, medianWeight(pieces), null, from, to);
}

/* ------------------------------------------------------------ in words */

const bi = (en: string, uk: string) => ({ en, uk }) as const;

/** The method, the same on every surface that shows a result by this standard. */
export const HONEST_PNL_METHOD = [
  bi("Fees are counted: a buy's fee joins its cost, a sale's comes off what it brought.", "Комісії враховано: комісія купівлі — у її ціні, комісія продажу — з виручки."),
  bi("Realized — what sales brought against the average cost of what they closed.", "Реалізоване — виручка продажів проти середньої ціни того, що закрито."),
  bi(
    "Unrealized — what is still held, at the price it would leave at now: the pool's depth moves the price against the sale and the exit's fees come off. Without a price or a depth it is not known.",
    "Нереалізоване — те, що досі тримається, за ціною виходу зараз: глибина пулу рухає ціну проти продажу, комісії виходу віднято. Без ціни чи глибини — невідомо.",
  ),
  bi(
    "Completeness — the share of the turnover whose result is known; a trade without a price weighs as the median trade. Below 95 % no result is given.",
    "Повнота даних — частка обороту з відомим результатом; угода без ціни важить як медіанна. Нижче 95 % результату не даємо.",
  ),
  bi("An unknown result is never shown as 0 or as a plus.", "Невідомий результат ніколи не показуємо як 0 чи плюс."),
  bi(
    "Drawdown — the deepest fall of the running result from its peak, at the trades' points and the holdings now; between trades the price is not read.",
    "Просадка — найглибше падіння накопиченого результату від піку, у точках угод і за тим, що тримається зараз; між угодами ціна не читається.",
  ),
  bi(
    "A period — its own trades: sales within it, and what was bought within it and is still held. A holding bought earlier belongs to the whole read.",
    "Період — його власні угоди: продажі в ньому і куплене в ньому, що досі тримається. Куплене раніше — у повному результаті.",
  ),
] as const;

export const HONEST_PNL_VERDICT_WORDS: Readonly<Record<PnlVerdict, Readonly<{ en: string; uk: string }>>> = {
  PLUS: bi("In the plus after fees", "У плюсі після комісій"),
  MINUS: bi("In the minus after fees", "У мінусі після комісій"),
  FLAT: bi("Even after fees", "Нуль після комісій"),
  UNKNOWN: bi("Not known", "Невідомо"),
  EMPTY: bi("No trades", "Угод немає"),
};
