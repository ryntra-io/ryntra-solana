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
 * - **Launch** — Ryntra Launch on Meteora DBC (plan §6.1): each preset's
 *   config, which every launched pool names on chain — a counter adds the
 *   partner's share of the fees those pools take, at the trade, as Ryntra
 *   Launch's fees; the partner's fee claimer, the Squads multisig's vault
 *   that collects them later — not counted again, the same money arriving;
 *   and the wallet that pays for creating the pools, which only identifies
 *   them; and the executor, which sends a curve's graduation and holds
 *   the Fee-Funded Liquidity Ladder on graduated launches — it takes no fee
 *   from people and is paid none of the partner's; what it earns is the fee of
 *   its own ladder in its DLMM steps: a counter ignores it. None of them is used for
 *   anything else: the configs, the pool payer and the executor were created
 *   for Launch, and the partner's vault — a vault that existed before — is
 *   Launch's from the first config that names it. And Meteora's referral
 *   account in a launch's trades — the vault's token account in the pair
 *   currency, which every trade made through Ryntra names as its referral, on
 *   the curve and in the pool after graduation: a counter adds the referral fee
 *   the program's swap event names for it, at the trade — never every credit to
 *   the account, where the partner's claims of the configs' fees may land too.
 *   After graduation the pool no longer names the config, and this account is
 *   how a trade of a graduated launch is Ryntra's.
 * - **Perps builder** — Ryntra's builder on Phoenix's Flight, the builder-code
 *   proxy every Perps order of Ryntra's goes through: the builder's address,
 *   which each routed order names, and its Phoenix trader account, where Flight
 *   moves the builder's fee as collateral inside the order. A counter adds the
 *   fee Flight logs for an order that names both — never a credit to the
 *   trader account, which is not a token account: Phoenix keeps its collateral
 *   inside its own program.
 * - **Micro and the demo market** — their configs name the executor as the
 *   partner's fee claimer, not the vault: the executor takes the migration fee,
 *   the partner's share of the surplus and of the trading fees and the fees of
 *   the partner's locked position itself, and keeps each market's budget from
 *   them. A config row says so by naming the executor as its parent. Of what
 *   the executor takes from Micro, three quarters of the partner's trading and
 *   position fees are Ryntra's revenue, kept on the same wallet outside the
 *   markets' budgets — a row of its own (`LAUNCH_REVENUE`), the executor's
 *   address under another job, and the one row allowed to share an address:
 *   it names the executor as its parent. Counted nowhere: the money is the
 *   config's fees, counted there. The demo market is Ryntra's technical
 *   validation of the whole cycle, marked so; its config counts nothing, since
 *   what Ryntra pays itself there is not demand.
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

export const REGISTRY_ROLES = ["FEE", "PAYOUT_CASHBACK", "PAYOUT_FRIENDS", "PAYOUT_INTEGRATORS", "PAYOUT_REWARDS", "TREASURY", "LAUNCH_CONFIG", "LAUNCH_FEE_CLAIMER", "LAUNCH_POOL_PAYER", "LAUNCH_EXECUTOR", "LAUNCH_REFERRAL", "LAUNCH_REVENUE", "PERPS_BUILDER", "AGENT_SIGNER"] as const;
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
  /** A Meteora DBC config of a Ryntra Launch preset; the pools launched on it name it. */
  "DBC_CONFIG",
  /** The config's fee claimer: the partner's Squads multisig vault. */
  "DBC_FEE_CLAIMER",
  /** The wallet that pays the rent of the pools Ryntra Launch creates. */
  "LAUNCH_POOL_PAYER",
  /** The wallet that sends a launch's graduation and holds the Fee-Funded Liquidity Ladder on graduated launches. */
  "LAUNCH_EXECUTOR",
  /** Meteora's referral account in a launch's trades: the partner's vault's token account in the pair currency. */
  "METEORA_REFERRAL_TOKEN_ACCOUNT",
  /** A builder registered with Phoenix's Flight; the orders routed through it name it. */
  "PHOENIX_FLIGHT_BUILDER",
  /** The builder's Phoenix trader account, where Flight moves the builder's fee as collateral. */
  "PHOENIX_BUILDER_TRADER_ACCOUNT",
  /** The agent's key with a budget: the one signer a person's mandate policy names; it trades only inside that policy. */
  "AGENT_SIGNER",
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
  /** Ryntra's own technical validation, never demand: the demo market's config. */
  technicalValidation?: true;
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
  /* The rewards treasury (`RYNTRA_REWARDS_TREASURY_SOLANA`): cashback, friends and, since Ріст GR-09, the creator
     partners' share of launch pools are paid from it. Never published. */
  { ...place("solana-payout-rewards", "PAYOUT_REWARDS", "PAYOUT_WALLET", [...EVERY_FEE_PRODUCT, "launch"], "SUPPLY_SIDE"), address: "CnYqvXcX7BaEKRB5AMbq5GkvQvNBdKPpvZRsdjJXiHr4" },
  place("solana-treasury", "TREASURY", "TREASURY_WALLET", [], "NONE"),
  /* Created on mainnet 2026-10-05, the creator's share 40 %; the fee claimer is vault 0 of the partner's Squads multisig
     4qFxfhdHoJvRtSyfmx8ZnCH8k8Cvb6WicPDaYYnsECLM. Two earlier configs with a 25 % share (8C7rCu7t…, J1HDwCmm…) were never
     used by Ryntra and are not Ryntra Launch's. */
  { ...place("solana-launch-config-classic", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "FEES"), address: "B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G" },
  { ...place("solana-launch-config-protected", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "FEES"), address: "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G" },
  /* «Спільнота» on JUP (SOL-L5), signed on mainnet 2026-10-20 at JUP $0.316: its curve in JUP,
     the same multisig's vault 0 its fee claimer; read back from the chain whole — 167 fields as the rehearsal's. */
  { ...place("solana-launch-config-community-jup", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "FEES"), mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", address: "6PmbsMGNeFifnshbBYn2MC5mNhxexzfqVQceGJ2bv9qC" },
  { ...place("solana-launch-fee-claimer", "LAUNCH_FEE_CLAIMER", "DBC_FEE_CLAIMER", ["launch"], "NONE"), address: "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA" },
  /* Its key is made in Google Cloud KMS and never leaves it (CITY-162); a launch pays it back in its own transaction. */
  { ...place("solana-launch-pool-payer", "LAUNCH_POOL_PAYER", "LAUNCH_POOL_PAYER", ["launch"], "NONE"), address: "7KUPNJRr6hmUDZXCL6AxJiHy4VYEVnEqwNkyJsbhbdKh" },
  /* The executor: a wallet of its own with a small budget, its key in Google Cloud KMS (CITY-162). It sends graduations
     and holds the Fee-Funded Liquidity Ladder; on mainnet only a key for this address is used. */
  { ...place("solana-launch-executor", "LAUNCH_EXECUTOR", "LAUNCH_EXECUTOR", ["launch"], "NONE"), address: "9o6PpWvnkoxeGHvKddzV6UgfzVxqBPimT9Q619bWYow6" },
  /* Micro and the demo market on the new executor: a config never changes, so the move to KMS made new ones. Their
     partner's fees go to the executor, which keeps each market's budget from them. The demo market is Ryntra's technical
     validation and counts nothing. */
  { ...place("solana-launch-config-micro", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "FEES"), parent: "solana-launch-executor", address: "6SwkHZqfYc77gwi6eKTw5atR7cn78deR73xGn88T7614" },
  { ...place("solana-launch-config-demo", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "NONE"), parent: "solana-launch-executor", technicalValidation: true, address: "AkYhPZaJme13FAWordkRSwSHX5R6nGLPvnaykoN2SzvX" },
  /* Ryntra's revenue from Micro: three quarters of the partner's trading and position fees, on the executor's wallet outside
     the markets' budgets until the operator moves it to the multisig. */
  { ...place("solana-launch-revenue-micro", "LAUNCH_REVENUE", "LAUNCH_EXECUTOR", ["launch"], "NONE"), parent: "solana-launch-executor", address: "9o6PpWvnkoxeGHvKddzV6UgfzVxqBPimT9Q619bWYow6" },
  /* The identities before KMS, retired at their last transaction: the keys that lived in the environment (pool payer from
     2026-10-06, executor from 2026-10-09), and the Micro and demo configs of 2026-10-10 that name that executor. Their
     history stays Ryntra's and stays public; the executor's old key still holds what it took on the demo market. */
  { ...place("solana-launch-pool-payer-env", "LAUNCH_POOL_PAYER", "LAUNCH_POOL_PAYER", ["launch"], "NONE"), address: "H2Bzv5pcrEGug1STGbZhvX98DGb3SCFa4pnAtUwktyyV", end: { block: 455314404, time: "2026-10-10T16:02:57.000Z" } },
  { ...place("solana-launch-executor-env", "LAUNCH_EXECUTOR", "LAUNCH_EXECUTOR", ["launch"], "NONE"), address: "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU", end: { block: 460075158, time: "2026-10-22T14:49:27.000Z" } },
  { ...place("solana-launch-config-micro-env", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "FEES"), parent: "solana-launch-executor-env", address: "3xh95YxdDBDiR35mWJo4E3hVoXNDqW4hdXemuWwsBD8w", end: { block: 455172778, time: "2026-10-10T07:28:11.000Z" } },
  { ...place("solana-launch-config-demo-env", "LAUNCH_CONFIG", "DBC_CONFIG", ["launch"], "NONE"), parent: "solana-launch-executor-env", technicalValidation: true, address: "GVDLyxgHraJcbmzds6i6hMgb3jSUUhSaHq5XVFnq6AS5", end: { block: 455348450, time: "2026-10-10T18:07:34.000Z" } },
  /* Meteora's referral in a launch's trades: the partner's vault's USDC account, which every trade through Ryntra names as
     its referral since 2026-10-08 — never the creator's first purchase, which goes without one so the program grants it
     the minimum fee. Counted by the swap event's referral fee, never by its credits. */
  {
    ...place("solana-launch-referral-usdc", "LAUNCH_REFERRAL", "METEORA_REFERRAL_TOKEN_ACCOUNT", ["launch"], "FEES"),
    parent: "solana-launch-fee-claimer",
    mint: USDC,
    address: "4kVogGhWqheXKjteM2urywUS5L8q7AnSNJCYDna4VrDy",
  },
  /* Ryntra's builder on Phoenix's Flight, registered by the operator on mainnet 2026-10-22 at 2 bps (B6b): a new account for
     this job alone, its key held outside this repository. Flight takes the fee from the taker part of an order routed
     through it — post-only orders stay Phoenix's own and pay none — and moves it into the builder's trader account. */
  { ...place("solana-perps-builder", "PERPS_BUILDER", "PHOENIX_FLIGHT_BUILDER", ["perps"], "FEES"), address: "AAsopcXAB2WzeaTtCfuPS7nanGod8EefReaeVQCSopyN" },
  { ...place("solana-perps-builder-trader", "PERPS_BUILDER", "PHOENIX_BUILDER_TRADER_ACCOUNT", ["perps"], "FEES"), parent: "solana-perps-builder", address: "4e2gmdF9VF4dLJB6DiLKmEfnYSJJMiDY8vUriroj6nqB" },
  /* The agent with a budget (CITY-186): its key made in Google Cloud KMS by the operator on 2026-11-02 (`agent-mandate`,
     version 1) and never leaving it. Every person's mandate names this one address as its signer; it pays its own network
     fees from SOL the person moved to it, and Ryntra's fee goes to the fee wallet, never here. On devnet now; on mainnet
     only a key for this address is used. */
  { ...place("solana-agent-signer", "AGENT_SIGNER", "AGENT_SIGNER", ["bots"], "NONE"), address: "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV" },
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
    technicalValidation: z.literal(true).optional(),
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
      /* The one exception: Ryntra's revenue from Micro is the executor's own wallet under another job, and names it. */
      const sameWallet = row.role === "LAUNCH_REVENUE" && other !== undefined && other === row.parent;
      if (other && !sameWallet) problems.push(`${row.id}: the address is already ${other}'s`);
      if (!other) addresses.set(key, row.id);
    }
    if (row.address === null && row.end !== null) problems.push(`${row.id}: a row without an address cannot end`);
    const roleFits =
      row.role === "FEE"
        ? ["FEE_WALLET", "JUPITER_REFERRAL_ACCOUNT", "JUPITER_REFERRAL_TOKEN_ACCOUNT", "RELAY_APP_FEE_RECIPIENT"].includes(row.kind) && row.countedAs === "FEES"
        : row.role === "TREASURY"
          ? row.kind === "TREASURY_WALLET" && row.countedAs === "NONE"
          : row.role === "LAUNCH_CONFIG"
            ? row.kind === "DBC_CONFIG" && row.countedAs === (row.technicalValidation ? "NONE" : "FEES")
            : row.role === "LAUNCH_FEE_CLAIMER"
              ? row.kind === "DBC_FEE_CLAIMER" && row.countedAs === "NONE"
              : row.role === "LAUNCH_POOL_PAYER"
                ? row.kind === "LAUNCH_POOL_PAYER" && row.countedAs === "NONE"
                : row.role === "LAUNCH_EXECUTOR"
                  ? row.kind === "LAUNCH_EXECUTOR" && row.countedAs === "NONE"
                  : row.role === "LAUNCH_REFERRAL"
                    ? row.kind === "METEORA_REFERRAL_TOKEN_ACCOUNT" && row.countedAs === "FEES"
                    : row.role === "LAUNCH_REVENUE"
                      ? row.kind === "LAUNCH_EXECUTOR" && row.countedAs === "NONE"
                      : row.role === "PERPS_BUILDER"
                        ? (row.kind === "PHOENIX_FLIGHT_BUILDER" || row.kind === "PHOENIX_BUILDER_TRADER_ACCOUNT") && row.countedAs === "FEES"
                      : row.role === "AGENT_SIGNER"
                        ? row.kind === "AGENT_SIGNER" && row.countedAs === "NONE"
                    : row.kind === "PAYOUT_WALLET" && row.countedAs === "SUPPLY_SIDE";
    if (!roleFits) problems.push(`${row.id}: the role, the kind and how it is counted disagree`);
    if (row.role !== "TREASURY" && row.products.length === 0) problems.push(`${row.id}: names no product`);
    if ((row.kind === "JUPITER_REFERRAL_TOKEN_ACCOUNT" || row.kind === "METEORA_REFERRAL_TOKEN_ACCOUNT") && (row.parent === null || row.mint === null)) problems.push(`${row.id}: a referral token account names its account and its mint`);
  }
  for (const row of rows) if (row.parent !== null && !rows.some((other) => other.id === row.parent)) problems.push(`${row.id}: its parent ${row.parent} is not registered`);
  const roleOf = (id: string | null) => rows.find((other) => other.id === id)?.role ?? null;
  for (const row of rows) {
    if (row.technicalValidation && row.role !== "LAUNCH_CONFIG") problems.push(`${row.id}: only a launch config is a technical validation`);
    /* A config's parent is the executor that claims its partner fees; none — the partner's vault does. */
    if (row.role === "LAUNCH_CONFIG" && row.parent !== null && roleOf(row.parent) !== "LAUNCH_EXECUTOR") problems.push(`${row.id}: a config's claimer is the executor or the partner's vault`);
    if (row.role === "LAUNCH_REVENUE") {
      const executor = rows.find((other) => other.id === row.parent);
      if (executor?.role !== "LAUNCH_EXECUTOR") problems.push(`${row.id}: Ryntra's revenue from Micro sits on the executor's wallet`);
      else if (row.address !== null && row.address !== executor.address) problems.push(`${row.id}: Ryntra's revenue from Micro is the executor's own address`);
    }
    /* A builder's trader account names its builder; a builder stands on its own. */
    if (row.kind === "PHOENIX_BUILDER_TRADER_ACCOUNT" && rows.find((other) => other.id === row.parent)?.kind !== "PHOENIX_FLIGHT_BUILDER") problems.push(`${row.id}: a builder's trader account names its builder`);
    if (row.kind === "PHOENIX_FLIGHT_BUILDER" && row.parent !== null) problems.push(`${row.id}: a builder names no parent`);
  }
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
  for (const role of ["LAUNCH_FEE_CLAIMER", "LAUNCH_POOL_PAYER"] as const) {
    if (rows.filter((row) => row.role === role && row.network === "solana" && row.end === null).length > 1) problems.push(`${role}: more than one open row`);
  }
  for (const row of rows) if (row.role.startsWith("LAUNCH_") && (row.products.length !== 1 || row.products[0] !== "launch")) problems.push(`${row.id}: a launch identity serves Ryntra Launch alone`);
  for (const row of rows) if (row.role === "PERPS_BUILDER" && (row.products.length !== 1 || row.products[0] !== "perps")) problems.push(`${row.id}: the builder serves Perps alone`);
  for (const row of rows) if (row.role === "AGENT_SIGNER" && (row.products.length !== 1 || row.products[0] !== "bots")) problems.push(`${row.id}: the agent's key serves the agent alone`);
  if (rows.filter((row) => row.role === "AGENT_SIGNER" && row.network === "solana" && row.end === null).length > 1) problems.push("AGENT_SIGNER: more than one open row");
  return problems;
}

/* --------------------------------------------------------------- reading */

export function registryStatus(row: RegistryEntry): RegistryStatus {
  if (row.address === null) return "AWAITING_ADDRESS";
  return row.end !== null ? "RETIRED" : "LISTED";
}

/** Roles whose payouts would name inviters: registered, never published. */
export const UNPUBLISHED_ROLES: ReadonlySet<RegistryRole> = new Set(["PAYOUT_FRIENDS", "PAYOUT_REWARDS"]);

/**
 * Roles drawn only once their product is open to people: an identity that
 * exists on chain before people can use its product is held here and named on
 * a public page when the product opens — the address is never written twice.
 * Ryntra Launch's identities were held so until it opened on 2026-10-06; the
 * agent's key, until its mainnet opened to people of
 * 2026-11-04 (CITY-186). None waits now.
 */
export const NOT_YET_OPEN_ROLES: ReadonlySet<RegistryRole> = new Set<RegistryRole>([]);

/** Whether a row may be published — on the page, in the JSON, in a public query. */
export function isPublishable(row: RegistryEntry): boolean {
  return row.address !== null && !UNPUBLISHED_ROLES.has(row.role) && !NOT_YET_OPEN_ROLES.has(row.role);
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

/**
 * `starts`: where an identity that is not credited started — a Launch config, the partner's vault, the pool payer —
 * read from the chain on its own: the first transaction it took part in.
 */
export function publicRegistryDocument(
  rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY,
  facts: RegistryFacts | null = null,
  feeAccounts: ReadonlyMap<string, readonly string[]> = new Map(),
  starts: ReadonlyMap<string, RegistryMoment> = new Map(),
): PublicRegistry {
  return {
    version: ATTRIBUTION_REGISTRY_VERSION,
    observed: facts !== null,
    rows: publicRegistry(rows).map((row) => {
      const start = facts?.get(row.id) ?? (row.role.startsWith("LAUNCH_") ? (starts.get(row.id) ?? null) : null);
      const counted = row.network === "solana" && (row.kind === "FEE_WALLET" || row.kind === "JUPITER_REFERRAL_ACCOUNT" || row.kind === "JUPITER_REFERRAL_TOKEN_ACCOUNT");
      return { ...row, status: registryStatus(row), start, example: start?.tx ?? null, observed: facts !== null && counted, accounts: row.kind === "FEE_WALLET" ? (feeAccounts.get(row.id) ?? null) : null };
    }),
  };
}
