/**
 * SOL-S1 — what one press of «Підтвердити в гаманці» does, decided once.
 *
 * «дуже швидко робиться обмін. Не з 5 разу.
 * Оце залог успіху». The card used to need several presses in ordinary use: a
 * Review read for longer than its bytes live (~30 s on 200 ms slots) waited
 * for those bytes to die, cancelled them up to four times, asked a new order
 * and then often showed the Review again for another press.
 *
 * Now:
 *
 * - while the Review is read, its bytes are renewed by themselves shortly
 *   before they fall short of a wallet's window (`renewAtMs`, at most
 *   `MAX_RENEWALS` times), and the Review on screen turns to the renewed
 *   figures — so a press usually finds young bytes;
 * - a press on bytes with enough life left opens the wallet on them at once
 *   (`WALLET_NOW`);
 * - otherwise fresh bytes are built at the press (`FRESH_BYTES`) — the server
 *   replaces the unsigned Review at once — and the wallet opens on them when
 *   they are no worse than what the person reviewed (`freshOrderWithinReview`:
 *   never a lower guaranteed minimum, never a higher fee, never a new warning);
 * - only a fresh order worse than the Review goes back to it, with its new
 *   figures, for one press.
 *
 * Client-safe and pure; `swap-press.test.mjs` holds every rule.
 */

import { MIN_WALLET_WINDOW_MS, signableWindowClosed } from "./blockhash-life.ts";
import type { ReviewedOrderTerms } from "./swap-client-safety.ts";

/** The Review's own refusals that only say time has passed — fresh bytes answer them. */
const TIME_ONLY_CODES: ReadonlySet<string> = new Set(["ORDER_EXPIRED", "ORDER_TOO_SHORT"]);

/** Network fee a fresh order may add over the reviewed one: 0.000005 SOL, or a quarter of it, whichever is more. */
export const NETWORK_FEE_SLACK_LAMPORTS = 5_000n;

/** How many times the bytes of one Review are renewed while it is read — two orders of the 12 a minute the action routes allow. */
export const MAX_RENEWALS = 2;

/** How long before the bytes fall short of a wallet's window the renewal is asked: an order's own time with room. */
export const RENEW_LEAD_MS = 3_000;

/** A press this soon after the figures on screen got worse is not taken as consent to them. */
export const WORSE_FIGURES_SETTLE_MS = 1_200;

export type PressRoute = "WALLET_NOW" | "FRESH_BYTES" | "REFUSE";

/**
 * Where a press goes. `readinessCode` is `assessSwapClientReview`'s code for
 * the Review on screen (`READY` when it is ready); a structural refusal —
 * the proof, the simulation, the effects, a later check — is never answered
 * by fresh bytes.
 */
export function pressRoute(args: Readonly<{
  readinessCode: string;
  ready: boolean;
  receivedAtMs: number;
  signableMs: number;
  nowMs?: number;
}>): PressRoute {
  if (!args.ready && !TIME_ONLY_CODES.has(args.readinessCode)) return "REFUSE";
  if (!args.ready) return "FRESH_BYTES";
  const nowMs = args.nowMs ?? Date.now();
  const left = args.receivedAtMs + args.signableMs - nowMs;
  return left >= MIN_WALLET_WINDOW_MS ? "WALLET_NOW" : "FRESH_BYTES";
}

/**
 * When the bytes of a Review being read are renewed: `RENEW_LEAD_MS` before
 * they fall short of a wallet's window. Null once `MAX_RENEWALS` are spent —
 * a press then builds fresh bytes itself.
 */
export function renewAtMs(args: Readonly<{ receivedAtMs: number; signableMs: number; renewals: number }>): number | null {
  if (args.renewals >= MAX_RENEWALS) return null;
  if (!Number.isFinite(args.receivedAtMs) || !Number.isFinite(args.signableMs)) return null;
  return args.receivedAtMs + Math.max(0, args.signableMs - MIN_WALLET_WINDOW_MS - RENEW_LEAD_MS);
}

/**
 * What a wallet's answer may do. A slow wallet — the person read the prompt,
 * the wallet raised it late — can hand back a signature over bytes whose
 * signable window has closed: they would reach the chain with too little life
 * to land, so they are never sent, and a fresh Review is the answer
 * (`FRESH_REVIEW`). Inside the window the signature goes to execute (`SEND`).
 */
export function walletAnswerRoute(args: Readonly<{ receivedAtMs: number; signableMs: number; answeredAtMs?: number }>): "SEND" | "FRESH_REVIEW" {
  return signableWindowClosed({ receivedAtMs: args.receivedAtMs, signableMs: args.signableMs, nowMs: args.answeredAtMs }) ? "FRESH_REVIEW" : "SEND";
}

export type ReviewedPressTerms = ReviewedOrderTerms;

function raw(value: string): bigint | null {
  return /^\d{1,40}$/.test(value) ? BigInt(value) : null;
}

/**
 * Fresh bytes are no worse than the Review the person read, so the wallet may
 * open on them in the same press.
 *
 * The same pair and amount; the guaranteed minimum received no lower; Ryntra's
 * and the route's fees in basis points no higher; the account reserve no
 * higher; the network fee no higher than the reviewed one plus a small slack
 * (`NETWORK_FEE_SLACK_LAMPORTS` — a priority fee moves with the cluster
 * between two orders, by a fraction of a cent); and no warning the Review did
 * not already carry. Anything else is shown as a fresh Review first.
 */
export function freshOrderWithinReview(
  reviewed: ReviewedPressTerms,
  fresh: ReviewedPressTerms,
  warnings: Readonly<{ reviewed: readonly string[]; fresh: readonly string[] }> = { reviewed: [], fresh: [] },
): boolean {
  if (fresh.inputMint !== reviewed.inputMint || fresh.outputMint !== reviewed.outputMint || fresh.inAmountRaw !== reviewed.inAmountRaw) return false;
  if (!(fresh.totalFeeBasisPoints <= reviewed.totalFeeBasisPoints)) return false;
  if (!(fresh.platformFee.basisPoints <= reviewed.platformFee.basisPoints)) return false;
  const values = [
    reviewed.minReceivedRaw, fresh.minReceivedRaw,
    reviewed.signatureFeeLamports, reviewed.priorityFeeLamports, reviewed.rentFeeLamports,
    fresh.signatureFeeLamports, fresh.priorityFeeLamports, fresh.rentFeeLamports,
  ].map(raw);
  if (values.some((value) => value === null)) return false;
  const [reviewedMin, freshMin, rSig, rPrio, rRent, fSig, fPrio, fRent] = values as bigint[];
  if (freshMin < reviewedMin) return false;
  if (fRent > rRent) return false;
  const reviewedNetwork = rSig + rPrio;
  const slack = reviewedNetwork / 4n > NETWORK_FEE_SLACK_LAMPORTS ? reviewedNetwork / 4n : NETWORK_FEE_SLACK_LAMPORTS;
  if (fSig + fPrio > reviewedNetwork + slack) return false;
  const known = new Set(warnings.reviewed);
  if (warnings.fresh.some((rule) => !known.has(rule))) return false;
  return true;
}

/* ------------------------------------------------------------ timeouts */

/**
 * How long the card waits on each route before it calls the answer missing.
 * The browser had no bound at all: a hung request held «Готуємо обмін…» until
 * the tab was closed. Each bound sits above the route's own normal time and
 * below its platform limit; the execute bound sits above the server's whole
 * landing wait (30 s) and its guard.
 */
export const SWAP_TIMEOUT_MS = {
  quote: 8_000,
  order: 15_000,
  execute: 50_000,
  recover: 20_000,
  cancel: 12_000,
} as const;

/**
 * One clear repeat. A request that timed out or never reached the server is
 * asked once more by itself — an estimate or an order only: neither moves
 * anything, and a second order replaces the first one's unsigned Review. An
 * execute is never repeated: its missing answer is recovered by reading the
 * signature.
 */
export function askOnceMore(code: string): boolean {
  return code === "TIMEOUT" || code === "NETWORK" || code === "HTTP_502" || code === "HTTP_503" || code === "HTTP_504";
}
