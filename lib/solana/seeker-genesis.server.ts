/**
 * «Перевірено Seeker» — whether a proven wallet holds a Seeker Genesis Token.
 *
 * A Seeker Genesis Token (SGT) is a Token-2022 NFT minted once per Seeker
 * phone into its owner's wallet. Solana Mobile's own package reads it:
 * `getSeekerGenesisTokens` lists the wallet's Token-2022 accounts, drops the
 * empty ones and keeps only the mints whose own bytes carry the SGT group in
 * both `TokenGroupMember` and `MetadataPointer` — never a name, a symbol or
 * off-chain metadata, so a look-alike NFT does not pass.
 *
 * **The server is the source of truth, in two halves.** The address is the one
 * the wallet proved by signing this server's Sign In With Solana message — a
 * single-use nonce, the domain and the expiry checked here
 * (`lib/auth/siws.ts`, `requireWalletProof`, a read) — never an address a
 * client names. A read also takes a wallet linked to the signed-in account
 * (`via: "link"`): its signature was checked when it was linked, and the link
 * is checked now. So a future reward must not bind to this answer — it needs a
 * fresh signature and a row of its own. The token is read here from mainnet, never taken from a client's
 * `hasSGT`. A connected wallet that has not signed proves nothing.
 *
 * **A failed read is not «no Seeker».** An RPC that refused, timed out or
 * answered past the ceiling is `unavailable` — the route says 503 and nothing
 * is cached — so a node that blinked never tells a Seeker owner they have none.
 *
 * **The answer is cached** per address in this instance: a found token for an
 * hour (an SGT rarely moves — Solana Mobile's own permanent delegate can move
 * or burn it — and the badge is a mark, not a permission), «none» for five minutes (a person who just moved
 * the token into this wallet sees it soon). Concurrent asks for one address
 * share one read. No reward hangs on this answer: one-per-device rewards would
 * key on the mint with a `UNIQUE` row in the database (SKR-0, 4.4) — a
 * migration, a row of its own.
 *
 * The node is any mainnet one (`RYNTRA_SOLANA_RPC_MAINNET`, `lib/solana/rpc.ts`);
 * a paid one (e.g. Helius) is preferred because public nodes limit
 * `getTokenAccountsByOwner` — the operator sets it at release (SKR-0, 21.10).
 *
 * Server only. Reads, never signs or sends.
 */

import { getSeekerGenesisTokens, type SeekerGenesisToken } from "@solana-mobile/skr-genesis-token";
import { isAddress, type Address } from "@solana/kit";

import { createSolanaRpcHandle } from "./rpc.ts";

/** A found token is kept this long; the badge is a mark, not a permission. */
export const SEEKER_FOUND_TTL_MS = 60 * 60_000;
/** «None» is kept briefly, so a token just moved into the wallet shows soon. */
export const SEEKER_NONE_TTL_MS = 5 * 60_000;
/** The whole read — both endpoints and the mint batches — ends by then. */
export const SEEKER_READ_DEADLINE_MS = 15_000;
const MAX_ENTRIES = 5_000;

export type SeekerToken = Readonly<{
  mint: string;
  /** The token's place in the SGT group, as a decimal string (a u64 on chain). */
  memberNumber: string;
}>;

export type SeekerCheck =
  | Readonly<{ status: "ok"; address: string; verified: boolean; tokens: readonly SeekerToken[]; checkedAt: string }>
  /** The chain could not be read now. Not «no Seeker»: the route says 503. */
  | Readonly<{ status: "unavailable" }>
  /** Not a Solana address; the route never gets here with a proven one. */
  | Readonly<{ status: "invalid" }>;

/** Reads the SGTs an address holds; throws when the chain could not be read. */
export type SeekerReader = (owner: Address, signal: AbortSignal) => Promise<readonly SeekerGenesisToken[]>;

type Answer = Extract<SeekerCheck, { status: "ok" }>;
type Entry = Readonly<{ answer: Answer; expiresAt: number }>;

export type SeekerCache = {
  entries: Map<string, Entry>;
  pending: Map<string, Promise<SeekerCheck>>;
};

export function createSeekerCache(): SeekerCache {
  return { entries: new Map(), pending: new Map() };
}

const SHARED = createSeekerCache();

/** The production reader: Solana Mobile's package over the configured mainnet pair. */
export const mainnetSeekerReader: SeekerReader = (owner, signal) => {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000 });
  return getSeekerGenesisTokens(handle.rpc, owner, { abortSignal: signal, commitment: "confirmed" });
};

function remember(cache: SeekerCache, address: string, entry: Entry): void {
  cache.entries.delete(address);
  while (cache.entries.size >= MAX_ENTRIES) {
    const oldest = cache.entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.entries.delete(oldest);
  }
  cache.entries.set(address, entry);
}

async function readOnce(address: Address, read: SeekerReader, now: () => number, deadlineMs: number): Promise<SeekerCheck> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /* The deadline holds even for a reader that ignores the signal. */
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("deadline"));
    }, deadlineMs);
  });
  try {
    const found = await Promise.race([read(address, controller.signal), deadline]);
    const tokens = [...found]
      .sort((a, b) => (a.memberNumber < b.memberNumber ? -1 : a.memberNumber > b.memberNumber ? 1 : 0))
      .map((token) => ({ mint: String(token.mint), memberNumber: token.memberNumber.toString() }));
    return { status: "ok", address, verified: tokens.length > 0, tokens, checkedAt: new Date(now()).toISOString() };
  } catch {
    /* The reason stays here: a provider's message can quote its URL, and the
       person needs only «not now», never «no Seeker». */
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether `address` holds a Seeker Genesis Token. Call it only with an address
 * the wallet proved by signature; the route does (`requireWalletProof`).
 */
export async function checkSeekerGenesis(
  address: string,
  options: Readonly<{ read?: SeekerReader; now?: () => number; cache?: SeekerCache; deadlineMs?: number }> = {},
): Promise<SeekerCheck> {
  if (!isAddress(address)) return { status: "invalid" };
  const read = options.read ?? mainnetSeekerReader;
  const now = options.now ?? Date.now;
  const cache = options.cache ?? SHARED;

  const kept = cache.entries.get(address);
  if (kept && kept.expiresAt > now()) return kept.answer;
  if (kept) cache.entries.delete(address);

  const inFlight = cache.pending.get(address);
  if (inFlight) return inFlight;

  const pending = readOnce(address, read, now, options.deadlineMs ?? SEEKER_READ_DEADLINE_MS).then((result) => {
    if (result.status === "ok") {
      remember(cache, address, { answer: result, expiresAt: now() + (result.verified ? SEEKER_FOUND_TTL_MS : SEEKER_NONE_TTL_MS) });
    }
    return result;
  }).finally(() => {
    cache.pending.delete(address);
  });
  cache.pending.set(address, pending);
  return pending;
}
