import type { PublicPaymentStatus, PublicPaymentRequest } from '../../../lib/pay/model.ts';
import type { PublicPaymentView } from '../../../lib/pay/public.ts';
import { displayAmount, parseHumanAmount } from '../../../lib/solana/amounts.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import { BASE_FEE_LAMPORTS, CLASSIC_MINTS, TOKEN_ACCOUNT_RENT_LAMPORTS } from '../../../lib/ticket/review-words.ts';
import { cleanAmount } from '../money/amount.ts';

/**
 * The payer's page in the city (CITY-156), the rules alone: what the window says for each state the engine reports, the
 * costs it shows before the wallet, and the one payment — built by the engine, signed by the person's wallet, sent once
 * by the engine. The engine is `lib/pay/**` behind `/api/pay/<id>`, `/api/pay/<id>/transaction` and
 * `/api/pay/<id>/submit`, exactly as it was: the same bodies, the same order, nothing decided here about money. No
 * React and no browser in this module, so the tests read it as it is.
 */

export type Request = PublicPaymentRequest;
export type View = PublicPaymentView;

/** What the window's status says. `pending` — a payment this page sent and the chain has not shown yet. */
export type Shown = 'awaiting' | 'pending' | 'paid' | 'expired' | 'checking';

export function shownStatus(status: PublicPaymentStatus, pending: boolean): Shown {
  if (status === 'PAID') return 'paid';
  if (status === 'EXPIRED') return 'expired';
  if (pending) return 'pending';
  if (status === 'AWAITING') return 'awaiting';
  return 'checking';
}

/** While a payment can still arrive the page asks the engine again; a paid or ended request is final. */
export function stillOpen(status: PublicPaymentStatus): boolean {
  return status !== 'PAID' && status !== 'EXPIRED';
}

/** How often the page reads the engine: sooner while its own payment is on the way. */
export const READ_EVERY_MS = 10_000;
export const READ_PENDING_MS = 5_000;

/** The figure of a raw amount, English-grouped (the city's `digits` says it the Ukrainian way). */
export function figure(raw: string, decimals: number): string {
  return displayAmount(raw, decimals);
}

/** The request's sum as the window heads it: «25 USDC», or null for a request that lets the payer choose. */
export function askedSum(request: Request): string | null {
  return request.amount ? `${request.amount.display} ${request.token.symbol}` : null;
}

/** Lamports as SOL, every digit kept, English-written: 5000 → «0.000005». */
export function sol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * What the payment costs, said before anything is built: the network's floor for one signature (the wallet shows the
 * exact sum, a priority fee on top), Ryntra's fee — none — and, for a coin, the account a first payment may open for the
 * recipient. Only USDC and USDT are known classic coins: their account costs exactly the classic rent and they carry no
 * fee of their own; for any other coin the rent is a floor and its own transfer fee may come off what arrives.
 */
export type Costs = Readonly<{
  networkSol: string;
  /** A coin, not SOL: the recipient may not hold an account for it yet. */
  opensAccount: boolean;
  /** USDC or USDT: the account's rent is exact, and the coin keeps no fee of its own. */
  classic: boolean;
  accountSol: string;
}>;

export function costsOf(token: Pick<Request['token'], 'mint'>): Costs {
  const opensAccount = token.mint !== null;
  return {
    networkSol: sol(BASE_FEE_LAMPORTS),
    opensAccount,
    classic: opensAccount && CLASSIC_MINTS.has(token.mint as string),
    accountSol: sol(TOKEN_ACCOUNT_RENT_LAMPORTS),
  };
}

/** The amount a payer typed into an open request, as the engine will read it. */
export type Typed = Readonly<{ ok: true; raw: string; text: string | null }> | Readonly<{ ok: false; why: 'empty' | 'invalid' }>;

export function typedAmount(request: Pick<Request, 'amount' | 'token'>, typed: string): Typed {
  if (request.amount) return { ok: true, raw: request.amount.raw, text: null };
  // The keyboard's way to the engine's: a comma is a point (the city's rule, `cleanAmount`).
  const plain = cleanAmount(typed);
  const text = plain.startsWith('.') ? `0${plain}` : plain.endsWith('.') ? plain.slice(0, -1) : plain;
  if (/^0*(\.0*)?$/.test(text)) return { ok: false, why: 'empty' };
  const parsed = parseHumanAmount(text, request.token.decimals);
  if (!parsed.ok) return { ok: false, why: 'invalid' };
  if (/^0+$/.test(parsed.raw)) return { ok: false, why: 'empty' };
  return { ok: true, raw: parsed.raw, text };
}

/**
 * The one line beside the status when what arrived is not what was asked (FIX-PAY-1, the engine's own counting): a
 * payment in another coin, less than asked — and when only the coin's own fee stands between, that it was the fee —
 * or more than asked. Null when nothing needs saying.
 */
export type Note =
  | Readonly<{ kind: 'wrongCoin' }>
  | Readonly<{ kind: 'short'; received: string; amount: string; fee: string | null }>
  | Readonly<{ kind: 'more'; received: string }>
  | Readonly<{ kind: 'total'; received: string }>;

export function noteOf(request: Request): Note | null {
  const units = (raw: string) => `${figure(raw, request.token.decimals)} ${request.token.symbol}`;
  const received = request.received;
  if (request.note === 'WRONG_TOKEN') return { kind: 'wrongCoin' };
  if (request.note === 'UNDERPAID' && received && request.amount) {
    const withheld = received.feeWithheldRaw;
    const byFee = withheld !== null && BigInt(received.raw) + BigInt(withheld) >= BigInt(request.amount.raw);
    return { kind: 'short', received: units(received.raw), amount: units(request.amount.raw), fee: byFee ? units(withheld) : null };
  }
  if (request.note === 'OVERPAID' && received) {
    // An open request asked for no sum: «more» there is a payment made more than once.
    return request.amount ? { kind: 'more', received: units(received.raw) } : { kind: 'total', received: units(received.raw) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The payment
 * ------------------------------------------------------------------ */

export type FetchLike = (
  url: string,
  init: Readonly<{ method: string; headers: Record<string, string>; body?: string; cache?: RequestCache }>,
) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

export type SignAnswer = Readonly<{ ok: true; signedWireBase64: string }> | Readonly<{ ok: false; reason: string }>;

export type PayPhase = 'preparing' | 'wallet' | 'sending';

export type PayDeps = Readonly<{
  fetch: FetchLike;
  /** The person's wallet, asked to sign these exact bytes. In tests, a stub. */
  sign: (unsignedWireBase64: string) => Promise<SignAnswer>;
  onPhase?: (phase: PayPhase) => void;
  now?: () => number;
}>;

/** Why a payment stopped, for the window's one line. Nothing was sent in any of them but `unclear`. */
export type Stop =
  | 'self'
  | 'refused'
  | 'wallet'
  | 'aged'
  | 'paid'
  | 'ended'
  | 'onItsWay'
  | 'needAmount'
  | 'badAmount'
  | 'network'
  | 'paused'
  | 'changed'
  | 'unclear'
  | 'failed';

export type PayOutcome =
  | Readonly<{ kind: 'sent'; signature: string; view: View | null }>
  | Readonly<{ kind: 'stopped'; stop: Stop }>;

type Built = Readonly<{ intentId: string; unsignedWireBase64: string; signableMs?: number }>;
type Refused = Readonly<{ ok: false; code: string | null }>;

const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' } as const;

/** The engine's refusal of a build, in the window's words. */
export function buildStop(code: string | null): Stop {
  switch (code) {
    case 'SELF_PAYMENT':
      return 'self';
    case 'ALREADY_PAID':
      return 'paid';
    case 'EXPIRED':
    case 'REQUEST_NOT_PAYABLE':
      return 'ended';
    case 'PAYMENT_PENDING':
      return 'onItsWay';
    case 'AMOUNT_REQUIRED':
      return 'needAmount';
    case 'AMOUNT_INVALID':
      return 'badAmount';
    case 'SIMULATION_FAILED':
      return 'network';
    case 'UNAVAILABLE':
      return 'paused';
    default:
      return 'failed';
  }
}

/** The wallet's own «no» is an answer, not a fault. */
export function signStop(reason: string): Stop {
  return /refus|reject|declin|cancel|denied/i.test(reason) ? 'refused' : 'wallet';
}

/** The engine's refusal of a submit: only a lost answer leaves the bytes possibly on their way. */
export function submitStop(code: string | null): Stop {
  switch (code) {
    case 'BYTES_MISMATCH':
    case 'BYTES_UNREADABLE':
    case 'SIGNATURE_MISSING':
      return 'changed';
    case 'INTENT_EXPIRED':
    case 'INTENT_UNKNOWN':
    case 'INTENT_MISMATCH':
      return 'aged';
    case 'UNAVAILABLE':
      return 'paused';
    default:
      return 'failed';
  }
}

async function body(response: Awaited<ReturnType<FetchLike>>): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorOf(payload: Record<string, unknown>): Readonly<{ code: string | null; signature: string | null }> {
  const error = payload.error as Record<string, unknown> | undefined;
  return {
    code: typeof error?.code === 'string' ? error.code : null,
    signature: typeof error?.signature === 'string' ? error.signature : null,
  };
}

/**
 * One payment, end to end, on the engine's own rules. The bytes are built only now, inside the press, and live about
 * thirty seconds: a wallet that answers after they aged is asked once more over freshly built bytes, never with dead
 * ones (`signFreshBytes`). What the wallet returned goes to the engine once; the engine compares it with what it built,
 * sends it, and records the payment as on its way before the bytes leave. A submit whose answer was lost is never
 * signed or sent again here: the page reads the request's status, and the engine refuses a second payment while one
 * is on its way.
 */
export async function payRequest(deps: PayDeps, args: Readonly<{ id: string; payer: string; amount: string | null }>): Promise<PayOutcome> {
  const route = `/api/pay/${encodeURIComponent(args.id)}`;
  const fresh = await signFreshBytes<Built, string, Refused>({
    build: async () => {
      deps.onPhase?.('preparing');
      try {
        const prepared = await deps.fetch(`${route}/transaction`, {
          method: 'POST',
          headers: { ...JSON_HEADERS },
          body: JSON.stringify({ payer: args.payer, amount: args.amount }),
          cache: 'no-store',
        });
        const payload = await body(prepared);
        const data = payload.data as Built | undefined;
        if (prepared.ok && data && typeof data.intentId === 'string' && typeof data.unsignedWireBase64 === 'string') return { ok: true, data };
        return { ok: false, code: errorOf(payload).code };
      } catch {
        return { ok: false, code: null };
      }
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      deps.onPhase?.('wallet');
      const answer = await deps.sign(built.unsignedWireBase64);
      return answer.ok ? { ok: true, value: answer.signedWireBase64 } : { ok: false, reason: answer.reason };
    },
    now: deps.now,
  });
  if (!fresh.ok) {
    if (fresh.stage === 'build') return { kind: 'stopped', stop: buildStop(fresh.failure.code) };
    if (fresh.stage === 'sign') return { kind: 'stopped', stop: signStop(fresh.reason) };
    return { kind: 'stopped', stop: 'aged' };
  }

  deps.onPhase?.('sending');
  let submitted: Awaited<ReturnType<FetchLike>>;
  try {
    submitted = await deps.fetch(`${route}/submit`, {
      method: 'POST',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ intentId: fresh.built.intentId, signedWireBase64: fresh.signed }),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'stopped', stop: 'unclear' };
  }
  const payload = await body(submitted);
  const data = payload.data as Readonly<{ signature?: unknown; view?: unknown }> | undefined;
  if (submitted.ok && data && typeof data.signature === 'string') {
    return { kind: 'sent', signature: data.signature, view: isView(data.view) ? data.view : null };
  }
  const refusal = errorOf(payload);
  // The same bytes already crossed the broadcast boundary: that payment is the one on its way.
  if (refusal.code === 'ALREADY_SUBMITTED' && refusal.signature) return { kind: 'sent', signature: refusal.signature, view: null };
  // An answer that never came (a gateway's timeout) may hide bytes that left: the status read settles it.
  if (!submitted.ok && submitted.status >= 500 && refusal.code === null) return { kind: 'stopped', stop: 'unclear' };
  return { kind: 'stopped', stop: submitStop(refusal.code) };
}

/** A public view as the engine hands it: enough of its shape to replace the one on screen. */
export function isView(value: unknown): value is View {
  if (!value || typeof value !== 'object') return false;
  const request = (value as Record<string, unknown>).request as Record<string, unknown> | undefined;
  return (
    typeof request?.id === 'string' &&
    typeof request.status === 'string' &&
    typeof (request.token as Record<string, unknown> | undefined)?.symbol === 'string' &&
    typeof (request.recipient as Record<string, unknown> | undefined)?.address === 'string' &&
    typeof request.expiresAt === 'string'
  );
}

/** The engine's current word on one request, through the same public read the page was drawn from. */
export async function readRequest(fetchImpl: FetchLike, id: string): Promise<View | 'gone' | null> {
  try {
    const response = await fetchImpl(`/api/pay/${encodeURIComponent(id)}`, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 404) return 'gone';
    if (!response.ok) return null;
    const payload = await body(response);
    return isView(payload.data) ? payload.data : null;
  } catch {
    return null;
  }
}
