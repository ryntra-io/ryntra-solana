/**
 * What the wallet returned, read on the server (contract 1.22.0,
 * `POST /api/v1/money/send/returned`).
 *
 * The web's «Надіслати» card calls `checkReturnedBytes` on the bytes its
 * wallet signed and acts on the verdict: the exact bytes go to `settle`, bytes
 * where the wallet added only its fee and guard instructions go to `adopt`
 * first, anything else stops with nothing sent. This is the same call, so a
 * phone acts on the same verdict without decoding a transaction.
 *
 * Pure: no clock, no network, no store.
 */

import { checkReturnedBytes, type BytesCheckVerdict } from "./fingerprint.client.ts";
import type { TransferPlan } from "./transaction.ts";

export type ReturnedPlan = Readonly<{
  actionKind: TransferPlan["actionKind"];
  unsignedWireBase64: string;
  fingerprint: Readonly<{ messageHash: string; feePayer: string }>;
}>;

export type ReturnedAnswer = Readonly<{
  verdict: BytesCheckVerdict;
  next: "settle" | "adopt" | "stop";
  signature: string | null;
  detail: string;
}>;

const DETAIL_MAX = 1_024;

export async function readReturnedBytes(args: Readonly<{ plan: ReturnedPlan; signedWireBase64: string }>): Promise<ReturnedAnswer> {
  /* `checkReturnedBytes` reads exactly these four fields of the plan. */
  const plan = {
    actionKind: args.plan.actionKind,
    unsignedWireBase64: args.plan.unsignedWireBase64,
    fingerprint: { messageHash: args.plan.fingerprint.messageHash, feePayer: args.plan.fingerprint.feePayer },
  } as unknown as TransferPlan;
  const check = await checkReturnedBytes({ plan, signedWireBase64: args.signedWireBase64 });
  const next = check.verdict === "BYTES_MATCH" ? "settle" : check.verdict === "BYTES_FEE_ADDED" ? "adopt" : "stop";
  const detail = check.detail.trim() || check.verdict;
  return {
    verdict: check.verdict,
    next,
    signature: check.signature,
    detail: detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX - 1)}…` : detail,
  };
}
