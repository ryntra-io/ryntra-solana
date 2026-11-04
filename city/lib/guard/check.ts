/**
 * The Guard window's line to the engine: `POST /api/v1/ward/check`, on the same origin, unchanged. The city asks and
 * shows; every word of the verdict is the engine's.
 */

import type { WardCheckResponse, WardReason } from '@/lib/api/v1/contract';
import { ask, V1, type EngineAnswer, type FetchLike } from '../money/engine.ts';

export type { WardCheckResponse, WardReason };

/** How long a check may take: a simulation, the accounts around it and the recipients' reads. */
export const CHECK_TIMEOUT_MS = 30_000;

/** Base64 long enough to be a transaction; anything else is read as a link or an address. */
const TRANSACTION = /^[A-Za-z0-9+/\s]{80,}={0,2}$/;

export type GuardInput = Readonly<{ kind: 'transaction' | 'link'; value: string }>;

/** What was pasted, as the engine takes it — whitespace inside base64 is a line break of the copy, not the bytes. */
export function readInput(text: string): GuardInput | null {
  const value = text.trim();
  if (value.length === 0) return null;
  if (TRANSACTION.test(value)) return { kind: 'transaction', value: value.replace(/\s+/g, '') };
  return { kind: 'link', value };
}

export type GuardAsk = Readonly<{ input: GuardInput; intentText?: string; signer?: string | null }>;

export function checkBody(request: GuardAsk): Record<string, unknown> {
  const intent = request.intentText?.trim();
  return {
    [request.input.kind]: request.input.value,
    ...(intent ? { intentText: intent } : {}),
    /* A link is paid by the wallet on screen; a transaction is judged as its own fee payer. */
    ...(request.input.kind === 'link' && request.signer ? { signer: request.signer } : {}),
  };
}

export function askCheck(fetchImpl: FetchLike, request: GuardAsk, signal?: AbortSignal): Promise<EngineAnswer<WardCheckResponse>> {
  return ask<WardCheckResponse>(fetchImpl, '/api/v1/ward/check', { method: 'POST', body: checkBody(request), headers: V1, timeoutMs: CHECK_TIMEOUT_MS, signal });
}

/** The reasons a person reads under the verdict: the heavy ones; information waits in the details. */
export function headline(result: WardCheckResponse): readonly WardReason[] {
  return result.reasons.filter((reason) => reason.level === 'block' || reason.level === 'warn' || reason.level === 'unknown');
}
