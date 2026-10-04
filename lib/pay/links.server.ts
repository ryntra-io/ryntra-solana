/**
 * Payment links for the v1 routes (contract 1.22.0).
 *
 * The same engine the web's `/api/pay/requests` and `/pay/<id>` run — the
 * record, the owner row, the reference index and the observation of
 * `lib/pay` — behind the v1 routes a phone calls with its bearer. Each step is
 * the web route's own, in its order: the mint read for decimals, the
 * catalogue's symbol, three draws of a fresh id and reference, the recipient
 * always the proven wallet and never a field of the body. The deps are
 * injected so the tests run on a memory store with no network.
 *
 * Server only.
 */

import type { GuardStore } from "../guard/store.ts";
import { NATIVE_SOL_DECIMALS } from "../solana/send-kinds.ts";
import { projectPayLink, type PayLink } from "./link.ts";
import {
  assemblePaymentRequest,
  isPublicId,
  newPublicId,
  newReferenceKey,
  projectPublicPaymentRequest,
  type CreatePaymentRequestInput,
  type PaymentRequestOwner,
} from "./model.ts";
import { loadPublicPaymentRequest } from "./public.ts";
import { createPaymentRequest, listPaymentRequestsByWallet, readPaymentRequest, readPaymentSettlement } from "./store.ts";

/** How many links a list carries at most — the web's own bound. */
export const PAY_LINK_LIST_LIMIT = 50;

/** `unavailable`: the chain did not answer — a fault of the moment, not of the mint. */
export type MintFacts = Readonly<{ ok: true; decimals: number }> | Readonly<{ ok: false; reason: string; unavailable?: boolean }>;

/** The record's own bound on a symbol (`PaymentRequestRecordSchema`). */
const SYMBOL_MAX = 24;

export type PayLinkDeps = Readonly<{
  store: GuardStore;
  /** The mint's decimals from the chain. */
  readMint: (mint: string) => Promise<MintFacts>;
  /** The catalogue's symbol, or null when it does not know the mint. */
  symbolOf: (mint: string) => Promise<string | null>;
  now?: () => Date;
  newId?: () => string;
  newReference?: () => Promise<string>;
}>;

export type PayLinkCreateFailure = Readonly<{
  ok: false;
  code: "AMOUNT_INVALID" | "VALIDATION_ERROR" | "MINT_UNREADABLE" | "UNAVAILABLE";
  message: string;
}>;

export async function createPayLink(
  deps: PayLinkDeps,
  args: Readonly<{ wallet: string; sessionId: string | null; input: CreatePaymentRequestInput; origin: string }>,
): Promise<Readonly<{ ok: true; link: PayLink }> | PayLinkCreateFailure> {
  let decimals = NATIVE_SOL_DECIMALS;
  let symbol = "SOL";
  if (args.input.mint !== null) {
    const mint = args.input.mint;
    const read = await deps.readMint(mint);
    if (!read.ok) return { ok: false, code: read.unavailable ? "UNAVAILABLE" : "MINT_UNREADABLE", message: read.reason };
    decimals = read.decimals;
    const named = (await deps.symbolOf(mint).catch(() => null))?.trim() ?? "";
    /* A catalogue name longer than a link may carry is not cut into a word nobody wrote: the mint, abbreviated, stands in. */
    symbol = named !== "" && named.length <= SYMBOL_MAX ? named : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  }

  const now = (deps.now ?? (() => new Date()))();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = (deps.newId ?? newPublicId)();
    const reference = await (deps.newReference ?? newReferenceKey)();
    const assembled = assemblePaymentRequest({ id, reference, recipient: args.wallet, input: args.input, decimals, symbol, now });
    if (!assembled.ok) {
      return { ok: false, code: assembled.code === "AMOUNT_INVALID" ? "AMOUNT_INVALID" : "VALIDATION_ERROR", message: assembled.reason };
    }
    const owner: PaymentRequestOwner = {
      schema: "ryntra.pay.owner",
      schemaVersion: "1.0.0",
      id,
      network: "mainnet",
      wallet: args.wallet,
      accountId: null,
      proofSessionId: args.sessionId,
      createdAt: assembled.request.createdAt,
    };
    const created = await createPaymentRequest(deps.store, { request: assembled.request, owner });
    if (created.ok) {
      const projected = projectPublicPaymentRequest({ request: assembled.request, settlement: null, now });
      return { ok: true, link: projectPayLink(projected, args.origin) };
    }
    if (created.reason === "STORE_FAILED") return { ok: false, code: "UNAVAILABLE", message: "The payment link could not be recorded. Try again." };
    /* ID_TAKEN / REFERENCE_TAKEN: draw again. */
  }
  return { ok: false, code: "UNAVAILABLE", message: "The payment link could not be recorded. Try again." };
}

/**
 * The wallet's links, newest first, with the state the last observation left
 * — the web's list does not read the chain for every row, and neither does
 * this; one link's own read refreshes it.
 */
export async function listPayLinks(
  store: GuardStore,
  args: Readonly<{ wallet: string; origin: string; now?: Date }>,
): Promise<readonly PayLink[]> {
  const owners = await listPaymentRequestsByWallet(store, { network: "mainnet", wallet: args.wallet });
  const now = args.now ?? new Date();
  const links: PayLink[] = [];
  for (const owner of owners.slice(0, PAY_LINK_LIST_LIMIT)) {
    const record = await readPaymentRequest(store, owner.id);
    if (!record) continue;
    const settlement = await readPaymentSettlement(store, record.id);
    links.push(projectPayLink(projectPublicPaymentRequest({ request: record, settlement, now }), args.origin));
  }
  return links;
}

/**
 * One link, as its page reads it: the observation refreshed when the last
 * read is older than the page's freshness rule, paid for good once paid.
 * `observe: false` skips the chain (the tests).
 */
export async function readPayLink(
  store: GuardStore,
  args: Readonly<{ id: string; origin: string; observe?: boolean; now?: Date }>,
): Promise<PayLink | null> {
  if (!isPublicId(args.id)) return null;
  const view = await loadPublicPaymentRequest({ store, id: args.id, observe: args.observe, now: args.now });
  return view ? projectPayLink(view.request, args.origin) : null;
}
