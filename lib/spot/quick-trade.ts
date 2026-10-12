/**
 * Quick buy and quick sell — the sums and shares a trade starts from in one
 * tap, on a token's page (Spot), a company's page and a launch's page.
 *
 * A tap is never a trade. It puts the sum or the share into the surface's own
 * order and opens the same exact Review every order has — the Ryntra fee of
 * the trade's flow (fee policy v2, decided on the server), the minimum, the
 * network fee — and the person's wallet signs, or nothing happens. The trade
 * then lands in the wallet's History through the core like any other, which
 * is what an earnings card is made of.
 *
 * The quick-buy sums are dollars, the person's own: four of them, $10 · $50 ·
 * $100 · $500 until the person sets theirs, from $1 (the product's minimum purchase).
 * They are remembered on the device and are the same on every page. Paid in
 * a dollar stablecoin the sum is typed as it is; paid in SOL it is the sum at
 * SOL's price as the wallet's own read states it — no price, no SOL sum. A
 * quick sale is a share of the position: 25 · 50 · 75 · 100 %, the last
 * exactly what the wallet holds.
 */

export const QUICK_BUY_DEFAULT_USD: readonly number[] = Object.freeze([10, 50, 100, 500]);
export const QUICK_BUY_COUNT = 4;
/** The product's minimum purchase. */
export const QUICK_BUY_MIN_USD = 1;
/** The company purchase's own ceiling — a quick sum is never more than a typed one may be. */
export const QUICK_BUY_MAX_USD = 1_000_000;
export const QUICK_SELL_SHARES_PCT: readonly number[] = Object.freeze([25, 50, 75, 100]);
/** One key on the device for every page that offers a quick buy. */
export const QUICK_BUY_STORAGE_KEY = "ryntra.quick-buy.v1";

/**
 * A sum as the person may set it: whole cents, from $1 to the ceiling; anything else is not a sum. Typed in English a
 * comma groups thousands («1,000.50»); in Ukrainian a space groups them and a comma or a dot marks the cents («1 000,50»).
 */
export function quickSum(value: unknown, locale: "en" | "uk" = "en"): number | null {
  const number = typeof value === "string" ? parseSumText(value, locale) : typeof value === "number" ? value : null;
  if (number === null || !Number.isFinite(number)) return null;
  const cents = Math.round(number * 100) / 100;
  if (cents < QUICK_BUY_MIN_USD || cents > QUICK_BUY_MAX_USD) return null;
  return cents;
}

function parseSumText(text: string, locale: "en" | "uk"): number | null {
  let cleaned = text.replace(/[\s\u00a0\u202f$]/g, "");
  if (locale === "en") {
    if (!/^\d{1,3}(,\d{3})*(\.\d{0,2})?$|^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
    cleaned = cleaned.replace(/,/g, "");
  } else {
    if (!/^\d+([.,]\d{0,2})?$/.test(cleaned)) return null;
    cleaned = cleaned.replace(",", ".");
  }
  return Number(cleaned);
}

/**
 * The four sums as stored — `{ "sums": [10, 50, 100, 500] }` — or the
 * defaults for anything else: a missing key, an older shape, a sum out of
 * range. Sorted, so the chips always read from small to large; a repeated sum
 * is kept, it is the person's choice.
 */
export function readQuickSums(stored: string | null): readonly number[] {
  if (!stored) return QUICK_BUY_DEFAULT_USD;
  try {
    const parsed = JSON.parse(stored) as { sums?: unknown };
    if (!parsed || !Array.isArray(parsed.sums) || parsed.sums.length !== QUICK_BUY_COUNT) return QUICK_BUY_DEFAULT_USD;
    const sums = parsed.sums.map((sum) => quickSum(sum));
    if (sums.some((sum) => sum === null)) return QUICK_BUY_DEFAULT_USD;
    return Object.freeze((sums as number[]).slice().sort((a, b) => a - b));
  } catch {
    return QUICK_BUY_DEFAULT_USD;
  }
}

export function writeQuickSums(sums: readonly number[]): string {
  return JSON.stringify({ sums: sums.slice().sort((a, b) => a - b) });
}

/** What a quick sum is paid with: a dollar stablecoin at par, or SOL at the wallet's read price. */
export type QuickBuyPayment = Readonly<{ symbol: string; decimals: number; dollar: boolean }>;

/**
 * The amount of the paying asset a quick sum puts into the order, as the
 * order's own field takes it: «10» in USDC, «0.067114» SOL for $10 at $149;
 * null when SOL's price is not read. Never more decimals than the asset has,
 * and SOL rounded down, so the sum is never more than the person chose.
 */
export function quickBuyAmount(usd: number, payment: QuickBuyPayment, solUsd: number | null): string | null {
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (payment.dollar) return trimZeros(usd.toFixed(Math.min(2, payment.decimals)));
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const places = Math.min(6, payment.decimals);
  const scale = 10 ** places;
  const amount = Math.floor((usd / solUsd) * scale) / scale;
  return amount > 0 ? trimZeros(amount.toFixed(places)) : null;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * «$10», «$1.50», «$1,000» — a chip's label in the page's language; from $10 000 the short form («$25K», «$25 тис.»), so a
 * narrow chip never cuts a sum into something else. `full` — the whole figure, for the chip's name.
 */
export function quickSumLabel(usd: number, locale: "en" | "uk", full = false): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  /* Short only where short is exact: $10 050 stays whole rather than read «$10.1K». */
  if (!full && usd >= 10_000 && Number.isInteger(usd / 100)) return `$${new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 }).format(usd)}`;
  const whole = Number.isInteger(usd);
  return `$${new Intl.NumberFormat(tag, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(usd)}`;
}

/** A share of a raw balance, rounded down; 100 % is exactly the balance. */
export function quickShareRaw(balanceRaw: bigint, pct: number): bigint {
  if (balanceRaw <= 0n || !Number.isInteger(pct) || pct <= 0) return 0n;
  if (pct >= 100) return balanceRaw;
  return (balanceRaw * BigInt(pct)) / 100n;
}
