/**
 * «Clean the wallet» — what the chain and the market say of one wallet now.
 *
 * The wallet's token accounts of both token programs (jsonParsed, one call each), the extensions of its Token-2022
 * mints (one call), and each coin's market row — price, Jupiter's verification, organic score, mint and freeze
 * rights, liquidity — from the engine's own Tokens V2 read (`lib/spot/markets.server.ts`). Nothing is priced here
 * that the engine does not price; a coin the market does not know has no price and is not verified.
 */

import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import { readSpotMarketsByMint } from "../spot/markets.server.ts";
import { resolveEndpoint } from "../solana/rpc.ts";
import {
  NO_EXTRAS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  chainAccountOf,
  mintExtrasOf,
  type ChainAccount,
  type CoinFacts,
  type MintExtras,
} from "./rules.ts";

const CALL_MS = 9_000;

let kept: Readonly<{ url: string; connection: Connection }> | null = null;

/** The mainnet connection the clean reads and relays on. */
export function cleanConnection(): Connection {
  const url = resolveEndpoint("mainnet");
  if (kept && kept.url === url) return kept.connection;
  const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  kept = { url, connection };
  return connection;
}

export function within<T>(promise: Promise<T>, ms = CALL_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The network did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Every token account of the wallet, both programs. Throws when the chain does not answer. */
export async function readAccounts(owner: string, connection: Connection = cleanConnection()): Promise<ChainAccount[]> {
  const key = new PublicKey(owner);
  const [classic, extended] = await Promise.all(
    [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((program) => within(connection.getParsedTokenAccountsByOwner(key, { programId: new PublicKey(program) }, "confirmed")).then((answer) => ({ program, answer }))),
  );
  const accounts: ChainAccount[] = [];
  for (const { program, answer } of [classic!, extended!]) {
    for (const row of answer.value) {
      const account = chainAccountOf(row.pubkey.toBase58(), { lamports: row.account.lamports, data: row.account.data }, program);
      if (account) accounts.push(account);
    }
  }
  return accounts;
}

const chunks = <T>(list: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, at) => list.slice(at * size, at * size + size));

/**
 * The extensions of the wallet's Token-2022 mints that matter to a holder. Throws when the chain does not answer: a fee
 * or a hook not read is never read as none.
 */
async function readExtras(accounts: readonly ChainAccount[], connection: Connection): Promise<Map<string, MintExtras>> {
  const mints = [...new Set(accounts.filter((account) => account.program === TOKEN_2022_PROGRAM).map((account) => account.mint))];
  const extras = new Map<string, MintExtras>();
  if (!mints.length) return extras;
  const epoch = await within(connection.getEpochInfo("confirmed")).then((info) => info.epoch, () => null);
  for (const part of chunks(mints, 100)) {
    const infos = await within(connection.getMultipleParsedAccounts(part.map((mint) => new PublicKey(mint)), { commitment: "confirmed" }));
    infos.value.forEach((info, index) => {
      if (info) extras.set(part[index]!, mintExtrasOf({ data: info.data }, epoch));
    });
  }
  return extras;
}

export type WalletRead = Readonly<{
  accounts: readonly ChainAccount[];
  facts: ReadonlyMap<string, CoinFacts>;
  /** The market answered: prices and verification stand. False — every coin is read as unpriced and unverified. */
  priced: boolean;
  solUsd: number | null;
}>;

/** The wallet now: its accounts, and what the mint and the market say of each coin in them. */
export async function readWallet(owner: string, connection: Connection = cleanConnection()): Promise<WalletRead> {
  const accounts = await readAccounts(owner, connection);
  const mints = [...new Set([...accounts.map((account) => account.mint)])];
  // Every mint is asked of the market, a hundred at a time; one part unanswered — the market is read as not answered.
  const [extras, parts] = await Promise.all([
    readExtras(accounts, connection),
    Promise.all(chunks([...new Set([...mints, "So11111111111111111111111111111111111111112"])], 100).map((part) => readSpotMarketsByMint(part).catch(() => null))),
  ]);
  const byMint = parts.every((part) => part && part.ok) ? new Map(parts.flatMap((part) => (part && part.ok ? [...part.byMint] : []))) : null;
  const facts = new Map<string, CoinFacts>();
  for (const mint of mints) {
    const row = byMint?.get(mint) ?? null;
    const extra = extras.get(mint) ?? NO_EXTRAS;
    facts.set(mint, {
      mint,
      symbol: row?.symbol ?? null,
      name: row?.name ?? null,
      icon: row?.icon ? `/api/icon/${mint}` : null,
      price: row?.price ?? null,
      verified: row?.verified === true,
      organicLow: row?.organicScoreLabel === "low",
      mintOff: row?.audit.mintAuthorityDisabled ?? null,
      freezeOff: row?.audit.freezeAuthorityDisabled ?? null,
      liquidityUsd: row?.liquidityUsd ?? null,
      ...extra,
    });
  }
  const sol = byMint?.get("So11111111111111111111111111111111111111112")?.price ?? null;
  return { accounts, facts, priced: byMint !== null, solUsd: sol !== null && sol > 0 ? sol : null };
}
