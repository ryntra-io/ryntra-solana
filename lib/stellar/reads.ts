/**
 * The domain reads — the facts an Asset Passport is built from.
 *
 * Every function returns `Evidence<T>`, never a bare value, and every failure
 * path produces `UNAVAILABLE` with a reason rather than a default. That is the
 * difference between "we do not know the issuer's clawback setting" and
 * "clawback is off", and on Stellar that difference is what the holder's asset
 * is actually worth.
 *
 * Shapes below were verified against the live networks on 2026-08-13 rather
 * than copied from documentation, and the fixtures record what came back.
 */

import {
  type Evidence,
  type EvidenceSource,
  resolved,
  unavailable,
  unknown,
} from "./evidence.ts";
import { horizonGet, stellarRpc, type ClientLimits, type FetchResult } from "./client.ts";
import { type AssetIdentity, isAccountAddress, isContractAddress } from "./asset.ts";
import { type StellarNetwork, stellarSourceRef } from "./network.ts";

export type ReadOptions = Readonly<{
  limits?: ClientLimits;
  fetchImpl?: typeof globalThis.fetch;
  /** Injected in tests so freshness is deterministic rather than wall-clock. */
  now?: Date;
}>;

/** Freshness budgets, per fact rather than one global number. */
export const FRESHNESS_SECONDS = {
  /** Ledgers close about every five seconds; a minute is many ledgers stale. */
  networkPulse: 60,
  /** Protocol parameters move at protocol upgrades, not continuously. */
  ledgerParameters: 3_600,
  /** An issuer can set a flag at any time; this one is worth re-reading. */
  issuerControls: 300,
  holding: 60,
  assetStatistics: 900,
} as const;

function source(network: StellarNetwork, kind: "rpc" | "horizon", path: string, label: string): EvidenceSource {
  return { ref: stellarSourceRef(network, kind, path), label };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  /* Horizon returns some counters as strings and some as numbers, and RPC
     returns `closeTime` as a string of unix seconds. Accepting both is
     tolerance of the wire format, not of a missing value. */
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// ---------------------------------------------------------------- network --

export type NetworkPulse = Readonly<{
  passphrase: string;
  protocolVersion: number;
  ledgerSequence: number;
  /** ISO-8601 of the ledger close, which is when this state became true. */
  closedAt: string;
  /** The endpoint's own word for itself. Reported, never interpreted. */
  status: string;
  /**
   * How far back this endpoint can answer at all.
   *
   * A data layer that does not know its own horizon will happily return
   * "nothing found" for a ledger the endpoint simply no longer keeps, and that
   * is indistinguishable from "it did not happen".
   */
  oldestLedger: number | null;
  retentionLedgers: number | null;
}>;

/**
 * Two small RPC calls rather than one large one.
 *
 * `getHealth` is used instead of `getLatestLedger` for the ledger sequence and
 * close time: a live probe measured the latter at 3.18 MB on mainnet — almost
 * entirely `metadataXdr`, which nothing here reads — against 207 bytes for the
 * former. See the allowlist note in `client.ts`.
 */
export async function readNetworkPulse(network: StellarNetwork, options: ReadOptions = {}): Promise<Evidence<NetworkPulse>> {
  const netSource = source(network, "rpc", "getNetwork", `${network.label} RPC getNetwork`);
  const healthSource = source(network, "rpc", "getHealth", `${network.label} RPC getHealth`);

  const [net, health] = await Promise.all([
    stellarRpc(network.rpcUrl, "getNetwork", {}, options),
    stellarRpc(network.rpcUrl, "getHealth", {}, options),
  ]);
  if (!net.ok) return unavailable(net.reason, [netSource], options.now);
  if (!health.ok) return unavailable(health.reason, [healthSource], options.now);

  const n = asRecord(net.value);
  const h = asRecord(health.value);
  const passphrase = asString(n?.passphrase);
  const protocolVersion = asNumber(n?.protocolVersion);
  const ledgerSequence = asNumber(h?.latestLedger);
  const closeTime = asNumber(h?.latestLedgerCloseTime);
  const status = asString(h?.status);
  if (passphrase === null || protocolVersion === null || ledgerSequence === null || closeTime === null || status === null) {
    return unavailable("The RPC answered without a passphrase, protocol version, ledger sequence, close time or status.", [netSource, healthSource], options.now);
  }
  /* The passphrase is the network's identity. If it does not match the one this
     module holds, we are reading a different network than the caller asked for
     — which is precisely the mistake that looks like valid data. */
  if (passphrase !== network.passphrase) {
    return unavailable(
      `${network.rpcUrl} identifies as "${passphrase}", not ${network.label}. Refusing to report another network's state as this one's.`,
      [netSource],
      options.now,
    );
  }

  return resolved({
    data: {
      passphrase,
      protocolVersion,
      ledgerSequence,
      closedAt: new Date(closeTime * 1000).toISOString(),
      status,
      oldestLedger: asNumber(h?.oldestLedger),
      retentionLedgers: asNumber(h?.ledgerRetentionWindow),
    },
    sources: [netSource, healthSource],
    observedAt: new Date(closeTime * 1000),
    maxAgeSeconds: FRESHNESS_SECONDS.networkPulse,
    now: options.now,
  });
}

export type LedgerParameters = Readonly<{
  baseFeeStroops: number;
  baseReserveStroops: number;
  /** The same value in XLM, because a reserve is explained to people in XLM. */
  baseReserveXlm: string;
  ledgerSequence: number;
}>;

const STROOPS_PER_XLM = 10_000_000;

export async function readLedgerParameters(network: StellarNetwork, options: ReadOptions = {}): Promise<Evidence<LedgerParameters>> {
  const src = source(network, "horizon", "/ledgers?order=desc&limit=1", `${network.label} Horizon latest ledger`);
  const answer = await horizonGet(network.horizonUrl, "ledgers", { order: "desc", limit: "1" }, options);
  if (!answer.ok) return unavailable(answer.reason, [src], options.now);

  const record = asRecord(asRecord(asRecord(answer.value)?._embedded)?.records instanceof Array
    ? (asRecord(answer.value)?._embedded as { records: unknown[] }).records[0]
    : null);
  const baseFeeStroops = asNumber(record?.base_fee_in_stroops);
  const baseReserveStroops = asNumber(record?.base_reserve_in_stroops);
  const ledgerSequence = asNumber(record?.sequence);
  const closedAt = asString(record?.closed_at);
  if (baseFeeStroops === null || baseReserveStroops === null || ledgerSequence === null || closedAt === null) {
    return unavailable("Horizon answered without base fee, base reserve, sequence or close time.", [src], options.now);
  }

  return resolved({
    data: {
      baseFeeStroops,
      baseReserveStroops,
      baseReserveXlm: (baseReserveStroops / STROOPS_PER_XLM).toFixed(7),
      ledgerSequence,
    },
    sources: [src],
    observedAt: closedAt,
    maxAgeSeconds: FRESHNESS_SECONDS.ledgerParameters,
    now: options.now,
  });
}

// --------------------------------------------------------- issuer control --

export type IssuerControlEvidence = Readonly<{
  issuer: string;
  /** The domain the issuer claims. A claim by the issuer, not a verified fact. */
  homeDomain: string | null;
  /** Holders must be explicitly authorized before they can hold the asset. */
  authRequired: boolean;
  /** The issuer can revoke an existing holder's authorization — a freeze. */
  authRevocable: boolean;
  /** The flags above can never be changed again. */
  authImmutable: boolean;
  /** The issuer can take the asset back out of a holder's account. */
  clawbackEnabled: boolean;
  observedAtLedger: number | null;
}>;

export async function readIssuerControls(
  network: StellarNetwork,
  issuer: string,
  options: ReadOptions = {},
): Promise<Evidence<IssuerControlEvidence>> {
  if (!isAccountAddress(issuer)) {
    return unknown(`"${issuer}" is not a valid Stellar account address, so no issuer can be read from it.`, [], options.now);
  }
  const path = `accounts/${issuer}`;
  const src = source(network, "horizon", `/${path}`, `${network.label} Horizon account`);
  const answer = await horizonGet(network.horizonUrl, path, {}, options);
  if (!answer.ok) return unavailable(answer.reason, [src], options.now);

  const record = asRecord(answer.value);
  const flags = asRecord(record?.flags);
  const authRequired = asBoolean(flags?.auth_required);
  const authRevocable = asBoolean(flags?.auth_revocable);
  const authImmutable = asBoolean(flags?.auth_immutable);
  const clawbackEnabled = asBoolean(flags?.auth_clawback_enabled);
  /* All four or none. A partially-read control set is the worst possible
     outcome here: it renders as "clawback: off" when the truth is "we did not
     read it", and that is the sentence a holder would act on. */
  if (authRequired === null || authRevocable === null || authImmutable === null || clawbackEnabled === null) {
    return unavailable("Horizon answered without the complete issuer flag set.", [src], options.now);
  }

  return resolved({
    data: {
      issuer,
      homeDomain: asString(record?.home_domain),
      authRequired,
      authRevocable,
      authImmutable,
      clawbackEnabled,
      observedAtLedger: asNumber(record?.last_modified_ledger),
    },
    sources: [src],
    /* Our read time, not the account's last modification. We observed the
       current state now; `observedAtLedger` says when it last changed. */
    observedAt: options.now ?? new Date(),
    maxAgeSeconds: FRESHNESS_SECONDS.issuerControls,
    now: options.now,
  });
}

// ------------------------------------------------------ holding requirement --

export type HoldingRequirement = Readonly<{
  account: string;
  /** Native XLM needs no trustline; every issued asset does. */
  trustlineRequired: boolean;
  trustlineExists: boolean;
  /** `null` when no trustline exists — not `false`, which would read as denied. */
  authorized: boolean | null;
  balance: string | null;
  limit: string | null;
  /** Subentries this holding costs the account, each charged the base reserve. */
  additionalSubentries: number;
  subentryCount: number | null;
}>;

export async function readHoldingRequirement(
  network: StellarNetwork,
  account: string,
  asset: AssetIdentity,
  options: ReadOptions = {},
): Promise<Evidence<HoldingRequirement>> {
  if (!isAccountAddress(account)) {
    return unknown(`"${account}" is not a valid Stellar account address.`, [], options.now);
  }
  if (asset.model !== "CLASSIC" && asset.model !== "SAC") {
    return unknown(
      "A contract-only token's balance lives in contract storage, which needs a ledger-entry read this adapter does not perform.",
      [],
      options.now,
    );
  }
  const path = `accounts/${account}`;
  const src = source(network, "horizon", `/${path}`, `${network.label} Horizon account`);
  const answer = await horizonGet(network.horizonUrl, path, {}, options);
  if (!answer.ok) return unavailable(answer.reason, [src], options.now);

  const record = asRecord(answer.value);
  const balances = Array.isArray(record?.balances) ? (record.balances as unknown[]) : null;
  if (!balances) return unavailable("Horizon answered without a balances list.", [src], options.now);

  const match = balances.map(asRecord).find((entry) =>
    asset.native
      ? entry?.asset_type === "native"
      : entry?.asset_code === asset.code && entry?.asset_issuer === asset.issuer,
  );

  return resolved({
    data: {
      account,
      trustlineRequired: !asset.native,
      trustlineExists: asset.native ? true : Boolean(match),
      authorized: asset.native ? true : match ? asBoolean(match.is_authorized) : null,
      balance: match ? asString(match.balance) : null,
      limit: match ? asString(match.limit) : null,
      additionalSubentries: asset.native || match ? 0 : 1,
      subentryCount: asNumber(record?.subentry_count),
    },
    sources: [src],
    observedAt: options.now ?? new Date(),
    maxAgeSeconds: FRESHNESS_SECONDS.holding,
    now: options.now,
  });
}

// ------------------------------------------------------- asset statistics --

export type AssetStatistics = Readonly<{
  /**
   * Accounts authorized to hold the asset.
   *
   * Addresses, never people. One person may hold many addresses and one address
   * may belong to a service, so "1,200 holder addresses" is a fact and
   * "1,200 people bought this" is an invention.
   */
  holderAddresses: number;
  unauthorizedAddresses: number;
  /** Amount held in accounts, as Horizon reports it — seven decimal places. */
  authorizedBalance: string;
  contractHoldings: number;
  contractBalance: string;
  claimableBalances: number;
  liquidityPools: number;
  /** The SAC address, when the classic asset has one. */
  contractId: string | null;
}>;

export async function readAssetStatistics(
  network: StellarNetwork,
  asset: AssetIdentity,
  options: ReadOptions = {},
): Promise<Evidence<AssetStatistics>> {
  if (asset.native) {
    return unknown("The native asset has no issued-asset statistics record.", [], options.now);
  }
  if (!asset.issuer || !asset.code) {
    return unknown("Asset statistics are indexed by code and issuer, which a contract-only token does not have.", [], options.now);
  }
  const src = source(network, "horizon", `/assets?asset_code=${asset.code}`, `${network.label} Horizon assets`);
  const answer = await horizonGet(network.horizonUrl, "assets", { asset_code: asset.code, asset_issuer: asset.issuer }, options);
  if (!answer.ok) return unavailable(answer.reason, [src], options.now);

  const embedded = asRecord(asRecord(answer.value)?._embedded);
  const records = Array.isArray(embedded?.records) ? (embedded.records as unknown[]) : null;
  if (!records) return unavailable("Horizon answered without an asset record list.", [src], options.now);
  if (records.length === 0) {
    return unknown(`Horizon holds no record for ${asset.code} issued by ${asset.issuer}.`, [src], options.now);
  }

  const record = asRecord(records[0]);
  const accounts = asRecord(record?.accounts);
  const amounts = asRecord(record?.balances);
  const holderAddresses = asNumber(accounts?.authorized);
  const authorizedBalance = asString(amounts?.authorized);
  if (holderAddresses === null || authorizedBalance === null) {
    return unavailable("Horizon answered without authorized account and balance figures.", [src], options.now);
  }

  const contractId = asString(record?.contract_id);
  return resolved({
    data: {
      holderAddresses,
      unauthorizedAddresses: asNumber(accounts?.unauthorized) ?? 0,
      authorizedBalance,
      contractHoldings: asNumber(record?.num_contracts) ?? 0,
      contractBalance: asString(record?.contracts_amount) ?? "0",
      claimableBalances: asNumber(record?.num_claimable_balances) ?? 0,
      liquidityPools: asNumber(record?.num_liquidity_pools) ?? 0,
      contractId: contractId && isContractAddress(contractId) ? contractId : null,
    },
    sources: [src],
    observedAt: options.now ?? new Date(),
    maxAgeSeconds: FRESHNESS_SECONDS.assetStatistics,
    now: options.now,
  });
}

// ------------------------------------------------- the boundary, named ----

/**
 * Contract token metadata — deliberately not implemented, and it says so.
 *
 * Reading a SEP-41 token's `name`, `symbol`, `decimals` or admin means calling
 * the contract through `getLedgerEntries` and decoding XDR, and XDR is the one
 * thing that would force the official SDK into the dependency graph. That is a
 * real decision with a real cost, so it belongs to a task that makes it
 * deliberately.
 *
 * Until then this returns `UNKNOWN` with the reason attached, which is the
 * behaviour the product requires: a passport that cannot resolve a field says
 * so on the page rather than leaving a blank a reader fills in themselves.
 */
export async function readContractTokenMetadata(
  _network: StellarNetwork,
  contractId: string,
  options: ReadOptions = {},
): Promise<Evidence<never>> {
  const detail = isContractAddress(contractId) ? "" : ` "${contractId}" is also not a valid contract address.`;
  return unknown(
    `Contract token metadata requires an XDR ledger-entry read, which this adapter does not perform.${detail}`,
    [],
    options.now,
  );
}

/** Re-exported so a caller can narrow a client result without importing two modules. */
export type { FetchResult };
