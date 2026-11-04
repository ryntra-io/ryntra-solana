import { ask, V1, type FetchLike } from '../money/engine.ts';
import { readIntent, type Intent } from './check.ts';

/**
 * The city's line to the intents of the engine (CITY-161, contract 1.90.0): read one, and the person's steps — claim
 * when they press, the mark (the wallet's signed bytes, before the swap engine may send them), release when the wallet
 * said no before anything was signed, receipt once the transaction went out. Every step names the digest the sheet was
 * shown; the routes refuse any other.
 */

export type IntentAnswer = Readonly<{ ok: true; intent: Intent }> | Readonly<{ ok: false; code: string; message: string; status: number }>;

async function answerOf(id: string, call: Promise<Awaited<ReturnType<typeof ask<unknown>>>>): Promise<IntentAnswer> {
  const answer = await call;
  if (!answer.ok) return { ok: false, code: answer.failure.code, message: answer.failure.message, status: answer.failure.status };
  const intent = readIntent(answer.value, id);
  return intent ? { ok: true, intent } : { ok: false, code: 'UNREADABLE', message: 'The answer was not an intent.', status: answer.status };
}

const path = (id: string, step = '') => `/api/v1/intents/${encodeURIComponent(id)}${step}`;

export function readOne(fetchImpl: FetchLike, id: string): Promise<IntentAnswer> {
  return answerOf(id, ask<unknown>(fetchImpl, path(id), { headers: V1 }));
}

export function claim(fetchImpl: FetchLike, id: string, body: Readonly<{ digest: string; wallet: string }>): Promise<IntentAnswer> {
  return answerOf(id, ask<unknown>(fetchImpl, path(id, '/claim'), { body, headers: V1 }));
}

/** The wallet's signed bytes mark the claim before they may leave; nothing is sent by this call. */
export function mark(fetchImpl: FetchLike, id: string, body: Readonly<{ digest: string; wallet: string; signedWireBase64: string; replaces: string | null }>): Promise<IntentAnswer> {
  return answerOf(id, ask<unknown>(fetchImpl, path(id, '/signed'), { body, headers: V1 }));
}

export function release(fetchImpl: FetchLike, id: string, body: Readonly<{ digest: string; wallet: string }>): Promise<IntentAnswer> {
  return answerOf(id, ask<unknown>(fetchImpl, path(id, '/release'), { body, headers: V1 }));
}

/** Codes a receipt is sent again for: the chain has not shown the transaction yet, or the server could not be asked. */
const AGAIN = new Set(['INTENT_RECEIPT_UNSEEN', 'UNAVAILABLE', 'TIMEOUT', 'NETWORK', 'RATE_LIMITED', 'HTTP_502', 'HTTP_503', 'HTTP_504']);

/** The receipt, sent again a few times while the chain catches up; the money already moved, so this only records it. */
export async function receipt(
  fetchImpl: FetchLike,
  id: string,
  body: Readonly<{ digest: string; wallet: string; signature: string }>,
  wait: (ms: number) => Promise<void>,
  tries = 6,
): Promise<IntentAnswer> {
  let last: IntentAnswer = { ok: false, code: 'NOT_SENT', message: 'The receipt was not sent.', status: 0 };
  for (let attempt = 0; attempt < tries; attempt += 1) {
    last = await answerOf(id, ask<unknown>(fetchImpl, path(id, '/receipt'), { body, headers: V1 }));
    if (last.ok || !AGAIN.has(last.code)) return last;
    await wait(2_000 + attempt * 1_000);
  }
  return last;
}
