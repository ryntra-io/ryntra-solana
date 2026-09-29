/**
 * Reads what «Ризик портфеля» stands on and judges it (`portfolio-risk.ts`;
 * `RYN-PROTECT-SIGNAL-001`, subtask 2): the wallet's company positions as
 * Нагляд judged them (`readPositions`), every other token the chain says the
 * wallet holds — dollars at a dollar, the rest at the catalogue's price — and
 * the SOL balance, so each share is of the whole wallet.
 *
 * Nothing unread is guessed. A token program that did not answer, a market
 * that did not, an exit, a SOL balance or a price that could not be read is a
 * gap, and a gap keeps «Нормальний» from being said. A company's price counts
 * only while it is fresh — the half hour Нагляд trusts.
 *
 * Only a token the catalogue verifies is counted in the wallet's worth. One it
 * does not verify, or marks suspicious, was named and priced by whoever made
 * it — an airdrop could otherwise speak in Ryntra's own warning, or dilute the
 * real holdings into a false «Нормальний» — so it stays outside, as a token
 * with no market does; a verified token whose price did not come is a gap.
 */

import type { GuardStore } from "../guard/store.ts";
import { DOLLAR_MINTS, DOLLAR_SYMBOLS, judgePortfolioRisk, weekendAhead, type PortfolioRisk, type RiskAsset, type RiskGap, type RiskPosition } from "./portfolio-risk.ts";
import { readPositions, type PositionsDeps } from "./positions.server.ts";
import { freshPrice } from "./watch-state.ts";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;
const DOLLAR_DECIMALS = 6;
/** How many tokens besides the companies are priced at most (the catalogue answers 50 a read); a wallet with more is not claimed read. */
export const RISK_PRICED_TOKENS_MAX = 200;

/** The catalogue's word on a token: its price, its names, whether it verifies the token and whether it marks it suspicious. */
export type TokenPrice = Readonly<{ usd: number | null; symbol: string | null; name: string | null; verified: boolean; suspicious: boolean }>;
/** Prices per mint; null when the catalogue did not answer. A mint absent from the answer has no market the catalogue knows. */
export type TokenPricesReader = (mints: readonly string[]) => Promise<ReadonlyMap<string, TokenPrice> | null>;
/** The wallet's SOL in lamports; null when it could not be read. */
export type SolBalanceReader = (owner: string) => Promise<bigint | null>;

export type PortfolioRiskDeps = PositionsDeps & Readonly<{ readSolBalance: SolBalanceReader; readPrices: TokenPricesReader }>;

export type PortfolioRiskRead = Readonly<{ risk: PortfolioRisk; at: string }>;

const worth = (raw: bigint, decimals: number, usd: number): number => (Number(raw) / 10 ** decimals) * usd;
const shortMint = (mint: string): string => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

export async function readPortfolioRisk(store: GuardStore, owner: string, nowMs: number, deps: PortfolioRiskDeps): Promise<PortfolioRiskRead> {
  const [read, lamports] = await Promise.all([readPositions(store, owner, nowMs, deps), deps.readSolBalance(owner).catch(() => null)]);
  const gaps = new Set<RiskGap>();
  if (read.holdings !== "complete") gaps.add("holdings");
  if (read.market !== "ok") gaps.add("market");
  /* An exit that could not be read is unknown, not absent: no position is called without a limit on it, and no verdict is «Нормальний». */
  if (read.exits !== "complete") gaps.add("exits");
  if (lamports === null) gaps.add("balance");

  const assets: RiskAsset[] = [];
  const positions: RiskPosition[] = [];
  for (const view of read.positions) {
    const facts = read.facts.get(view.mint);
    const kind = facts?.privateCompany === true ? "private" : "company";
    positions.push({
      mint: view.mint,
      symbol: view.symbol,
      name: view.name,
      kind,
      state: view.state,
      reason: view.reason,
      hasLimit: view.exit !== null ? true : read.exits === "complete" ? false : null,
      weekendAhead: kind === "company" && weekendAhead({ nowMs, exchangeClosed: facts?.exchangeClosed === true, closedUntil: facts?.closedUntil }),
    });
    if (view.valueUsd === null || freshPrice(view.price, view.observedAt, nowMs) === null) {
      gaps.add("prices");
      continue;
    }
    /* A listed company is one asset across its tokens; a private one is its own. */
    const key = kind === "company" && facts?.company ? `company:${facts.company}` : view.mint;
    assets.push({ key, mint: view.mint, symbol: view.symbol, name: view.name, kind, valueUsd: view.valueUsd });
  }

  /* Every other token: what is not a company Нагляд read (a company under a cent is dust, left out as on Home). */
  const wallet = read.wallet;
  const others = wallet ? [...wallet.held].filter(([mint, raw]) => raw > 0n && !read.facts.has(mint)) : [];
  for (const [mint, raw] of others) {
    if (!DOLLAR_MINTS.has(mint)) continue;
    const symbol = DOLLAR_SYMBOLS.get(mint) ?? "USD";
    assets.push({ key: mint, mint, symbol, name: symbol, kind: "dollar", valueUsd: worth(raw, wallet?.decimals?.get(mint) ?? DOLLAR_DECIMALS, 1) });
  }
  const coins = others.filter(([mint]) => !DOLLAR_MINTS.has(mint) && mint !== WRAPPED_SOL_MINT);
  const solRaw = (lamports ?? 0n) + (wallet?.held.get(WRAPPED_SOL_MINT) ?? 0n);
  if (coins.length > RISK_PRICED_TOKENS_MAX) gaps.add("prices");
  const priced = [WRAPPED_SOL_MINT, ...coins.slice(0, RISK_PRICED_TOKENS_MAX).map(([mint]) => mint)];
  const prices = solRaw > 0n || coins.length > 0 ? await deps.readPrices(priced).catch(() => null) : new Map<string, TokenPrice>();
  if (prices === null) {
    gaps.add("prices");
  } else {
    if (solRaw > 0n) {
      const usd = prices.get(WRAPPED_SOL_MINT)?.usd ?? null;
      if (usd === null) gaps.add("prices");
      else assets.push({ key: WRAPPED_SOL_MINT, mint: WRAPPED_SOL_MINT, symbol: "SOL", name: "Solana", kind: "crypto", valueUsd: worth(solRaw, SOL_DECIMALS, usd) });
    }
    for (const [mint, raw] of coins.slice(0, RISK_PRICED_TOKENS_MAX)) {
      const price = prices.get(mint);
      /* Unverified, suspicious or unknown to the catalogue: outside the wallet's worth, never named in a warning. */
      if (!price || !price.verified || price.suspicious) continue;
      if (price.usd === null) {
        gaps.add("prices");
        continue;
      }
      const decimals = wallet?.decimals?.get(mint);
      if (decimals === undefined) {
        gaps.add("prices");
        continue;
      }
      /* The catalogue's own words, bounded as the contract carries them. */
      const symbol = (price.symbol || shortMint(mint)).slice(0, 32);
      assets.push({ key: mint, mint, symbol, name: (price.name || symbol).slice(0, 200), kind: "crypto", valueUsd: worth(raw, decimals, price.usd) });
    }
  }

  return { risk: judgePortfolioRisk({ positions, assets, gaps: [...gaps] }), at: read.at };
}
