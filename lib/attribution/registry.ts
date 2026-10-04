/**
 * The attribution registry — every identity on which an outside counter can
 * tell that money moved through Ryntra.
 *
 * Pure and client-safe: no clock, no network, no `process.env`. This file is
 * the public record: `/stats` draws it, `/api/stats/registry` serves it as
 * JSON, the Dune queries and the DefiLlama draft are built from it, and the
 * chain reader counts the fee identities it names. One list, read everywhere.
 *
 * ## What a row is
 *
 * One address with one job on one network: the network, the products whose
 * flow it serves, its role and the address. An address does one job and
 * appears once — a fee wallet never pays a reward and a payout wallet never
 * takes a fee — so a counter that reads one address reads one meaning.
 *
 * ## Where a row starts is read, not written
 *
 * The block an identity started at and a transaction that shows it at work
 * are chain facts: the first credit the chain reader finds for it
 * (`registryFacts`). Nothing here states them, for the reason the attribution
 * boundary is not a date written in code — the chain says it, and a reader
 * that cannot see the whole history says it does not know.
 *
 * ## Roles, and how a counter treats them
 *
 * - **Fee** — where a person's Ryntra fee lands, inside the same transaction
 *   as the trade: Ryntra's fee wallet on Solana — one wallet for every product
 *   (swap, memes, stocks, bots, API) since 2026-10-05; a product
 *   that needs its own figures on a public counter gets a wallet of its own
 *   later, as a new row — and the Jupiter referral account the swap lane has
 *   carried since 2026-09-10. A counter adds what arrives here as fees; which
 *   product a fee came from is the operation's, read from the history.
 * - **Payout** — what Ryntra gives back: cashback, friends, integrators. A
 *   counter treats what leaves here as the supply side's share, never as
 *   revenue. Until each kind is paid from its own wallet, the rewards wallet
 *   the product pays cashback and friends from today is one row of its own
 *   (`PAYOUT_REWARDS`); it is closed with an end block when the payouts move.
 * - **Treasury** — Ryntra's own reserve. Nothing is charged into it; a counter
 *   ignores it.
 *
 * A wallet that pays friends' rewards — the friends' payout wallet, and the
 * rewards wallet while it pays them too — is registered here and never
 * published: everyone it pays would be named publicly as somebody's inviter.
 *
 * ## The rows that wait for an address
 *
 * A row with no address is a place kept for an identity created outside this
 * repository — the keys are held by Ryntra's operator alone, and this file
 * holds public addresses and nothing else. It counts nothing and is never
 * drawn on a public page; it becomes a working row the moment its address is
 * written here. The bridge's app-fee recipient is such a place: its fee
 * accrues off chain at Relay, and it is published once it is a recipient used
 * for nothing else.
 */

import { z } from "zod";

import { NETWORK_IDS, PRODUCT_IDS, type NetworkId, type Product } from "../core/contracts.ts";

export const ATTRIBUTION_REGISTRY_VERSION = "1.0.0";

/**
 * The networks a row can sit on: the core's networks, and Relay's own ledger,
 * where a bridge's app fee accrues off chain against an EVM claim address.
 */
export const REGISTRY_NETWORKS = [...NETWORK_IDS, "relay"] as const;
export type RegistryNetwork = NetworkId | "relay";

export const REGISTRY_ROLES = ["FEE", "PAYOUT_CASHBACK", "PAYOUT_FRIENDS", "PAYOUT_INTEGRATORS", "PAYOUT_REWARDS", "TREASURY"] as const;
export type RegistryRole = (typeof REGISTRY_ROLES)[number];

/** How the identity exists on its network. */
export const REGISTRY_KINDS = [
  /** A plain wallet whose token accounts receive the fee in the trade's own transaction. */
  "FEE_WALLET",
  /** Jupiter's referral program account; the fee lands in the token accounts it owns. */
  "JUPITER_REFERRAL_ACCOUNT",
  /** A token account the referral account owns, one per fee mint. */
  "JUPITER_REFERRAL_TOKEN_ACCOUNT",
  /** The EVM address Relay accrues the app fee to, off chain. */
  "RELAY_APP_FEE_RECIPIENT",
  /** A wallet rewards are paid from. */
  "PAYOUT_WALLET",
  /** Ryntra's reserve. */
  "TREASURY_WALLET",
] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

/** How a public counter (DefiLlama, Dune) treats money at this address. */
export type RegistryCount =
  /** What arrives is fees people paid. */
  | "FEES"
  /** What leaves is the supply side's share — rewards, never revenue. */
  | "SUPPLY_SIDE"
  /** Not counted. */
  | "NONE";

/** A moment on a network: the block (slot on Solana), its time, and the transaction. */
export type RegistryMoment = Readonly<{
  network: NetworkId;
  block: number;
  time: string | null;
  tx: string;
}>;

export type RegistryEntry = Readonly<{
  id: string;
  network: RegistryNetwork;
  products: readonly Product[];
  role: RegistryRole;
  kind: RegistryKind;
  /** The identity this account belongs to (a referral token account names its referral account). */
  parent: string | null;
  /** The mint a token account holds; null for a wallet. */
  mint: string | null;
  /** The public address. Null while the identity has not been created. */
  address: string | null;
  /** Set when the identity is retired; nothing after it is counted. */
  end: Readonly<{ block: number; time: string }> | null;
  countedAs: RegistryCount;
}>;

/** What a row is now, derived — never written by hand. */
export type RegistryStatus = "AWAITING_ADDRESS" | "LISTED" | "RETIRED";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

/** The products whose fee lands in a Solana fee wallet — today all in one. */
export const FEE_WALLET_PRODUCTS = ["swap", "memes", "stocks", "bots", "api"] as const satisfies readonly Product[];

/** Ryntra's fee wallet on Solana, since 2026-10-05. A public receiving address; its key is held outside this repository. */
export const SOLANA_FEE_WALLET = "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne";

function place(id: string, role: RegistryRole, kind: RegistryKind, products: readonly Product[], countedAs: RegistryCount, network: RegistryNetwork = "solana"): RegistryEntry {
  return { id, network, products, role, kind, parent: null, mint: null, address: null, end: null, countedAs };
}

const LIVE_TRADING: readonly Product[] = ["swap", "memes", "stocks"];
const EVERY_FEE_PRODUCT: readonly Product[] = ["swap", "memes", "stocks", "bots", "api", "bridge"];
const REFERRAL = "solana-jupiter-referral";

/**
 * The rows. Order is the order a reader meets them: the identities at work,
 * then the places kept for the ones still to be created.
 */
export const ATTRIBUTION_REGISTRY: readonly RegistryEntry[] = Object.freeze([
  {
    id: REFERRAL,
    network: "solana",
    products: LIVE_TRADING,
    role: "FEE",
    kind: "JUPITER_REFERRAL_ACCOUNT",
    parent: null,
    mint: null,
    address: "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv",
    end: null,
    countedAs: "FEES",
  },
  {
    id: "solana-jupiter-referral-sol",
    network: "solana",
    products: LIVE_TRADING,
    role: "FEE",
    kind: "JUPITER_REFERRAL_TOKEN_ACCOUNT",
    parent: REFERRAL,
    mint: WSOL,
    address: "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY",
    end: null,
    countedAs: "FEES",
  },
  {
    id: "solana-jupiter-referral-usdc",
    network: "solana",
    products: LIVE_TRADING,
    role: "FEE",
    kind: "JUPITER_REFERRAL_TOKEN_ACCOUNT",
    parent: REFERRAL,
    mint: USDC,
    address: "55p9Zk8tzq6YhnPgopW5X1sX5kHX1v1zuRiQNwqa5hYH",
    end: null,
    countedAs: "FEES",
  },
  {
    id: "solana-fee-wallet",
    network: "solana",
    products: FEE_WALLET_PRODUCTS,
    role: "FEE",
    kind: "FEE_WALLET",
    parent: null,
    mint: null,
    address: SOLANA_FEE_WALLET,
    end: null,
    countedAs: "FEES",
  },
  place("relay-app-fee", "FEE", "RELAY_APP_FEE_RECIPIENT", ["bridge"], "FEES", "relay"),
  place("solana-payout-cashback", "PAYOUT_CASHBACK", "PAYOUT_WALLET", EVERY_FEE_PRODUCT, "SUPPLY_SIDE"),
  place("solana-payout-friends", "PAYOUT_FRIENDS", "PAYOUT_WALLET", EVERY_FEE_PRODUCT, "SUPPLY_SIDE"),
  place("solana-payout-integrators", "PAYOUT_INTEGRATORS", "PAYOUT_WALLET", ["api"], "SUPPLY_SIDE"),
  place("solana-payout-rewards", "PAYOUT_REWARDS", "PAYOUT_WALLET", EVERY_FEE_PRODUCT, "SUPPLY_SIDE"),
  place("solana-treasury", "TREASURY", "TREASURY_WALLET", [], "NONE"),
]);

/* ------------------------------------------------------------ validation */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const isEvm = (network: RegistryNetwork) => network !== "solana" && network !== "hyperliquid";

const EntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,60}$/),
    network: z.enum(REGISTRY_NETWORKS),
    products: z.array(z.enum(PRODUCT_IDS)),
    role: z.enum(REGISTRY_ROLES),
    kind: z.enum(REGISTRY_KINDS),
    parent: z.string().nullable(),
    mint: z.string().regex(BASE58).nullable(),
    address: z.string().nullable(),
    end: z.object({ block: z.number().int().positive(), time: z.string().datetime({ offset: true }) }).strict().nullable(),
    countedAs: z.enum(["FEES", "SUPPLY_SIDE", "NONE"]),
  })
  .strict();

/** The registry checked as a whole; an empty list means it holds. */
export function validateRegistry(rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): readonly string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const addresses = new Map<string, string>();
  for (const row of rows) {
    const parsed = EntrySchema.safeParse(row);
    if (!parsed.success) for (const issue of parsed.error.issues) problems.push(`${row.id}: ${issue.path.join(".")} ${issue.message}`);
    if (ids.has(row.id)) problems.push(`${row.id}: registered twice`);
    ids.add(row.id);
    if (row.address !== null) {
      const shape = isEvm(row.network) ? EVM_ADDRESS : BASE58;
      if (!shape.test(row.address)) problems.push(`${row.id}: the address is not a ${isEvm(row.network) ? "0x" : "base58"} address`);
      /* One address, one job: a counter that reads an address reads one meaning. */
      const key = row.address.toLowerCase();
      const other = addresses.get(key);
      if (other) problems.push(`${row.id}: the address is already ${other}'s`);
      addresses.set(key, row.id);
    }
    if (row.address === null && row.end !== null) problems.push(`${row.id}: a row without an address cannot end`);
    const roleFits =
      row.role === "FEE"
        ? ["FEE_WALLET", "JUPITER_REFERRAL_ACCOUNT", "JUPITER_REFERRAL_TOKEN_ACCOUNT", "RELAY_APP_FEE_RECIPIENT"].includes(row.kind) && row.countedAs === "FEES"
        : row.role === "TREASURY"
          ? row.kind === "TREASURY_WALLET" && row.countedAs === "NONE"
          : row.kind === "PAYOUT_WALLET" && row.countedAs === "SUPPLY_SIDE";
    if (!roleFits) problems.push(`${row.id}: the role, the kind and how it is counted disagree`);
    if (row.role !== "TREASURY" && row.products.length === 0) problems.push(`${row.id}: names no product`);
    if (row.kind === "JUPITER_REFERRAL_TOKEN_ACCOUNT" && (row.parent === null || row.mint === null)) problems.push(`${row.id}: a referral token account names its account and its mint`);
  }
  for (const row of rows) if (row.parent !== null && !rows.some((other) => other.id === row.parent)) problems.push(`${row.id}: its parent ${row.parent} is not registered`);
  /* One open fee wallet for each product (one wallet may serve several), one payout wallet per kind, one treasury. */
  for (const product of FEE_WALLET_PRODUCTS) {
    const count = rows.filter((row) => row.kind === "FEE_WALLET" && row.network === "solana" && row.end === null && row.products.includes(product)).length;
    if (count !== 1) problems.push(`fee wallet for ${product}: ${count} rows, one expected`);
  }
  for (const role of ["PAYOUT_CASHBACK", "PAYOUT_FRIENDS", "PAYOUT_INTEGRATORS", "TREASURY"] as const) {
    const count = rows.filter((row) => row.role === role && row.network === "solana" && row.end === null).length;
    if (count !== 1) problems.push(`${role}: ${count} rows, one expected`);
  }
  if (rows.filter((row) => row.role === "PAYOUT_REWARDS" && row.end === null).length > 1) problems.push("PAYOUT_REWARDS: more than one open row");
  return problems;
}

/* --------------------------------------------------------------- reading */

export function registryStatus(row: RegistryEntry): RegistryStatus {
  if (row.address === null) return "AWAITING_ADDRESS";
  return row.end !== null ? "RETIRED" : "LISTED";
}

/** Roles whose payouts would name inviters: registered, never published. */
export const UNPUBLISHED_ROLES: ReadonlySet<RegistryRole> = new Set(["PAYOUT_FRIENDS", "PAYOUT_REWARDS"]);

/** Whether a row may be published — on the page, in the JSON, in a public query. */
export function isPublishable(row: RegistryEntry): boolean {
  return row.address !== null && !UNPUBLISHED_ROLES.has(row.role);
}

/** The rows a public page draws: every row with an address whose payouts name no inviter. A kept place without one is not drawn. */
export function publicRegistry(rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): readonly RegistryEntry[] {
  return rows.filter(isPublishable);
}

/** The places still waiting for an address, by id. */
export function awaitingAddresses(rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): readonly string[] {
  return rows.filter((row) => row.address === null).map((row) => row.id);
}

/** A Solana fee identity the chain reader counts: the referral account or a product's fee wallet. */
export type SolanaFeeOwner = Readonly<{ id: string; address: string; kind: "JUPITER_REFERRAL_ACCOUNT" | "FEE_WALLET"; products: readonly Product[]; endSlot: number | null }>;

/**
 * The Solana addresses whose incoming fees make a transaction Ryntra's: the
 * fee wallets with an address, and the referral account. Token accounts are
 * not owners — the reader finds them under their owner on chain. A retired
 * identity stays, bounded by its end: its history is still Ryntra's.
 */
export function solanaFeeOwners(rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): readonly SolanaFeeOwner[] {
  const owners: SolanaFeeOwner[] = [];
  for (const row of rows) {
    if (row.network !== "solana" || row.role !== "FEE" || row.address === null) continue;
    if (row.kind !== "FEE_WALLET" && row.kind !== "JUPITER_REFERRAL_ACCOUNT") continue;
    owners.push({ id: row.id, address: row.address, kind: row.kind, products: row.products, endSlot: row.end?.block ?? null });
  }
  return owners;
}

/** The open fee wallet a product's fee lands in on a network, or null while it has none there. */
export function feeWalletOf(product: Product, network: RegistryNetwork = "solana", rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): string | null {
  const row = rows.find((entry) => entry.kind === "FEE_WALLET" && entry.network === network && entry.end === null && entry.products.includes(product));
  return row?.address ?? null;
}

/* ------------------------------------------------------- chain facts */

/** The first credit the chain reader saw for one identity in one mint. */
export type FirstCredit = Readonly<{ identity: string; mint: string; signature: string; slot: number; blockTime: number | null }>;

/** Where each row started, from the chain: its first credit, which is also the transaction shown at work. */
export type RegistryFacts = ReadonlyMap<string, RegistryMoment>;

function momentOf(credit: FirstCredit): RegistryMoment {
  return { network: "solana", block: credit.slot, time: credit.blockTime === null ? null : new Date(credit.blockTime * 1000).toISOString(), tx: credit.signature };
}

/**
 * The start of every row the chain reader counts: a fee identity's earliest
 * credit in any mint, a referral token account's earliest credit in its own
 * mint. A row the reader does not count (a payout, the treasury) has none.
 */
export function registryFacts(firstCredits: readonly FirstCredit[], rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): RegistryFacts {
  const facts = new Map<string, RegistryMoment>();
  const earliest = (matches: (credit: FirstCredit) => boolean): FirstCredit | null =>
    firstCredits.filter(matches).sort((left, right) => left.slot - right.slot || (left.signature < right.signature ? -1 : 1))[0] ?? null;
  for (const row of rows) {
    if (row.address === null || row.network !== "solana") continue;
    const credit =
      row.kind === "JUPITER_REFERRAL_TOKEN_ACCOUNT"
        ? earliest((entry) => entry.identity === row.parent && entry.mint === row.mint)
        : row.kind === "FEE_WALLET" || row.kind === "JUPITER_REFERRAL_ACCOUNT"
          ? earliest((entry) => entry.identity === row.id)
          : null;
    if (credit) facts.set(row.id, momentOf(credit));
  }
  return facts;
}

/** One published row: the registry's fields, its status, and where it started when the chain says. */
export type PublicRegistryRow = RegistryEntry &
  Readonly<{
    status: RegistryStatus;
    /** The first transaction the identity took part in; null when the chain shows none or was not read. */
    start: RegistryMoment | null;
    /** A transaction that shows the identity at work — its first. */
    example: string | null;
    /** Whether the chain reader counts this row and saw its whole history: a missing start then means none yet. */
    observed: boolean;
    /** A product fee wallet's canonical fee accounts — the only accounts a counter should read for it; null for every other row. */
    accounts: readonly string[] | null;
  }>;

/** The registry as `/api/stats/registry` serves it and `/stats` draws it. */
export type PublicRegistry = Readonly<{
  version: string;
  /** Whether the whole history of the fee identities was read: a missing start then means none yet. */
  observed: boolean;
  rows: readonly PublicRegistryRow[];
}>;

export function publicRegistryDocument(
  rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY,
  facts: RegistryFacts | null = null,
  feeAccounts: ReadonlyMap<string, readonly string[]> = new Map(),
): PublicRegistry {
  return {
    version: ATTRIBUTION_REGISTRY_VERSION,
    observed: facts !== null,
    rows: publicRegistry(rows).map((row) => {
      const start = facts?.get(row.id) ?? null;
      const counted = row.network === "solana" && (row.kind === "FEE_WALLET" || row.kind === "JUPITER_REFERRAL_ACCOUNT" || row.kind === "JUPITER_REFERRAL_TOKEN_ACCOUNT");
      return { ...row, status: registryStatus(row), start, example: start?.tx ?? null, observed: facts !== null && counted, accounts: row.kind === "FEE_WALLET" ? (feeAccounts.get(row.id) ?? null) : null };
    }),
  };
}
