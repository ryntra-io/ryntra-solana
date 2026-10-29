/**
 * A launched market's constitution (MOS-1) — built from what the chain fixed at launch and the policies Ryntra's server
 * runs, by `lib/core/launch/constitution.ts`, with its SHA-256 over the canonical JSON.
 *
 * It reads: the token's view (`readLaunchView` — the launch receipt, served again for a few seconds), the curve's config
 * account (once per process: a config never changes) and, when the launch made one, the creator's lock escrow (its terms
 * never change either). Nothing is built on a guess: a receipt not read now answers `UNREAD`, a token the receipt's rules
 * refuse answers `REFUSED`, and a lock, Ryntra's own wallets or the creation's time that could not be read answers `UNREAD`
 * — the document is whole or not served. The reasons are codes: a node's error can name its endpoint, which is not public.
 */

import { createHash } from "node:crypto";

import { buildMarketConstitution, constitutionCanonicalJson, MARKET_CONSTITUTION_SCHEMA, type ConstitutionLock, type MarketConstitution } from "../core/launch/constitution.ts";
import { observeCreatorLock } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { receiptRefusedByRules } from "../core/venues/meteora-dbc/receipt.ts";
import { launchExecutorAddress } from "./config.server.ts";
import type { LaunchDeps } from "./flow.server.ts";
import { readLaunchView } from "./view.server.ts";

export type ConstitutionRead =
  | Readonly<{ state: "READ"; schema: typeof MARKET_CONSTITUTION_SCHEMA; sha256: string; canonical: string; document: MarketConstitution; observedAt: string }>
  | Readonly<{ state: "UNREAD" | "REFUSED"; reason: "CHAIN_UNREAD" | "NOT_A_RYNTRA_LAUNCH" | "OWN_WALLETS_UNREAD"; observedAt: string }>;

/** Ryntra's own wallets — the executor's own rule of «Ryntra launched it» (`ryntraOwnWallets`), and whether the list is whole. */
export type ConstitutionDeps = Omit<LaunchDeps, "poolPayer"> & Readonly<{ poolPayer: string; ownWallets: () => Promise<Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>> }>;

/** Where a market's canonical document is served. */
export const constitutionPath = (token: string) => `/api/launch/${token}/constitution`;

/* A lock's escrow states its terms once: read once per process and escrow; a read that failed is not remembered. */
const LOCKS = new Map<string, Promise<ConstitutionLock | null>>();

function lockTerms(deps: Pick<LaunchDeps, "connection" | "network">, escrow: string): Promise<ConstitutionLock | null> {
  const key = `${deps.network.cluster}:${escrow}`;
  let read = LOCKS.get(key);
  if (!read) {
    read = observeCreatorLock(deps.connection, escrow).then((lock) =>
      lock
        ? { escrow: lock.escrow, program: lock.program, mint: lock.mint, creator: lock.creator, recipient: lock.recipient, totalRaw: lock.totalRaw, cliffAt: lock.cliffAt, endsAt: lock.endsAt, cancelMode: lock.cancelMode, updateRecipientMode: lock.updateRecipientMode }
        : null,
    );
    LOCKS.set(key, read);
    read.then((lock) => (lock ? undefined : LOCKS.delete(key)), () => LOCKS.delete(key));
  }
  return read;
}

/** The market's constitution; null when Ryntra launched no such token here. */
export async function readMarketConstitution(deps: ConstitutionDeps, token: string): Promise<ConstitutionRead | null> {
  const view = await readLaunchView(deps, token);
  const observedAt = deps.now().toISOString();
  if (!view) return null;
  const receipt = view.receipt;
  if (!receipt) {
    const refused = receiptRefusedByRules(view.receiptProblems);
    return { state: refused ? "REFUSED" : "UNREAD", reason: refused ? "NOT_A_RYNTRA_LAUNCH" : "CHAIN_UNREAD", observedAt };
  }
  /* A creation whose time the node did not give would change the hash once a later read knows it: not served until then. */
  if (!receipt.created.at) return { state: "UNREAD", reason: "CHAIN_UNREAD", observedAt };
  const own = await deps.ownWallets().catch(() => null);
  const ours = own?.wallets.has(receipt.creator) ?? false;
  /* Not among the wallets read, and the list not read whole: whether Ryntra launched it is not known — never «a person's». */
  if (!own || (!ours && !own.complete)) return { state: "UNREAD", reason: "OWN_WALLETS_UNREAD", observedAt };
  try {
    const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs: {} });
    const [config, lock] = await Promise.all([venue.plainConfig(receipt.config), view.lock ? lockTerms(deps, view.lock.escrow) : Promise.resolve(null)]);
    /* The launch made a lock whose escrow was not read now: never «no lock» — not served until a read sees its terms. */
    if (view.lock && !lock) return { state: "UNREAD", reason: "CHAIN_UNREAD", observedAt };
    const document = buildMarketConstitution({
      receipt,
      config,
      lock,
      ryntra: { partnerVault: deps.network.referralOwner, executor: launchExecutorAddress(deps.network) },
      ours,
      advancedFirstBuyCapBps: view.advanced?.terms.firstBuyCapBps ?? null,
      documentPath: constitutionPath(receipt.token),
    });
    const canonical = constitutionCanonicalJson(document);
    return { state: "READ", schema: MARKET_CONSTITUTION_SCHEMA, sha256: createHash("sha256").update(canonical).digest("hex"), canonical, document, observedAt };
  } catch {
    return { state: "UNREAD", reason: "CHAIN_UNREAD", observedAt };
  }
}
