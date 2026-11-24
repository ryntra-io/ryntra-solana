/**
 * What the chain shows a wallet did with one coin, and which coins a wallet launched: the reading of Helius
 * Parsed Events Scan's parsed transactions that the creator's tab and the holders' links share.
 *
 * Pure and client-safe. The answer's shape is the one `token-events.ts` already reads — Helius publishes it in
 * `helius-sdk` 3.5.0 (`parsedEvents/types.d.ts`: `data[]` of `{ signature, parserStatus, parsed: { blockTime, fee,
 * feePayer, transactionStatus, nativeTransfers[], tokenTransfers[], summary } }`, a `paginationToken` while the history
 * goes on, a `scan` block with `scannedTransactions` and `creditsCharged`).
 *
 * Only what moved is read: a wallet's balance of the coin grew or shrank in a transaction, and whether anything moved
 * back the other way — dollars of USDC or USDT, SOL (wrapped or plain, the wallet's own token accounts left out), or
 * Helius's own summary calls it a swap. Something moved back: a trade. Nothing did: a transfer, with the other wallet
 * named — or tokens that came from nowhere (minted) or went nowhere (burned). Nothing here guesses who a wallet is.
 *
 * Helius's events are an index, not settlement: these figures say what the page shows, never what Ryntra moves or
 * counts.
 */

import { SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";

export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KConky8KuJ1iZqrBTW6";
const STABLE_MINTS: ReadonlySet<string> = new Set([SOLANA_MAINNET_USDC_MINT, USDT_MINT]);
/** The coins a launch never is: what a trade pays with. */
const NOT_LAUNCHES: ReadonlySet<string> = new Set([WRAPPED_SOL_MINT, SOLANA_MAINNET_USDC_MINT, USDT_MINT]);
const LAMPORTS_PER_SOL = 1_000_000_000;
const EPS = 1e-12;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/u;

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const address = (value: unknown): string | null => (typeof value === "string" && BASE58.test(value) ? value : null);

/* ------------------------------------------------------------------ pages */

/** One parsed transaction of a page, as Helius gives it: its signature and its `parsed` body. */
export type ScanItem = Readonly<{ signature: string; parsed: Record<string, unknown> }>;

export type ScanPage = Readonly<{
  items: readonly ScanItem[];
  /** Where the next call resumes; null — the history (or the window) ended. */
  next: string | null;
  scanned: number;
  credits: number;
}>;

/** The answer is not the published shape: the read fails rather than taking a short list for a whole one. */
export class ScanMalformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanMalformed";
  }
}

/** One answer of the scan with `returnShape: "transactions"` → its parsed transactions, its cursor and its cost. */
export function scanPageOf(answer: unknown): ScanPage {
  const body = record(answer);
  if (!body) throw new ScanMalformed("The scan answered something other than an object.");
  if (body.data !== undefined && !Array.isArray(body.data)) throw new ScanMalformed("The scan answered a page without a list.");
  const items: ScanItem[] = [];
  for (const entry of (body.data as unknown[] | undefined) ?? []) {
    const row = record(entry);
    const signature = typeof row?.signature === "string" && SIGNATURE.test(row.signature) ? row.signature : null;
    const parsed = record(row?.parsed);
    if (!signature) throw new ScanMalformed("The scan answered a match without a signature.");
    /* A transaction Helius could not parse says nothing of what moved: it is passed over, never read as «nothing». */
    if (!parsed) continue;
    items.push({ signature, parsed });
  }
  const scan = record(body.scan);
  const next = typeof body.paginationToken === "string" && body.paginationToken.length > 0 ? body.paginationToken : null;
  return { items, next, scanned: number(scan?.scannedTransactions) ?? 0, credits: number(scan?.creditsCharged) ?? 0 };
}

/* -------------------------------------------------------------- transfers */

type Transfer = Readonly<{ from: string | null; to: string | null; fromAccount: string | null; toAccount: string | null; mint: string | null; amount: number | null; raw: number | null; decimals: number | null }>;

function transfersOf(parsed: Record<string, unknown>): Transfer[] {
  const list = Array.isArray(parsed.tokenTransfers) ? parsed.tokenTransfers : [];
  return list.flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const raw = number(row.rawTokenAmount);
    const decimals = number(row.decimals);
    const fine = raw !== null && decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18;
    return [{
      from: address(row.fromUserAccount),
      to: address(row.toUserAccount),
      fromAccount: address(row.fromTokenAccount),
      toAccount: address(row.toTokenAccount),
      mint: address(row.mint),
      amount: fine ? raw / 10 ** decimals : null,
      raw,
      decimals,
    }];
  });
}

/** The wallet's net of some mints in the transaction's token transfers: in is plus. */
function netOf(transfers: readonly Transfer[], wallet: string, mints: ReadonlySet<string>): Readonly<{ net: number; moved: boolean }> {
  let net = 0;
  let moved = false;
  for (const transfer of transfers) {
    if (!transfer.mint || !mints.has(transfer.mint) || transfer.amount === null) continue;
    if (transfer.to === wallet && transfer.from !== wallet) {
      net += transfer.amount;
      moved = true;
    } else if (transfer.from === wallet && transfer.to !== wallet) {
      net -= transfer.amount;
      moved = true;
    }
  }
  return { net, moved };
}

/** Whether Helius's own summary of the transaction, or of one of its instructions, calls it a swap. */
function isSwap(parsed: Record<string, unknown>): boolean {
  if (record(parsed.summary)?.type === "swap") return true;
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  return instructions.some((entry) => record(record(entry)?.summary)?.type === "swap");
}

/** The wallet's own token accounts in the transaction: lamports into them are a wrapping or an account's rent. */
function ownAccounts(transfers: readonly Transfer[], wallet: string): Set<string> {
  const own = new Set<string>();
  for (const transfer of transfers) {
    if (transfer.from === wallet && transfer.fromAccount) own.add(transfer.fromAccount);
    if (transfer.to === wallet && transfer.toAccount) own.add(transfer.toAccount);
  }
  return own;
}

/* ------------------------------------------------------------------ moves */

/**
 * One transaction in which the wallet's balance of the coin moved.
 *
 * - `kind` — `trade`: something moved back (dollars or SOL) or Helius calls it a swap; `transfer`: nothing moved back,
 *   `party` is the other wallet; `minted` / `burned`: the tokens came from nowhere or went nowhere.
 * - `party` — for a transfer in, the wallet that sent the most; out, the wallet that got the most; null otherwise.
 * - `paidBy` — the wallet that paid the transaction's fee when it is not this one (someone else paid for its move).
 * - `solFrom` — the wallets that sent this one SOL in the same transaction (not its own token accounts).
 */
export type CoinMove = Readonly<{
  signature: string;
  /** Unix seconds. */
  at: number;
  dir: "in" | "out";
  /** Tokens, in the unit the wallet shows. */
  amount: number;
  kind: "trade" | "transfer" | "minted" | "burned";
  party: string | null;
  paidBy: string | null;
  solFrom: readonly string[];
}>;

/** One parsed transaction → the wallet's move of the coin in it, or null when its balance of the coin did not move. */
export function moveOfParsed(item: ScanItem, wallet: string, mint: string): CoinMove | null {
  const parsed = item.parsed;
  if (parsed.transactionStatus !== undefined && parsed.transactionStatus !== "OK") return null;
  const at = number(parsed.blockTime);
  const feePayer = address(parsed.feePayer);
  if (at === null || !feePayer) return null;
  const transfers = transfersOf(parsed);
  const coin = netOf(transfers, wallet, new Set([mint]));
  if (Math.abs(coin.net) <= EPS) return null;
  const dir: CoinMove["dir"] = coin.net > 0 ? "in" : "out";
  /* The other side moves the other way: a buy pays (minus), a sale gets (plus). */
  const against = dir === "in" ? -1 : 1;

  let countered = false;
  const stable = netOf(transfers, wallet, STABLE_MINTS);
  if (stable.moved && stable.net * against > EPS) countered = true;
  const own = ownAccounts(transfers, wallet);
  const solFrom = new Set<string>();
  let lamports = 0;
  const natives = Array.isArray(parsed.nativeTransfers) ? parsed.nativeTransfers : [];
  for (const entry of natives) {
    const row = record(entry);
    const amount = number(row?.amount);
    if (!row || amount === null || amount <= 0) continue;
    const from = address(row.fromUserAccount);
    const to = address(row.toUserAccount);
    if (from === wallet && to !== wallet && !(to && own.has(to))) lamports -= amount;
    else if (to === wallet && from !== wallet && !(from && own.has(from))) {
      lamports += amount;
      if (from) solFrom.add(from);
    }
  }
  if (!countered && mint !== WRAPPED_SOL_MINT) {
    const wrapped = netOf(transfers, wallet, new Set([WRAPPED_SOL_MINT]));
    if ((wrapped.net + lamports / LAMPORTS_PER_SOL) * against > EPS) countered = true;
  }

  /* The coin's own transfers of this wallet, the largest first: who sent it or who got it. */
  const mine = transfers
    .filter((transfer) => transfer.mint === mint && transfer.amount !== null && (dir === "in" ? transfer.to === wallet && transfer.from !== wallet : transfer.from === wallet && transfer.to !== wallet))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  const top = mine[0] ?? null;
  const fromNowhere = dir === "in" && top !== null && top.from === null && top.fromAccount === null;
  const toNowhere = dir === "out" && top !== null && top.to === null && top.toAccount === null;
  const kind: CoinMove["kind"] = countered || isSwap(parsed) ? "trade" : fromNowhere ? "minted" : toNowhere ? "burned" : "transfer";
  const party = kind === "transfer" && top ? (dir === "in" ? top.from : top.to) : null;
  return {
    signature: item.signature,
    at,
    dir,
    amount: Math.abs(coin.net),
    kind,
    party,
    paidBy: feePayer !== wallet ? feePayer : null,
    solFrom: [...solFrom],
  };
}

/** Every move of the wallet in the pages read, the newest first, each transaction once. */
export function movesOf(pages: readonly ScanPage[], wallet: string, mint: string): CoinMove[] {
  const seen = new Set<string>();
  const out: CoinMove[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.signature)) continue;
      seen.add(item.signature);
      const move = moveOfParsed(item, wallet, mint);
      if (move) out.push(move);
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/* --------------------------------------------------------------- launches */

/** A coin the wallet launched: tokens of a new mint came into being in a transaction it paid for. */
export type Launch = Readonly<{ mint: string; at: number; signature: string }>;

/**
 * The coins launched in the pages read: a transaction the wallet paid for, on a launch program (the scan's own filter),
 * in which a mint's tokens came from nowhere — the supply a launch puts on its curve. A token of no decimals or a single
 * unit (a position's receipt) is not a coin; what a trade pays with never is. The oldest transaction of a mint wins.
 */
export function launchesOf(pages: readonly ScanPage[], wallet: string): Launch[] {
  const byMint = new Map<string, Launch>();
  for (const page of pages) {
    for (const item of page.items) {
      const parsed = item.parsed;
      if (parsed.transactionStatus !== undefined && parsed.transactionStatus !== "OK") continue;
      const at = number(parsed.blockTime);
      if (at === null || address(parsed.feePayer) !== wallet) continue;
      for (const transfer of transfersOf(parsed)) {
        if (!transfer.mint || NOT_LAUNCHES.has(transfer.mint)) continue;
        if (transfer.from !== null || transfer.fromAccount !== null || (transfer.to === null && transfer.toAccount === null)) continue;
        if (transfer.decimals === null || transfer.decimals < 1 || transfer.raw === null || transfer.raw <= 1) continue;
        const known = byMint.get(transfer.mint);
        if (!known || at < known.at) byMint.set(transfer.mint, { mint: transfer.mint, at, signature: item.signature });
      }
    }
  }
  return [...byMint.values()].sort((a, b) => b.at - a.at);
}
