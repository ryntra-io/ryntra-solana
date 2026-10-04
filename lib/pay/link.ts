/**
 * A payment link as the v1 contract serves it (contract 1.22.0) — the phone's
 * view of what the web's «Отримати» creates and `/pay/<id>` shows.
 *
 * It is the payer page's own projection (`projectPublicPaymentRequest`) plus
 * the two addresses a client shares — the link a person opens and the Solana
 * Pay request a wallet scans — and the credited amount already said in the
 * token's units, so a client counts nothing. Nothing about the creator's
 * account, session or the observation's internals is added.
 *
 * Pure: no clock, no network, no store.
 */

import { exactDecimal } from "../solana/amounts.ts";
import { buildSolanaPayUrl } from "../solana/payment-request.ts";
import type { PublicPaymentRequest } from "./model.ts";

export type PayLink = Readonly<{
  id: string;
  /** The page anyone with the link opens: `https://ryntra.io/pay/<id>`. */
  url: string;
  /** The Solana Pay transfer request with this link's reference — what a wallet's scanner reads. */
  payUrl: string;
  status: PublicPaymentRequest["status"];
  note: PublicPaymentRequest["note"];
  token: PublicPaymentRequest["token"];
  amount: PublicPaymentRequest["amount"];
  description: string | null;
  recipient: PublicPaymentRequest["recipient"];
  reference: string;
  createdAt: string;
  expiresAt: string;
  /** Set only when the link is paid: the settling signature, what arrived (raw and in the token's units) and when. */
  paid: Readonly<{ signature: string; creditedRaw: string; credited: string; paidAt: string | null }> | null;
}>;

/** The Solana Pay request for one projected link — the same URL `/pay/<id>` builds from the stored record. */
export function payUrlOf(request: PublicPaymentRequest): string {
  const built = buildSolanaPayUrl({
    recipient: request.recipient.address,
    amount: request.amount?.display ?? null,
    splToken: request.token.mint,
    decimals: request.token.decimals,
    reference: request.reference,
    message: request.description,
  });
  return built.ok ? built.url : `solana:${request.recipient.address}`;
}

export function projectPayLink(request: PublicPaymentRequest, origin: string): PayLink {
  return {
    id: request.id,
    url: `${origin}/pay/${request.id}`,
    payUrl: payUrlOf(request),
    status: request.status,
    note: request.note,
    token: request.token,
    amount: request.amount,
    description: request.description,
    recipient: request.recipient,
    reference: request.reference,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    paid: request.paid
      ? {
          signature: request.paid.signature,
          creditedRaw: request.paid.creditedRaw,
          credited: exactDecimal(request.paid.creditedRaw, request.token.decimals),
          paidAt: request.paid.paidAt,
        }
      : null,
  };
}

/**
 * The origin a shared link names — the host the request reached, as the web's
 * `/api/pay/requests` says it, so a link made on production reads
 * `https://ryntra.io/pay/<id>` and one made on a stand reads the stand.
 */
export function publicOriginOf(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? new URL(request.url).host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
