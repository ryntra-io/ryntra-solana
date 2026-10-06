import type { GuardStore } from "../guard/store.ts";
import { ensureRewardAccount } from "../rewards/ledger.ts";
import { readRankStanding } from "../rewards/rank-store.ts";
import { listSolanaWalletActions } from "../solana/action-ledger.ts";
import { readSpotMarketsByMint } from "../spot/markets.server.ts";
import { isHiddenWallet } from "./league-store.ts";
import {
  shareableTrades,
  shortMint,
  TRADE_CARD_SCHEMA,
  TradeCardSchema,
  tradeCardId,
  tradeKey,
  type TradeCard,
  type TradeMoment,
} from "./trade-cards.ts";

/**
 * Where trade cards live: one row per card in `growthCards`, written once.
 *
 * The figures are recomputed from the wallet's receipts at the moment a card
 * is asked for, and only a trade those receipts measure can become a card —
 * the request names a trade, never a number.
 */

const COLLECTION = "growthCards";
const NETWORK = "mainnet";
/** The newest trades offered in the sheet; older ones are still receipts in History. */
export const SHAREABLE_LIMIT = 30;
const CATALOG_TIMEOUT_MS = 4_000;

export type TokenFacts = Readonly<{ symbol: string; name: string | null; icon: string | null; stock: boolean }>;

/** A name a card can print: letters and figures as the catalogue or receipt gives them, never a control character. */
function cleanName(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return clean.length > 0 ? clean.slice(0, max) : null;
}

/**
 * What the catalogue calls each token. A catalogue that does not answer
 * leaves the receipt's own symbol, else four and four of the mint — never an
 * invented ticker.
 */
/** The token's market as a token's page reads it: symbol, name, picture and whether it is a tokenized stock. */
type MarketFacts = Readonly<{ symbol: string | null; name: string | null; icon: string | null; category: string | null }>;
export type CardDeps = Readonly<{
  markets: (mints: readonly string[], timeoutMs: number) => Promise<{ ok: true; byMint: ReadonlyMap<string, MarketFacts> } | { ok: false }>;
}>;
const DEFAULT_DEPS: CardDeps = { markets: (mints, timeoutMs) => readSpotMarketsByMint(mints, timeoutMs) };
/* What each token is called and looks like changes rarely: kept ten minutes per instance, so a sheet's list does not ask the catalogue again on every opening. */
const MARKET_CACHE_MS = 10 * 60 * 1000;
const MARKET_CACHE = new Map<string, { at: number; facts: MarketFacts }>();

export async function tokenFacts(moments: readonly TradeMoment[], deps: CardDeps = DEFAULT_DEPS): Promise<ReadonlyMap<string, TokenFacts>> {
  const mints = [...new Set(moments.map((moment) => moment.mint))];
  const now = Date.now();
  const known = deps === DEFAULT_DEPS ? new Map(mints.flatMap((mint) => {
    const hit = MARKET_CACHE.get(mint);
    return hit && now - hit.at < MARKET_CACHE_MS ? [[mint, hit.facts] as const] : [];
  })) : new Map<string, MarketFacts>();
  const asked = mints.filter((mint) => !known.has(mint));
  const read = asked.length > 0 ? await deps.markets(asked, CATALOG_TIMEOUT_MS).catch(() => null) : null;
  if (read && read.ok && deps === DEFAULT_DEPS) {
    for (const [mint, facts] of read.byMint) {
      MARKET_CACHE.set(mint, { at: now, facts });
      known.set(mint, facts);
    }
  } else if (read && read.ok) {
    for (const [mint, facts] of read.byMint) known.set(mint, facts);
  }
  const facts = new Map<string, TokenFacts>();
  for (const moment of moments) {
    if (facts.has(moment.mint)) continue;
    const row = known.get(moment.mint);
    const icon = row?.icon && /^https:\/\//.test(row.icon) && row.icon.length <= 512 ? row.icon : null;
    facts.set(moment.mint, {
      symbol: cleanName(row?.symbol, 16) ?? cleanName(moment.symbol, 16) ?? shortMint(moment.mint),
      name: cleanName(row?.name, 64),
      icon,
      stock: row?.category === "stock",
    });
  }
  return facts;
}

export type ShareableList = Readonly<{ trades: readonly TradeMoment[]; complete: boolean }>;

/** The wallet's trades a card can be made of, newest first — of one token when `mint` is given. */
export async function listShareableTrades(store: GuardStore, wallet: string, mint: string | null): Promise<ShareableList> {
  const { actions, complete } = await listSolanaWalletActions(store, { network: NETWORK, wallet });
  const all = shareableTrades(actions, wallet);
  const trades = (mint ? all.filter((moment) => moment.mint === mint) : all).slice(0, SHAREABLE_LIMIT);
  return { trades, complete };
}

export async function readTradeCard(store: GuardStore, id: string): Promise<TradeCard | null> {
  if (!/^[a-z0-9]{20}$/.test(id)) return null;
  const row = await store.collection<unknown>(COLLECTION).get(id);
  const parsed = TradeCardSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export type MakeCardOutcome = Readonly<{ state: "MADE" | "EXISTING"; card: TradeCard } | { state: "NOT_FOUND" } | { state: "INCOMPLETE" }>;

/**
 * The card of trade `key` of `wallet`, made once. The rank is the wallet's
 * rank now, unless it chose to be hidden from the boards — then the card
 * carries none, as the boards carry none.
 */
export async function makeTradeCard(
  store: GuardStore,
  args: Readonly<{ wallet: string; key: string; locale: "en" | "uk"; amounts: boolean; now: string }>,
  deps: CardDeps = DEFAULT_DEPS,
): Promise<MakeCardOutcome> {
  const id = tradeCardId(args);
  const existing = await readTradeCard(store, id);
  if (existing) return { state: "EXISTING", card: existing };

  const { actions, complete } = await listSolanaWalletActions(store, { network: NETWORK, wallet: args.wallet });
  /* A row of the history that cannot be read could change the average cost: no figure is drawn on a partial history. */
  if (!complete) return { state: "INCOMPLETE" };
  const moment = shareableTrades(actions, args.wallet).find((candidate) => tradeKey(candidate) === args.key);
  if (!moment) return { state: "NOT_FOUND" };

  const [account, hidden, facts] = await Promise.all([
    ensureRewardAccount(store, args.wallet, args.now),
    isHiddenWallet(store, args.wallet).catch(() => true),
    tokenFacts([moment], deps),
  ]);
  const rank = hidden ? null : await readRankStanding(store, args.wallet, args.now).then((standing) => standing.rank).catch(() => null);
  const token = facts.get(moment.mint)!;

  const card = TradeCardSchema.parse({
    schema: TRADE_CARD_SCHEMA,
    schemaVersion: 1,
    id,
    wallet: args.wallet,
    code: account.code,
    locale: args.locale,
    amounts: args.amounts,
    rank,
    token: { mint: moment.mint, symbol: token.symbol, name: token.name, icon: token.icon, stock: token.stock },
    trade: {
      actionId: moment.actionId,
      kind: moment.kind,
      at: moment.at,
      openedAt: moment.openedAt,
      costMicros: moment.costMicros.toString(),
      proceedsMicros: moment.proceedsMicros === null ? null : moment.proceedsMicros.toString(),
      quantityRaw: moment.quantityRaw.toString(),
      decimals: moment.decimals,
      resultBps: moment.resultBps,
    },
    createdAt: args.now,
  });
  const inserted = await store.collection<TradeCard>(COLLECTION).insertIfAbsent(id, card);
  if (!inserted) {
    const raced = await readTradeCard(store, id);
    if (raced) return { state: "EXISTING", card: raced };
  }
  return { state: "MADE", card };
}
