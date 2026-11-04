/**
 * An intent as the v1 contract serves it (1.90.0): the frozen fields, where it stands, and the two ways to reach the
 * person — the link and a QR of it. The links are built from the deployment's public origin (`RYNTRA_PUBLIC_ORIGIN`,
 * `https://ryntra.io` when unset) and the intent's id, never from a request's Host header and never from anything the
 * creator sent: an intent cannot point anyone anywhere else. Only https — on the phone (Seeker) the same link opens the
 * Ryntra app through its verified App Link; no custom scheme, which any app on Android may claim.
 *
 * Who prepared it is the name its client chose: `verified` is false for every intent of phase 1, and the sheet says so.
 * Nothing about the claiming wallet is served while a claim is open beyond when it ends; the receipt — the wallet and
 * signature that ended it — only to the creator's key and to the wallet's own step.
 *
 * Pure.
 */

import type { IntentReceipt, IntentRecord, IntentStatus } from "./model.ts";

export type IntentLinks = Readonly<{
  /** The page a person opens — the city with the sheet ready, `https://ryntra.io/i/<id>`; on Seeker, the app. */
  url: string;
  /** An SVG QR code of `url`. */
  qr: string;
}>;

export type IntentView = Readonly<{
  id: string;
  status: IntentStatus;
  network: IntentRecord["body"]["network"];
  spec: IntentRecord["body"]["spec"];
  /** Who prepared it, as its client named itself; `verified` is false in phase 1. */
  origin: IntentRecord["body"]["origin"] & Readonly<{ verified: boolean }>;
  /** The one wallet that may confirm it; null when any may. */
  for: string | null;
  createdAt: string;
  expiresAt: string;
  /** SHA-256 of the frozen fields; every step names it. */
  digest: string;
  /** When the open claim ends; null without one. */
  claimedUntil: string | null;
  /** The signature the claim was marked with before its bytes could leave — only on the claiming wallet's own steps. */
  sentSignature: string | null;
  receipt: IntentReceipt | null;
  links: IntentLinks;
}>;

const DEFAULT_ORIGIN = "https://ryntra.io";

/** The deployment's public origin, or Ryntra's when the setting is missing or not a bare http(s) origin. */
export function publicIntentOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env.RYNTRA_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (!raw) return DEFAULT_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return DEFAULT_ORIGIN;
    // https only; plain http only for a stand on this machine.
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

export function intentLinks(id: string, origin: string): IntentLinks {
  return { url: `${origin}/i/${id}`, qr: `${origin}/api/v1/intents/${id}/qr` };
}

/**
 * `receipt`: whether this answer may carry it — the creator's read, or the claiming wallet's own step. `sent`: whether it
 * may carry the claim's mark — the claiming wallet's own steps only.
 */
export function projectIntent(record: IntentRecord, status: IntentStatus, origin: string, options: Readonly<{ receipt?: boolean; sent?: boolean }> = {}): IntentView {
  const { body } = record;
  return {
    id: body.id,
    status,
    network: body.network,
    spec: body.spec,
    origin: { kind: body.origin.kind, name: body.origin.name, verified: false },
    for: body.for,
    createdAt: body.createdAt,
    expiresAt: body.expiresAt,
    digest: record.digest,
    claimedUntil: status === "CLAIMED" && record.claim ? record.claim.until : null,
    sentSignature: options.sent && record.claim ? record.claim.signature : null,
    receipt: options.receipt ? record.receipt : null,
    links: intentLinks(body.id, origin),
  };
}
