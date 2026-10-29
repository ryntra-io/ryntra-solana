/**
 * Buying credits for USDC (AI-12, PLAN §9 and §10): a package → an order with
 * its own Solana Pay reference, paid to Ryntra's treasury on the payment page
 * the product already has (`/pay/<id>`, `lib/pay`) → the chain is read for that
 * reference → credits once → a receipt.
 *
 * - **What counts.** Only USDC (the mint of the order) that reached the
 *   treasury's own token account in a successful transaction carrying the
 *   order's reference — read by `lib/pay`'s observation, never a balance that
 *   «looks right». A payment in another token is recorded and not credited.
 * - **Once.** Each signature is claimed for one order, forever (a transaction
 *   carrying two orders' references pays one of them); the order advances by
 *   compare-and-set; the credits, the claims and the order are one atomic write.
 *   A second read, a second tab or a second instance adds nothing.
 * - **Under and over.** Less than the package: credits for what arrived at the
 *   base rate (1 000 for 1 USDC), no bonus — paying the rest later with the same
 *   reference completes the package. More: the package and the rest at the base
 *   rate. Money that arrived late, after the order's 15 minutes, still counts.
 * - **Nothing here moves money.** No signer, no transaction builder, no key:
 *   the person's own wallet pays on the payment page; this file only reads
 *   what the chain says and writes credits — the service's own units.
 */

import { isOffCurveAddress, type Address } from "@solana/kit";
import { z } from "zod";

import { withBoundedCasRetry, type GuardAtomicVersionedWrite, type GuardStore } from "../../guard/store.ts";
import { newPublicId, newReferenceKey, PaymentRequestRecordSchema, type PaymentRequestRecord } from "../../pay/model.ts";
import { createPaymentRequest, readPaymentRequest } from "../../pay/store.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../../solana/send-kinds.ts";
import { claimKey, claimTaken, CREDITS_COLLECTION, grantWithOrder, HOLDER, readBalance } from "./ledger.ts";

/* ------------------------------------------------------------ packages */

/** $2 → 2 000 · $5 → 5 250 · $10 → 11 000 · $25 → 28 750; credits never expire. */
export const CREDIT_PACKAGES = [
  { id: "usdc-2", usdc: 2, credits: 2_000, bonusPercent: 0 },
  { id: "usdc-5", usdc: 5, credits: 5_250, bonusPercent: 5 },
  { id: "usdc-10", usdc: 10, credits: 11_000, bonusPercent: 10 },
  { id: "usdc-25", usdc: 25, credits: 28_750, bonusPercent: 15 },
] as const;
export type CreditPackage = (typeof CREDIT_PACKAGES)[number];
export type CreditPackageId = CreditPackage["id"];
const PACKAGE_IDS = CREDIT_PACKAGES.map((entry) => entry.id) as [CreditPackageId, ...CreditPackageId[]];

export function packageOf(id: string): CreditPackage | null {
  return CREDIT_PACKAGES.find((entry) => entry.id === id) ?? null;
}

export const USDC_DECIMALS = 6;
const RAW_PER_USDC = 1_000_000n;
/** 1 credit = $0.001 = 1 000 base units of USDC. */
const RAW_PER_CREDIT = 1_000n;
/** One order never grants more than this; beyond it the operator settles by hand. */
export const ORDER_CREDITS_MAX = 100_000_000;

export const priceRawOf = (pkg: CreditPackage): bigint => BigInt(pkg.usdc) * RAW_PER_USDC;

/**
 * What an order is worth for the USDC that reached the treasury under its
 * reference. Never decreases as more arrives, so a later read only ever adds.
 */
export function creditsForPaid(pkg: CreditPackage, totalRaw: bigint): number {
  if (totalRaw <= 0n) return 0;
  const price = priceRawOf(pkg);
  const credits = totalRaw >= price ? BigInt(pkg.credits) + (totalRaw - price) / RAW_PER_CREDIT : totalRaw / RAW_PER_CREDIT;
  return credits > BigInt(ORDER_CREDITS_MAX) ? ORDER_CREDITS_MAX : Number(credits);
}

/* ------------------------------------------------------------ settings */

export const PURCHASE_ENV = {
  /** The treasury's public address (a wallet, never a token account): the operator's, not a creator's. Unset — nothing is sold. */
  treasury: "RYNTRA_ASSISTANT_TREASURY",
} as const;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const PUBLIC_ID = /^[1-9A-HJ-NP-Za-km-z]{14,20}$/;
const RAW = /^(0|[1-9][0-9]*)$/;

/**
 * The treasury as set, or null: a wallet on the curve — never a token account
 * or a program's address, which no wallet pays into as a person means it. It
 * is a dedicated address: a wallet that also takes Ryntra's swap fees would let
 * a fee someone owes anyway double as a purchase under their reference.
 */
export function treasuryFrom(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const value = env[PURCHASE_ENV.treasury]?.trim() ?? "";
  if (!BASE58.test(value)) return null;
  try {
    return isOffCurveAddress(value as Address) ? null : value;
  } catch {
    return null;
  }
}

/** How long an order invites a payment; a payment that lands later still counts. */
export const ORDER_TTL_MS = 15 * 60 * 1_000;
/** Orders one wallet may open in an hour. */
export const ORDERS_PER_HOUR = 6;
/** A read younger than this is reused rather than repeated. */
export const ORDER_FRESH_MS = 8_000;
/** Orders still read for a payment when the credits are opened: those of the last week, the least recently read first. */
export const SWEEP_DAYS = 7;
export const SWEEP_MAX = 2;
/** An order past its window with nothing in it is read again at most this often by the sweep. */
export const SWEEP_IDLE_MS = 10 * 60 * 1_000;
/** The order's screen keeps asking a little past the window: a payment signed at the last second still lands. */
export const ORDER_GRACE_MS = 5 * 60 * 1_000;
/** Payments one order keeps (the observation reads at most eight signatures per reference). */
const PAYMENTS_MAX = 16;

/* ------------------------------------------------------------ the order */

const Iso = z.string().datetime({ offset: true });
const PaymentSchema = z.object({ signature: z.string().regex(SIGNATURE), amountRaw: z.string().regex(RAW), payer: z.string().regex(BASE58).nullable(), at: Iso.nullable() }).strict();
const ForeignSchema = z.object({ signature: z.string().regex(SIGNATURE), mint: z.string().regex(BASE58).nullable(), amountRaw: z.string().regex(RAW) }).strict();

const OrderSchema = z
  .object({
    schema: z.literal("ryntra.assistant-credit-order"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    /** The payment request's public id: the order is that request's private side. */
    id: z.string().regex(PUBLIC_ID),
    /** Who receives the credits — the wallet's own holder, or its account's. */
    holder: z.string().regex(HOLDER),
    /** The proven wallet that opened the order; it alone reads it. */
    wallet: z.string().regex(BASE58),
    package: z.enum(PACKAGE_IDS),
    priceRaw: z.string().regex(RAW),
    packageCredits: z.number().int().min(1),
    treasury: z.string().regex(BASE58),
    mint: z.string().regex(BASE58),
    reference: z.string().regex(BASE58),
    createdAt: Iso,
    expiresAt: Iso,
    /** USDC payments counted for this order, each claimed for it alone. */
    payments: z.array(PaymentSchema).max(PAYMENTS_MAX),
    /** Payments in another token under this reference: seen, recorded, not credited. */
    foreign: z.array(ForeignSchema).max(PAYMENTS_MAX),
    /** Credits granted for this order so far. */
    credited: z.number().int().min(0),
    checkedAt: Iso.nullable(),
    observedAt: Iso.nullable(),
    failures: z.number().int().min(0).max(1_000),
  })
  .strict();
export type CreditOrder = z.output<typeof OrderSchema>;

const orderKey = (id: string): string => `order:${id}`;
const ordersOfPrefix = (wallet: string): string => `orders-of:${wallet}:`;
const ordersOfKey = (wallet: string, createdAt: string, id: string): string => `${ordersOfPrefix(wallet)}${createdAt}:${id}`;
/** One claim per signature, across every order: a transaction pays one order. */
export const paymentClaim = (signature: string): string => `pay-sig:${signature}`;

type IndexRow = Readonly<{ version: number; id: string; createdAt: string }>;

export async function readOrder(store: GuardStore, id: string): Promise<CreditOrder | null> {
  if (!PUBLIC_ID.test(id)) return null;
  const raw = await store.versioned<CreditOrder>(CREDITS_COLLECTION).get(orderKey(id));
  if (raw === undefined) return null;
  const parsed = OrderSchema.safeParse(raw);
  if (!parsed.success) throw new Error("The credit order does not parse.");
  return parsed.data;
}

async function indexOf(store: GuardStore, wallet: string): Promise<IndexRow[]> {
  const rows = (await store.collection<IndexRow>(CREDITS_COLLECTION).valuesWithPrefix(ordersOfPrefix(wallet))) as readonly IndexRow[];
  return rows
    .filter((row) => typeof row?.id === "string" && typeof row?.createdAt === "string")
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
}

/** The wallet's orders, newest first. */
export async function listOrders(store: GuardStore, wallet: string, limit = 10): Promise<CreditOrder[]> {
  const rows = await indexOf(store, wallet);
  /* Newest first from the index alone, so only the orders shown are read. */
  const ids = rows.slice(0, Math.max(0, limit)).map((row) => row.id);
  const orders = (await Promise.all(ids.map((id) => readOrder(store, id).catch(() => null)))).filter((order): order is CreditOrder => order !== null && order.wallet === wallet);
  return orders.sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
}

/* ------------------------------------------------------------ status */

export const ORDER_STATUSES = ["awaiting", "checking", "underpaid", "paid", "expired"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const receivedRaw = (order: Pick<CreditOrder, "payments">): bigint => order.payments.reduce((sum, payment) => sum + BigInt(payment.amountRaw), 0n);

export function orderStatus(order: CreditOrder, nowMs: number): OrderStatus {
  const received = receivedRaw(order);
  if (received >= BigInt(order.priceRaw)) return "paid";
  if (received > 0n) return "underpaid";
  const past = nowMs >= Date.parse(order.expiresAt);
  /* «Checking» only while something still asks again; past the window a failed read says what it is — nothing arrived yet. */
  if (order.failures > 0 && nowMs < Date.parse(order.expiresAt) + ORDER_GRACE_MS) return "checking";
  return past ? "expired" : "awaiting";
}

/* ------------------------------------------------------------ opening an order */

export type OpenOrderRefusal = "PURCHASE_CLOSED" | "PACKAGE_UNKNOWN" | "SELF_PAYMENT" | "ORDERS_LIMIT" | "UNAVAILABLE";
export type OpenOrderResult = Readonly<{ ok: true; order: CreditOrder }> | Readonly<{ ok: false; code: OpenOrderRefusal; reason: string }>;

function describe(pkg: CreditPackage, locale: "uk" | "en"): string {
  const credits = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US").format(pkg.credits).replace(/ | /g, " ");
  return locale === "uk" ? `Кредити Ryntra · ${credits}` : `Ryntra credits · ${credits}`;
}

/**
 * Open an order: a payment request to the treasury in `lib/pay` (its own
 * reference, 15 minutes, no wallet's listing shows it) and the order beside
 * it. The person is shown the request only once both are written.
 */
export async function openOrder(
  store: GuardStore,
  input: Readonly<{ wallet: string; holder: string; packageId: string; treasury: string | null; locale: "uk" | "en"; nowMs: number }>,
): Promise<OpenOrderResult> {
  if (!input.treasury) return { ok: false, code: "PURCHASE_CLOSED", reason: "Buying credits is not open on this deployment yet." };
  const pkg = packageOf(input.packageId);
  if (!pkg) return { ok: false, code: "PACKAGE_UNKNOWN", reason: "No package has that id." };
  if (!BASE58.test(input.wallet) || !HOLDER.test(input.holder)) return { ok: false, code: "UNAVAILABLE", reason: "Not a wallet." };
  if (input.wallet === input.treasury) return { ok: false, code: "SELF_PAYMENT", reason: "The treasury cannot buy credits from itself." };
  try {
    const hourAgo = new Date(input.nowMs - 60 * 60 * 1_000).toISOString();
    const lastHour = (await indexOf(store, input.wallet)).filter((row) => row.createdAt >= hourAgo).length;
    if (lastHour >= ORDERS_PER_HOUR) return { ok: false, code: "ORDERS_LIMIT", reason: `At most ${ORDERS_PER_HOUR} orders an hour; an open one can still be paid.` };
    const now = new Date(input.nowMs);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const request: PaymentRequestRecord = PaymentRequestRecordSchema.parse({
        schema: "ryntra.pay.request",
        schemaVersion: "1.0.0",
        id: newPublicId(),
        network: "mainnet",
        recipient: input.treasury,
        reference: await newReferenceKey(),
        mint: SOLANA_MAINNET_USDC_MINT,
        decimals: USDC_DECIMALS,
        symbol: "USDC",
        amountRaw: priceRawOf(pkg).toString(),
        amountDisplay: String(pkg.usdc),
        description: describe(pkg, input.locale),
        createdAt: now.toISOString(),
        expiresAt: new Date(input.nowMs + ORDER_TTL_MS).toISOString(),
      });
      const created = await createPaymentRequest(store, { request, owner: null });
      if (!created.ok) {
        if (created.reason === "STORE_FAILED") return { ok: false, code: "UNAVAILABLE", reason: "The order could not be written now; nothing was asked." };
        continue;
      }
      const order: CreditOrder = OrderSchema.parse({
        schema: "ryntra.assistant-credit-order",
        schemaVersion: "1.0.0",
        version: 1,
        id: request.id,
        holder: input.holder,
        wallet: input.wallet,
        package: pkg.id,
        priceRaw: request.amountRaw,
        packageCredits: pkg.credits,
        treasury: input.treasury,
        mint: SOLANA_MAINNET_USDC_MINT,
        reference: request.reference,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        payments: [],
        foreign: [],
        credited: 0,
        checkedAt: null,
        observedAt: null,
        failures: 0,
      });
      const indexRow: IndexRow = { version: 1, id: order.id, createdAt: order.createdAt };
      const written = await store.compareAndSetMany([
        { collection: CREDITS_COLLECTION, key: orderKey(order.id), expectedVersion: null, next: order },
        { collection: CREDITS_COLLECTION, key: ordersOfKey(order.wallet, order.createdAt, order.id), expectedVersion: null, next: indexRow },
      ]);
      if (written) return { ok: true, order };
    }
    return { ok: false, code: "UNAVAILABLE", reason: "The order could not be written now; nothing was asked." };
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The order could not be written now; nothing was asked." };
  }
}

/* ------------------------------------------------------------ reading the chain, crediting once */

/** One payment carrying the reference, reduced to what reached the treasury (`lib/pay/observe.ts` `readReferencePayments`). */
export type ReferencePayment = Readonly<{ signature: string; creditedRaw: string; mint: string | null; payer: string | null; blockTime: string | null }>;
export type ReferenceRead = Readonly<{ ok: true; payments: readonly ReferencePayment[] }> | Readonly<{ ok: false; reason: string }>;
export type ReadReference = (request: PaymentRequestRecord) => Promise<ReferenceRead>;

const versioned = (store: GuardStore) => store.versioned<CreditOrder>(CREDITS_COLLECTION);

async function noteFailedRead(store: GuardStore, id: string, nowMs: number): Promise<void> {
  try {
    await withBoundedCasRetry(async () => {
      const order = await readOrder(store, id);
      if (!order) return true;
      const next = { ...order, version: order.version + 1, checkedAt: new Date(nowMs).toISOString(), failures: Math.min(1_000, order.failures + 1) };
      return (await versioned(store).compareAndSet(orderKey(id), order.version, next)) ? true : false;
    }, 3);
  } catch {
    /* A failure that could not be noted is noted by the next read. */
  }
}

/**
 * Read the order's reference on chain and credit what arrived — once. Returns
 * the order as it stands after the read; `null` for no such order. A read that
 * failed (an RPC timeout) credits nothing and is counted; the next one tries.
 */
export async function settleOrder(store: GuardStore, id: string, deps: Readonly<{ read: ReadReference; nowMs: number; force?: boolean }>): Promise<CreditOrder | null> {
  const first = await readOrder(store, id);
  if (!first) return null;
  const nowMs = deps.nowMs;
  if (!deps.force && first.checkedAt && nowMs - Date.parse(first.checkedAt) < ORDER_FRESH_MS) return first;
  const request = await readPaymentRequest(store, id);
  if (!request || request.reference !== first.reference || request.recipient !== first.treasury || request.mint !== first.mint) return first;

  let read: ReferenceRead;
  try {
    read = await deps.read(request);
  } catch (failure) {
    read = { ok: false, reason: failure instanceof Error ? failure.message : String(failure) };
  }
  if (!read.ok) {
    await noteFailedRead(store, id, nowMs);
    return (await readOrder(store, id)) ?? first;
  }
  const seen = read.payments.filter((payment) => SIGNATURE.test(payment.signature) && RAW.test(payment.creditedRaw) && BigInt(payment.creditedRaw) > 0n);
  const nowIso = new Date(nowMs).toISOString();

  try {
    return await withBoundedCasRetry(async () => {
      const order = await readOrder(store, id);
      if (!order) return first;
      const known = new Set([...order.payments.map((entry) => entry.signature), ...order.foreign.map((entry) => entry.signature)]);
      const fresh = seen.filter((payment) => !known.has(payment.signature));
      const usdc: ReferencePayment[] = [];
      for (const payment of fresh.filter((entry) => entry.mint === order.mint)) {
        /* Claimed for another order already: that order was paid by it. */
        if (!(await claimTaken(store, paymentClaim(payment.signature)))) usdc.push(payment);
      }
      const foreign = fresh.filter((entry) => entry.mint !== order.mint);
      const payments = [...order.payments, ...usdc.map((payment) => ({ signature: payment.signature, amountRaw: payment.creditedRaw, payer: payment.payer !== null && BASE58.test(payment.payer) ? payment.payer : null, at: payment.blockTime }))].slice(0, PAYMENTS_MAX);
      const counted = usdc.filter((payment) => payments.some((entry) => entry.signature === payment.signature));
      const pkg = packageOf(order.package);
      const target = pkg ? creditsForPaid(pkg, receivedRaw({ payments })) : order.credited;
      const delta = Math.max(0, target - order.credited);
      const next: CreditOrder = OrderSchema.parse({
        ...order,
        version: order.version + 1,
        payments,
        foreign: [...order.foreign, ...foreign.map((payment) => ({ signature: payment.signature, mint: payment.mint, amountRaw: payment.creditedRaw }))].slice(0, PAYMENTS_MAX),
        credited: order.credited + delta,
        checkedAt: nowIso,
        observedAt: nowIso,
        failures: 0,
      });
      const writes: GuardAtomicVersionedWrite[] = [
        { collection: CREDITS_COLLECTION, key: orderKey(order.id), expectedVersion: order.version, next },
        ...counted.map((payment) => ({ collection: CREDITS_COLLECTION, key: claimKey(paymentClaim(payment.signature)), expectedVersion: null, next: { version: 1, order: order.id, at: nowIso } })),
      ];
      if (delta === 0) return (await store.compareAndSetMany(writes)) ? next : false;
      /* A wallet linked to an account since the order was opened: the credits go where its credits are now. */
      const holder = (await readBalance(store, order.holder))?.mergedInto ?? order.holder;
      const granted = await grantWithOrder(store, holder, { credits: delta, idem: `buy:${order.id}:v${order.version}`, extra: writes, nowMs });
      return granted === "written" ? next : false;
    }, 8);
  } catch {
    /* Contended past the budget or the store did not answer: nothing was half-written; the next read settles it. */
    return (await readOrder(store, id).catch(() => null)) ?? first;
  }
}

/**
 * When the credits are opened: the wallet's orders of the last week that may
 * still be paid — not yet paid in full, or paid but still inside their window
 * (a second payment) — read on chain a few at a time, the least recently read
 * first, so every one of them comes round however many are open. An order
 * past its window with nothing in it is read at most every ten minutes.
 */
export async function sweepOrders(store: GuardStore, wallet: string, deps: Readonly<{ read: ReadReference; nowMs: number }>): Promise<CreditOrder[]> {
  const since = new Date(deps.nowMs - SWEEP_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const orders = await listOrders(store, wallet, 50);
  const lastRead = (order: CreditOrder): number => (order.checkedAt ? Date.parse(order.checkedAt) : 0);
  const due = orders
    .filter((order) => {
      if (order.createdAt < since) return false;
      const status = orderStatus(order, deps.nowMs);
      const inWindow = deps.nowMs < Date.parse(order.expiresAt) + ORDER_GRACE_MS;
      if (status === "paid") return inWindow;
      if (inWindow || status === "underpaid") return true;
      return deps.nowMs - lastRead(order) >= SWEEP_IDLE_MS;
    })
    .sort((left, right) => lastRead(left) - lastRead(right));
  await Promise.all(due.slice(0, SWEEP_MAX).map((order) => settleOrder(store, order.id, deps).catch(() => null)));
  return listOrders(store, wallet, 10);
}
