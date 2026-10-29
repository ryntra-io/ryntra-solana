/**
 * USDC collateral on Phoenix from the person's own Solana wallet: a deposit, a withdrawal and the margin
 * they move, each signed by the wallet itself. No bridge, no embedded wallet, no key of Ryntra's; Phoenix's program
 * holds the collateral, and no fee of Ryntra's is added (the Flight builder fee is for orders, a word of the operator's).
 *
 * Pure: the gate, the request, the margin as Phoenix's API reads it, what a built transaction may call, and the ticket
 * that seals the exact bytes a Review showed. The chain and Phoenix's API are `collateral.server.ts`.
 *
 * A deposit is three instructions in one transaction (SDK `buildDepositIxs`): open the wallet's own account of
 * Phoenix's dollar token if it has none, `EmberDeposit` — USDC into that token 1:1 — and `DepositFunds` into the
 * trader account (PDA index 0, cross-margin subaccount 0). A withdrawal is the way back: open the token accounts if
 * missing, approve Ember for exactly the amount, `WithdrawFunds`, `EmberWithdraw` to USDC. Phoenix may queue a
 * withdrawal when its shared budget is spent; then the last step cannot convert and the whole transaction fails in the
 * Review's simulation — nothing is signed for it, never a half-done withdrawal.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";

import { walletAdditionsAllowed } from "../liquidity/studio/ticket.ts";
import { BLOCKHASH_LIFE_MS } from "../solana/blockhash-life.ts";
import { base58, LIGHTHOUSE_PROGRAM } from "../solana/limits/model.ts";
import { ed25519Valid, LIGHTHOUSE_FIRST_ASSERTION, MAX_PRIORITY_LAMPORTS } from "../solana/limits/trigger-tx.ts";
import { isV1Wire, legacyView, readV1, type TxView } from "../solana/v1-tx.ts";

import { MAX_COLLATERAL_MICRO, MIN_COLLATERAL_MICRO, USDC_DECIMALS, type PhoenixMargin, type PhoenixPositionRisk } from "./collateral-model.ts";

export * from "./collateral-model.ts";

/* ------------------------------------------------------------- addresses */

/** Phoenix's perpetuals program on mainnet (SDK `rust/ix/src/constants.rs`, B7a §1). */
export const PHOENIX_PROGRAM = "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih";
/** Ember: USDC in, Phoenix's dollar token out, 1:1 — and back. */
export const EMBER_PROGRAM = "EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy";
/** Ember's state, the delegate a withdrawal approves for exactly its amount. */
export const EMBER_STATE = "6ur7v6AXNpnHeEb6xuk7PyezvZ1i5GrgYyWZkNCpzbRz";
/** Ember's USDC vault: a deposit's USDC goes there, a withdrawal's comes from it. */
export const EMBER_VAULT = "FKcEb4TdPDTRuMnQDpSEPQBcrm15S73xiUD6Qf8ZLUkq";
/** Phoenix's vault of its dollar token (`globalVault` of `/v1/view/exchange`). */
export const PHOENIX_GLOBAL_VAULT = "csZXgw2G58hbiWc9ndxaxrQVYVvqdXgQzYLuznEzHJu";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Phoenix's canonical dollar token, what Ember mints from USDC (`canonicalMint` of `/v1/view/exchange`). */
export const PHOENIX_USD_MINT = "PhUsd11YkbjSaWjFncfAAmatntsjx3MgDR9B6g1ks3A";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const ownAta = (owner: string, mint: string): string => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true).toBase58();

/** The trader account a wallet trades from: PDA `["trader", wallet, 0, 0]` — PDA index 0, the cross-margin subaccount. */
export function traderAccountOf(owner: string): string {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("trader"), new PublicKey(owner).toBuffer(), Buffer.from([0]), Buffer.from([0])], new PublicKey(PHOENIX_PROGRAM));
  return pda.toBase58();
}

/**
 * Another subaccount of the same trader — PDA `["trader", wallet, 0, subaccount]` (SDK `getPhoenixTraderSubaccountAddress`):
 * where an isolated-margin position lives. Only read, for its margin view; nothing is ever built or signed against it.
 */
export function traderSubaccountOf(owner: string, subaccount: number): string {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("trader"), new PublicKey(owner).toBuffer(), Buffer.from([0]), Buffer.from([subaccount])], new PublicKey(PHOENIX_PROGRAM));
  return pda.toBase58();
}

/* ------------------------------------------------------------------ gate */

/**
 * Who may move collateral today, set at runtime like the pools' gate: `CLOSED` (the default, and any other value) —
 * no screen offers it and no route builds it; `CANARY` — the one wallet named in the environment, a deposit or a
 * withdrawal of at most `CANARY_MAX_USD` each: the operator's first live check on mainnet; `OPEN` — everyone. A stranger
 * under `CANARY` is told the same as under `CLOSED`. The gate is asked at the Review and again at the relay: a gate
 * that closed or narrowed in between holds the bytes back.
 */
export const PHOENIX_COLLATERAL_ENV = "RYNTRA_PHOENIX_COLLATERAL";
export const PHOENIX_CANARY_WALLET_ENV = "RYNTRA_PHOENIX_CANARY_WALLET";
export const CANARY_MAX_USD = 5;

export type Env = Readonly<Record<string, string | undefined>>;
export type CollateralAction = "deposit" | "withdraw";

export type CollateralAdmission = Readonly<{ ok: true; mode: "CANARY" | "OPEN"; maxMicro: bigint | null }> | Readonly<{ ok: false; code: "ACTIONS_CLOSED" }>;

export function admitCollateral(owner: string | null, env: Env): CollateralAdmission {
  const mode = env[PHOENIX_COLLATERAL_ENV]?.trim().toUpperCase();
  if (mode === "OPEN") return { ok: true, mode, maxMicro: null };
  if (mode === "CANARY") {
    const wallet = env[PHOENIX_CANARY_WALLET_ENV]?.trim();
    if (wallet && owner !== null && owner === wallet) return { ok: true, mode, maxMicro: BigInt(CANARY_MAX_USD) * 10n ** BigInt(USDC_DECIMALS) };
  }
  return { ok: false, code: "ACTIONS_CLOSED" };
}

/* --------------------------------------------------------------- request */

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DIGITS = /^\d{1,16}$/;

/** `format`: v1 bytes for a wallet that signs them (Phantom asks for v1), legacy otherwise. */
export type CollateralRequest = Readonly<{ action: CollateralAction; owner: string; amountMicro: bigint; format?: "legacy" | "v1" }>;

/** The browser's body, field by field; anything else is refused before Phoenix or the chain is asked. */
export function parseCollateralRequest(body: unknown): CollateralRequest | null {
  if (!body || typeof body !== "object") return null;
  const { action, owner, amount, format } = body as Record<string, unknown>;
  if (action !== "deposit" && action !== "withdraw") return null;
  if (typeof owner !== "string" || !WALLET.test(owner)) return null;
  try {
    new PublicKey(owner);
  } catch {
    return null;
  }
  if (typeof amount !== "string" || !DIGITS.test(amount)) return null;
  const amountMicro = BigInt(amount);
  if (amountMicro < MIN_COLLATERAL_MICRO || amountMicro > MAX_COLLATERAL_MICRO) return null;
  if (format !== undefined && format !== "legacy" && format !== "v1") return null;
  return format === "v1" ? { action, owner, amountMicro, format } : { action, owner, amountMicro };
}

/* ---------------------------------------------------------------- margin */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A `TokenAmount` in raw units; null for anything that is not one. */
function rawOf(value: unknown): bigint | null {
  if (!isObject(value)) return null;
  const raw = value.value;
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return BigInt(raw);
  if (typeof raw === "string" && /^-?\d{1,30}$/.test(raw)) return BigInt(raw);
  return null;
}

function usdOf(value: unknown): number | null {
  const raw = rawOf(value);
  const decimals = isObject(value) && typeof value.decimals === "number" ? value.decimals : USDC_DECIMALS;
  return raw === null ? null : Number(raw) / 10 ** decimals;
}

/** In micro-dollars, never below zero. */
function microOf(value: unknown): bigint | null {
  const raw = rawOf(value);
  if (raw === null) return null;
  const decimals = isObject(value) && typeof value.decimals === "number" && Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 18 ? value.decimals : USDC_DECIMALS;
  const scaled = decimals >= USDC_DECIMALS ? raw / 10n ** BigInt(decimals - USDC_DECIMALS) : raw * 10n ** BigInt(USDC_DECIMALS - decimals);
  return scaled < 0n ? 0n : scaled;
}

const RISK_TIERS = new Set(["safe", "atRisk", "cancellable", "liquidatable", "backstopLiquidatable", "highRisk"]);

/** `capabilities.capabilities.<name>.immediate` — whether Phoenix lets the account do it now. */
function capable(view: Json, name: string): boolean {
  const outer = isObject(view.capabilities) ? view.capabilities : {};
  const inner = isObject(outer.capabilities) ? outer.capabilities : outer;
  const entry = inner[name];
  return isObject(entry) && entry.immediate === true;
}

/**
 * The view's positions as the page shows them beside the trader state's: where each is liquidated (a mark price) and
 * its leverage — the position's value over the initial margin it holds (SDK: initial margin = value / leverage). A
 * figure Phoenix did not send, or sent as zero, stays null.
 */
function positionRisksOf(view: Json): PhoenixPositionRisk[] {
  const subaccount = typeof view.traderSubaccountIndex === "number" && Number.isInteger(view.traderSubaccountIndex) ? view.traderSubaccountIndex : 0;
  const out: PhoenixPositionRisk[] = [];
  for (const position of Array.isArray(view.positions) ? view.positions : []) {
    if (!isObject(position) || typeof position.symbol !== "string" || position.symbol === "") continue;
    const liquidation = usdOf(position.liquidationPrice);
    const value = usdOf(position.positionValue);
    const held = usdOf(position.positionInitialMargin);
    const leverage = value !== null && held !== null && held > 0 && value !== 0 ? Math.abs(value) / held : null;
    out.push({
      symbol: position.symbol,
      subaccount,
      liquidationPriceUsd: liquidation !== null && liquidation > 0 && Number.isFinite(liquidation) ? liquidation : null,
      leverage: leverage !== null && Number.isFinite(leverage) ? leverage : null,
    });
  }
  return out;
}

export function marginFrom(raw: unknown): PhoenixMargin {
  const view = isObject(raw) ? raw : {};
  const tier = typeof view.riskTier === "string" && RISK_TIERS.has(view.riskTier) ? view.riskTier : null;
  return {
    collateralUsd: usdOf(view.collateralBalance),
    portfolioUsd: usdOf(view.portfolioValue),
    initialMarginUsd: usdOf(view.initialMargin),
    maintenanceMarginUsd: usdOf(view.maintenanceMargin),
    withdrawableMicro: microOf(view.withdrawableQuoteCollateral),
    riskTier: tier,
    canDeposit: capable(view, "depositCollateral"),
    canWithdraw: capable(view, "withdrawCollateral"),
    positions: positionRisksOf(view),
  };
}

/* -------------------------------------------------- what the chain moved */

type TokenBalance = Readonly<{ mint: string; owner?: string | undefined; uiTokenAmount: Readonly<{ amount: string }> }>;
export type BalanceRecord = Readonly<{ preTokenBalances?: readonly TokenBalance[] | null; postTokenBalances?: readonly TokenBalance[] | null }>;

/**
 * The owner's USDC as a landed transaction changed it, by the chain's record of token balances before and after:
 * micro-dollars with a sign (a deposit's is negative). An account the transaction opened has no «before» and counts
 * from zero. Null when the record has no balances, or none of the owner's USDC at all — then the chain did not say.
 */
export function usdcMovedOf(meta: BalanceRecord, owner: string): bigint | null {
  if (!Array.isArray(meta.preTokenBalances) || !Array.isArray(meta.postTokenBalances)) return null;
  const own = (entry: TokenBalance) => entry?.mint === USDC_MINT && entry.owner === owner;
  const before = meta.preTokenBalances.filter(own);
  const after = meta.postTokenBalances.filter(own);
  if (before.length === 0 && after.length === 0) return null;
  /* One balance the record does not state plainly, and the sum is not the chain's: say nothing rather than a guess. */
  if (![...before, ...after].every((entry) => /^\d{1,30}$/.test(entry.uiTokenAmount?.amount ?? ""))) return null;
  const sum = (entries: readonly TokenBalance[]) => entries.reduce((total, entry) => total + BigInt(entry.uiTokenAmount.amount), 0n);
  return sum(after) - sum(before);
}

/* ------------------------------------------------- what a build may call */

/** A built instruction in the kit's shape (the SDK's): roles 0 read, 1 write, 2 read+sign, 3 write+sign. */
export type KitInstruction = Readonly<{ programAddress: string; accounts?: readonly Readonly<{ address: string; role: number }>[]; data?: Uint8Array }>;

/** The kit's instruction as web3.js carries it; the bytes are the same. */
export function web3Instruction(instruction: KitInstruction): TransactionInstruction {
  return {
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({ pubkey: new PublicKey(account.address), isSigner: account.role >= 2, isWritable: account.role === 1 || account.role === 3 })),
    data: Buffer.from(instruction.data ?? new Uint8Array()),
  };
}

/** The 8-byte instruction tags the SDK 0.6.2 writes (`DepositFunds`, `WithdrawFunds`, `EmberDeposit`, `EmberWithdraw`). */
const TAG = {
  depositFunds: "ca2734d33514fa58",
  withdrawFunds: "f1241d6fd01f68d9",
  emberDeposit: "f223c68952e1f2b6",
  emberWithdraw: "b712469c946da122",
} as const;

const hex = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString("hex");
const u64le = (value: bigint) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return hex(buffer);
};

export type BuiltCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

/**
 * A built transaction before it is shown: paid for by the wallet, and nothing in it but the action — the wallet's own
 * token accounts opened on its own rent, Phoenix's and Ember's instructions for exactly the reviewed amount in which
 * the wallet is the one signer, an approval of exactly that amount to Ember from the wallet's own account, and a
 * compute budget the relay accepts. Anything else is not the action Review describes: refused, never shown.
 */
export function collateralCallsOnly(built: Transaction | TxView, request: CollateralRequest): BuiltCheck {
  const view = built instanceof Transaction ? legacyView(built) : built;
  const owner = request.owner;
  if (view.payer !== owner) return { ok: false, reason: "The built transaction is paid by someone other than the wallet." };
  const amount = u64le(request.amountMicro);
  const ownUsdc = ownAta(owner, USDC_MINT);
  const ownPhoenixUsd = ownAta(owner, PHOENIX_USD_MINT);
  /* Each step at most once: a second withdrawal hidden behind the first would move money Review never named. */
  const seen = new Map<string, number>();
  const mark = (step: string) => seen.set(step, (seen.get(step) ?? 0) + 1);
  for (const instruction of view.instructions) {
    const program = instruction.programId;
    const data = instruction.data;
    const keys = instruction.keys.map((key) => key.pubkey);
    const signers = instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey);
    if (signers.some((signer) => signer !== owner)) return { ok: false, reason: `An instruction of ${program} names a signer other than the wallet.` };
    if (program === COMPUTE_BUDGET) continue;
    if (program === ATA) {
      /* Create-idempotent of the wallet's own USDC or Phoenix dollar account, paid by the wallet. */
      const own = (keys[3] === USDC_MINT && keys[1] === ownUsdc) || (keys[3] === PHOENIX_USD_MINT && keys[1] === ownPhoenixUsd);
      if (!(data.length === 1 && data[0] === 1 && keys[0] === owner && keys[2] === owner && own)) return { ok: false, reason: "An account opening is not the wallet's own." };
      continue;
    }
    if (program === TOKEN) {
      /* Approve (4) of exactly the amount, from the wallet's Phoenix dollar account to Ember, by the wallet — a withdrawal only. */
      const approve = request.action === "withdraw" && data.length === 9 && data[0] === 4 && hex(data.subarray(1)) === amount && keys[0] === ownPhoenixUsd && keys[1] === EMBER_STATE && keys[2] === owner;
      if (!approve) return { ok: false, reason: "A token instruction is not the withdrawal's approval." };
      mark("approve");
      continue;
    }
    const tag = hex(data.subarray(0, 8));
    const tail = hex(data.subarray(8));
    if (program === EMBER_PROGRAM) {
      /* Both ways run between the wallet's own two accounts: its USDC and its Phoenix dollars (SDK 0.6.2 account order). */
      const own = keys[0] === owner && keys[1] === EMBER_STATE && keys[2] === USDC_MINT && keys[3] === PHOENIX_USD_MINT && keys[4] === ownUsdc && keys[5] === ownPhoenixUsd && keys[6] === EMBER_VAULT;
      if (!own) return { ok: false, reason: "An Ember instruction moves money between accounts that are not the wallet's own." };
      if (request.action === "deposit" && tag === TAG.emberDeposit && tail === amount) mark("ember");
      /* EmberWithdraw carries an option byte before the amount: Some(amount). */
      else if (request.action === "withdraw" && tag === TAG.emberWithdraw && tail === `01${amount}`) mark("ember");
      else return { ok: false, reason: "An Ember instruction is not the reviewed amount." };
      continue;
    }
    if (program === PHOENIX_PROGRAM) {
      /* The wallet signs for its own trader account; the dollars come from, or go to, its own Phoenix dollar account. */
      const trader = traderAccountOf(owner);
      const depositOwn = keys[3] === owner && keys[4] === ownPhoenixUsd && keys[5] === trader && keys[6] === PHOENIX_GLOBAL_VAULT;
      const withdrawOwn = keys[3] === owner && keys[4] === trader && keys[6] === PHOENIX_GLOBAL_VAULT && keys[7] === ownPhoenixUsd;
      if (request.action === "deposit" && tag === TAG.depositFunds && tail === amount && depositOwn) mark("phoenix");
      else if (request.action === "withdraw" && tag === TAG.withdrawFunds && tail === amount && withdrawOwn) mark("phoenix");
      else return { ok: false, reason: "A Phoenix instruction is not the reviewed amount." };
      continue;
    }
    return { ok: false, reason: `The built transaction has an instruction of ${program} outside the action.` };
  }
  const needed = request.action === "deposit" ? ["ember", "phoenix"] : ["approve", "ember", "phoenix"];
  if (!needed.every((step) => seen.get(step) === 1) || seen.size !== needed.length) return { ok: false, reason: "The built transaction is missing a step of the action, or repeats one." };
  return { ok: true };
}

/* ---------------------------------------------------------------- ticket */

/**
 * The seal between a Review and the relay, as the pools' (`lib/liquidity/studio/ticket.ts`): the wallet, the action,
 * the amount and the digest of what the transaction does, signed with the server's key under its own purpose — a
 * pool's ticket is not a collateral one. The wallet is the only signer, so a ticket carries no secret at all.
 */
export const TICKET_KEY_ENV = "BETA_TOKEN_SECRET";
const PURPOSE = "phoenix.collateral.v1";
export const TICKET_TTL_MS = BLOCKHASH_LIFE_MS;

export type CollateralTicket = Readonly<{ v: 1; owner: string; action: CollateralAction; amount: string; messages: readonly string[]; issuedAt: number; expiresAt: number }>;

function secretOf(env: Env): string | null {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export const ticketKeyConfigured = (env: Env): boolean => secretOf(env) !== null;

/**
 * What the transaction does — payer, blockhash, every instruction but a wallet's own — by the pools' digest, over the
 * transaction as its bytes carry it: a compiled message marks the wallet a signer wherever it appears, so a built
 * transaction and the same one read back from the wire digest alike only after the round trip.
 */
export function collateralDigest(built: Transaction | TxView): string {
  const view = built instanceof Transaction ? legacyView(built) : built;
  const hash = createHash("sha256");
  const field = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    hash.update(length).update(bytes);
  };
  field(view.payer ?? "");
  field(view.lifetime);
  for (const instruction of view.instructions) {
    if (instruction.programId === COMPUTE_BUDGET || instruction.programId === LIGHTHOUSE_PROGRAM) continue;
    field(instruction.programId);
    field(instruction.keys.map((key) => `${key.pubkey}:${key.isSigner ? 1 : 0}`).join(","));
    field(instruction.data);
  }
  return hash.digest("hex");
}

/** The most a v1 config may ask, whoever set it: the runtime's own ceilings and the relay's priority cap. */
const V1_MAX_UNITS = 1_400_000;
const V1_MAX_LOADED = 64 * 1024 * 1024;

/**
 * What a wallet may add to v1 bytes when it signs, the pools' rules in v1's shape: Lighthouse assertions only, a config
 * within the ceilings (a priority fee under the relay's cap), and no signer but the wallet.
 */
export function v1AdditionsAllowed(view: TxView, owner: string, signers: readonly string[]): boolean {
  if (signers.length !== 1 || signers[0] !== owner) return false;
  for (const instruction of view.instructions) {
    /* On v1 the budget lives in the config; a Compute Budget instruction there is not one the relay will carry. */
    if (instruction.programId === COMPUTE_BUDGET) return false;
    if (instruction.keys.some((key) => key.isSigner && key.pubkey !== owner)) return false;
    if (instruction.programId === LIGHTHOUSE_PROGRAM && (instruction.data.length === 0 || instruction.data[0]! < LIGHTHOUSE_FIRST_ASSERTION)) return false;
  }
  const config = view.config;
  if (!config) return false;
  if (config.computeUnitLimit !== null && config.computeUnitLimit > V1_MAX_UNITS) return false;
  if (config.loadedAccountsDataSizeLimit !== null && config.loadedAccountsDataSizeLimit > V1_MAX_LOADED) return false;
  if (config.priorityFeeLamports !== null && config.priorityFeeLamports > MAX_PRIORITY_LAMPORTS) return false;
  /* No program here asks for a bigger heap: a request for one is not this action's. */
  if (config.heapSize !== null) return false;
  return true;
}

export function issueTicket(input: Omit<CollateralTicket, "v" | "issuedAt" | "expiresAt">, env: Env, now = Date.now(), ttlMs = TICKET_TTL_MS): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const ticket: CollateralTicket = { v: 1, ...input, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type TicketRead = Readonly<{ ok: true; ticket: CollateralTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

export function readTicket(value: unknown, env: Env, now = Date.now()): TicketRead {
  const secret = secretOf(env);
  if (!secret || typeof value !== "string" || value.length > 4096) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<CollateralTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CollateralTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    typeof parsed.owner !== "string" ||
    !WALLET.test(parsed.owner) ||
    (parsed.action !== "deposit" && parsed.action !== "withdraw") ||
    typeof parsed.amount !== "string" ||
    !DIGITS.test(parsed.amount) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length !== 1 ||
    !parsed.messages.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as CollateralTicket };
}

export type SignedCheck = Readonly<{ ok: true; signature: string; wire: string }> | Readonly<{ ok: false; code: "SIGNED_MISMATCH" | "NOT_SIGNED" }>;

/**
 * The wallet's bytes against the ticket: the one legacy transaction, doing what its digest says, paid for by the
 * ticket's wallet, anything the wallet added within the pools' rules (a compute budget under the ceiling, a Lighthouse
 * assertion, no other signer) and every signature real over these bytes.
 */
export function checkSigned(ticket: Pick<CollateralTicket, "owner" | "messages">, signed: readonly unknown[]): SignedCheck {
  if (signed.length !== 1) return { ok: false, code: "SIGNED_MISMATCH" };
  const wire = signed[0];
  if (typeof wire !== "string" || wire.length > 8192) return { ok: false, code: "SIGNED_MISMATCH" };
  if (isV1Wire(Buffer.from(wire.slice(0, 4), "base64"))) return checkSignedV1(ticket, wire);
  let transaction: Transaction;
  let exact: VersionedTransaction;
  try {
    transaction = Transaction.from(Buffer.from(wire, "base64"));
    exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
  } catch {
    return { ok: false, code: "SIGNED_MISMATCH" };
  }
  if (exact.version !== "legacy" || transaction.feePayer?.toBase58() !== ticket.owner) return { ok: false, code: "SIGNED_MISMATCH" };
  if (collateralDigest(transaction) !== ticket.messages[0] || !walletAdditionsAllowed(transaction)) return { ok: false, code: "SIGNED_MISMATCH" };
  const message = exact.message.serialize();
  const required = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
  const allReal = required.length > 0 && required.every((signer, at) => {
    const signature = exact.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signer);
  });
  if (!allReal) return { ok: false, code: "NOT_SIGNED" };
  return { ok: true, signature: base58(exact.signatures[0]!), wire: Buffer.from(exact.serialize()).toString("base64") };
}

/** The v1 path of `checkSigned`: the same seal, v1's layout — the message bytes every signature covers, signatures at the tail. */
function checkSignedV1(ticket: Pick<CollateralTicket, "owner" | "messages">, wire: string): SignedCheck {
  let read: ReturnType<typeof readV1>;
  try {
    read = readV1(Buffer.from(wire, "base64"));
  } catch {
    return { ok: false, code: "SIGNED_MISMATCH" };
  }
  if (read.view.payer !== ticket.owner || collateralDigest(read.view) !== ticket.messages[0] || !v1AdditionsAllowed(read.view, ticket.owner, read.signers)) return { ok: false, code: "SIGNED_MISMATCH" };
  const allReal = read.signers.every((signer, at) => {
    const signature = read.signatures[at];
    return signature !== null && signature !== undefined && ed25519Valid(read.messageBytes, signature, new PublicKey(signer));
  });
  if (!allReal) return { ok: false, code: "NOT_SIGNED" };
  return { ok: true, signature: base58(read.signatures[0]!), wire };
}
