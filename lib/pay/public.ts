/**
 * Payment requests — the public read.
 *
 * One function the payer page and its status API both call, so a person who
 * opens the link and a page that polls it cannot disagree. It reads the
 * request, refreshes the settlement observation when the last read is stale,
 * and projects only what the owner task allows a payer to see.
 */

import QRCode from "qrcode";

import type { GuardStore } from "../guard/store.ts";
import { buildSolanaPayUrl } from "../solana/payment-request.ts";
import { createSolanaRpcHandle, type SolanaRpcHandle } from "../solana/rpc.ts";
import { isPublicId, projectPublicPaymentRequest, type PublicPaymentRequest } from "./model.ts";
import { refreshPaymentSettlement } from "./observe.ts";
import { readPaymentRequest, readPaymentSettlement } from "./store.ts";

export type PublicPaymentView = Readonly<{
  request: PublicPaymentRequest;
  /** The standard Solana Pay transfer request for a phone wallet's scanner. */
  payUrl: string;
}>;

export function paymentReadHandle(): SolanaRpcHandle {
  return createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000, retries: 1 });
}

/**
 * Load one request for a payer. `observe: false` skips the chain read (used by
 * the creator's listing, which must stay cheap); `force` ignores freshness.
 */
export async function loadPublicPaymentRequest(args: {
  store: GuardStore;
  id: string;
  observe?: boolean;
  force?: boolean;
  handle?: SolanaRpcHandle;
  now?: Date;
}): Promise<PublicPaymentView | null> {
  if (!isPublicId(args.id)) return null;
  const request = await readPaymentRequest(args.store, args.id);
  if (!request) return null;
  const now = args.now ?? new Date();
  const settlement =
    args.observe === false
      ? await readPaymentSettlement(args.store, request.id)
      : await refreshPaymentSettlement({
          store: args.store,
          handle: args.handle ?? paymentReadHandle(),
          request,
          now,
          force: args.force,
        });
  const projected = projectPublicPaymentRequest({ request, settlement, now });
  const pay = buildSolanaPayUrl({
    recipient: request.recipient,
    amount: request.amountDisplay,
    splToken: request.mint,
    decimals: request.decimals,
    reference: request.reference,
    message: request.description,
  });
  return { request: projected, payUrl: pay.ok ? pay.url : `solana:${request.recipient}` };
}

/** A QR as a data URI, rendered on the server so the page needs no script for it. */
export async function qrDataUrl(value: string, width = 512): Promise<string | null> {
  try {
    return await QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width });
  } catch {
    return null;
  }
}
