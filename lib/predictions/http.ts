/**
 * The prediction routes' shared HTTP surface (`RYN-PREDICTIONS-001`): the one
 * error shape (`{ error: { code, message, issues? } }`, the same shape the
 * v1 routes answer), the no-store headers, a bounded JSON body reader, and
 * the wallet behind a request — the same proof both clients carry
 * (`lib/api/v1/proof.ts`: the phone's bearer, the web's proof cookie).
 *
 * Server only.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";

import { requireWalletProof } from "../api/v1/proof.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { privateNoStoreHeaders } from "../http-control.ts";
import { getPredictionProvider } from "./agg/adapter.ts";
import { PREDICTION_FAILURE_STATUS, failure, failureBody, type PredictionFailure } from "./failure.ts";
import type { PredictionProvider } from "./provider.ts";

export function predictionJson<T>(body: T, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

export function predictionFailure(f: PredictionFailure): NextResponse {
  const headers: Record<string, string> = { ...privateNoStoreHeaders() };
  if (f.retryAfterSeconds) headers["retry-after"] = String(f.retryAfterSeconds);
  return NextResponse.json(failureBody(f), { status: PREDICTION_FAILURE_STATUS[f.code], headers });
}

export async function readPredictionBody<S extends z.ZodTypeAny>(request: Request, schema: S, limit = 16_384): Promise<Readonly<{ ok: true; body: z.infer<S> }> | Readonly<{ ok: false; response: NextResponse }>> {
  const text = await request.text().catch(() => "");
  if (text.length > limit) return { ok: false, response: predictionFailure(failure("VALIDATION_ERROR", "The request body is too large.")) };
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: predictionFailure(failure("VALIDATION_ERROR", "The request body is not JSON.")) };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      response: predictionFailure(failure("VALIDATION_ERROR", "The request does not match the contract.", { issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) })),
    };
  }
  return { ok: true, body: result.data };
}

export type PredictionActor = Readonly<{ wallet: string; carrier: "bearer" | "cookie"; store: GuardStore; provider: PredictionProvider }>;

/** The proven wallet behind a request, with the store and the provider a route needs. */
export async function requirePredictionActor(request: Request, intent: "read" | "mutation"): Promise<Readonly<{ ok: true; actor: PredictionActor }> | Readonly<{ ok: false; response: NextResponse }>> {
  const proof = await requireWalletProof(request, intent);
  if (!proof.ok) return { ok: false, response: proof.response };
  return { ok: true, actor: { wallet: proof.address, carrier: proof.carrier, store: getGuardRuntime().store, provider: getPredictionProvider() } };
}

/** The wallet behind a request when there is one; a public read answers for nobody. */
export async function optionalPredictionActor(request: Request): Promise<PredictionActor | null> {
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return null;
  return { wallet: proof.address, carrier: proof.carrier, store: getGuardRuntime().store, provider: getPredictionProvider() };
}
