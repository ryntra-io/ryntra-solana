import { getPrimarySkrDomain, getSkrDomains, resolveSkrDomain } from "@solana-mobile/skr-domain";
import { address as toAddress, type GetAccountInfoApi, type GetMultipleAccountsApi, type GetProgramAccountsApi, type Rpc } from "@solana/kit";

import { FixedWindowLimiter } from "../http-control.ts";
import { createSolanaRpcHandle, withRpcDiscipline } from "./rpc.ts";
import { shownSkrName, skrNameOf } from "./skr-name.ts";

/**
 * `.skr` names on the server (SKR-4): a name to its owner, and an address to its name — mainnet only, through the one
 * RPC module (`rpc.ts`) and Solana Mobile's own package (`@solana-mobile/skr-domain`, the SKR-0 review 21.10, §5).
 *
 * Two directions, two rules, both from the package's own guidance (the `seeker-domains` skill, «Cache by direction»):
 *
 * - **Name → address is never cached.** The answer is where money goes. A name can be transferred or expire between
 *   two reads, so every read asks the chain, and «Надіслати» asks again right before the wallet opens.
 * - **Address → name is cached for an hour,** a «none» as well: it is a label, never a destination, and a page that
 *   shows a wallet's name asks for it often. A read that failed is not cached — the next one asks again.
 *
 * For anyone else's address only the primary name counts (`getPrimarySkrDomain`) — the one name the wallet chose. The
 * list of names a wallet holds (`getSkrDomains`) proves nothing, because anyone can send a name to anyone, so it is
 * asked only for the person's own wallet (`self`), only here on the server — its `getProgramAccounts` is refused or
 * rate-limited by many RPCs — and under a budget of its own. Nothing here signs, sends or reads a key.
 */

type SkrRpc = Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetProgramAccountsApi>;

export type SkrForward =
  | Readonly<{ state: "FOUND"; name: string; address: string }>
  | Readonly<{ state: "NOT_FOUND"; name: string }>
  | Readonly<{ state: "UNAVAILABLE"; name: string }>;

export type SkrReverse =
  | Readonly<{ state: "FOUND"; address: string; name: string; source: "primary" | "owned" }>
  | Readonly<{ state: "NONE"; address: string }>
  | Readonly<{ state: "UNAVAILABLE"; address: string }>;

export type SkrDeps = Readonly<{
  /** The RPC and its discipline; a test hands its own. */
  read: <T>(run: (rpc: SkrRpc, abortSignal: AbortSignal) => Promise<T>) => Promise<T>;
  now: () => number;
}>;

const REVERSE_TTL_MS = 60 * 60_000;
const REVERSE_KEEP = 5_000;

/* `getProgramAccounts` for a wallet's own list: a budget for the whole instance, beside the route's per-client window,
   so a page opened in a thousand tabs never turns into a thousand scans of the name program. */
const OWNED_LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 1 });

function defaultDeps(): SkrDeps {
  return {
    read: async (run) => {
      const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 4_000, retries: 0 });
      return withRpcDiscipline(handle, (abortSignal) => run(handle.rpc as unknown as SkrRpc, abortSignal));
    },
    now: () => Date.now(),
  };
}

/**
 * A `.skr` name to the address that owns it now — asked of the chain every time. `NOT_FOUND` when the name is not
 * registered or has expired, `UNAVAILABLE` when the chain did not answer (never read as «no such name»).
 */
export async function resolveSkrForward(input: string, deps: SkrDeps = defaultDeps()): Promise<SkrForward> {
  const name = skrNameOf(input);
  if (!name) throw new Error("not a .skr name");
  try {
    const domain = await deps.read((rpc, abortSignal) => resolveSkrDomain(rpc, name, { abortSignal, commitment: "confirmed" }));
    if (!domain) return { state: "NOT_FOUND", name };
    return { state: "FOUND", name, address: String(domain.owner) };
  } catch {
    /* An RPC fault, or a name wrapped as an NFT, which the package refuses to read as an owner. */
    return { state: "UNAVAILABLE", name };
  }
}

type Cached = Readonly<{ at: number; value: SkrReverse }>;
const reverseCache = new Map<string, Cached>();

function remember(key: string, value: SkrReverse, at: number) {
  if (reverseCache.size >= REVERSE_KEEP) {
    const oldest = reverseCache.keys().next().value;
    if (oldest !== undefined) reverseCache.delete(oldest);
  }
  reverseCache.set(key, { at, value });
}

/**
 * An address to its `.skr` name: the primary name the wallet chose, and — only for the person's own wallet — the first
 * of the names it holds when it chose none. Cached an hour, a «none» too; a failed read is not.
 */
export async function readSkrName(
  wallet: string,
  options: Readonly<{ self?: boolean }> = {},
  deps: SkrDeps = defaultDeps(),
): Promise<SkrReverse> {
  const owner = toAddress(wallet);
  const self = options.self === true;
  const key = `${self ? "self" : "any"}:${owner}`;
  const now = deps.now();
  const hit = reverseCache.get(key);
  if (hit && now - hit.at < REVERSE_TTL_MS) return hit.value;

  let primary: string | null;
  try {
    primary = shownSkrName(await deps.read((rpc, abortSignal) => getPrimarySkrDomain(rpc, owner, { abortSignal, commitment: "confirmed" })));
  } catch {
    return { state: "UNAVAILABLE", address: wallet };
  }
  if (primary) {
    const value: SkrReverse = { state: "FOUND", address: wallet, name: primary, source: "primary" };
    remember(key, value, now);
    return value;
  }
  if (!self) {
    const value: SkrReverse = { state: "NONE", address: wallet };
    remember(key, value, now);
    return value;
  }

  if (!OWNED_LIMITER.consume("owned").allowed) return { state: "UNAVAILABLE", address: wallet };
  try {
    const names = await deps.read((rpc, abortSignal) => getSkrDomains(rpc, owner, { abortSignal, commitment: "confirmed" }));
    /* Sorted by the package, so the label does not change between reads; the first one that is a name in our sense. */
    const first = names.map(shownSkrName).find((name): name is string => name !== null) ?? null;
    const value: SkrReverse = first ? { state: "FOUND", address: wallet, name: first, source: "owned" } : { state: "NONE", address: wallet };
    remember(key, value, now);
    return value;
  } catch {
    /* Many RPCs refuse `getProgramAccounts`; that is «could not read», never «no name». */
    return { state: "UNAVAILABLE", address: wallet };
  }
}

/** For tests: forget every cached name. */
export function forgetSkrNamesForTests(): void {
  reverseCache.clear();
}
