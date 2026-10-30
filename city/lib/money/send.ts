import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SPL_TRANSFER_ACTION_REF,
  type NativeSolTransferInput,
  type SplTransferInput,
} from '../../../lib/agent-control/adapters/solana-token-2022.ts';
import { displayAmount } from '../../../lib/solana/amounts.ts';
import { checkEnvironmentLock, type SolanaEnvironmentContext } from '../../../lib/solana/environment.ts';
import type { BytesCheck } from '../../../lib/solana/fingerprint.client.ts';
import { decideResume, type PendingSend } from '../../../lib/solana/send-pending.client.ts';
import { assessSendReadiness } from '../../../lib/solana/send-readiness.ts';
import { canSubmitSendAction } from '../../../lib/solana/send-safety.ts';
import type { SendCheck } from '../../../lib/solana/send-check.ts';
import type { SkrResolve } from '../../../lib/solana/skr.client.ts';
import type { TransferPlan } from '../../../lib/solana/transaction.ts';
import { nothingMoved, sendFailureCopy, sendOutcomeCopy, walletFailureCopy } from '../../../app/solana/workspace/send/send-copy.ts';
import { wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { ask, TIMEOUT_MS, type EngineFailure, type FetchLike } from './engine.ts';
import { sayer } from './say.ts';
import { SEND_COPY_WORDS, SEND_WORDS } from './words.ts';

/**
 * One transfer from the Send tab, end to end, on the engine's own rules — the same steps Ryntra's web «Send» takes,
 * against the same routes: the engine builds the exact transfer and its Review (fee, what arrives, what opens, whether
 * the wallet may open at all); the person signs those bytes in their own wallet; what the wallet returned is checked
 * against what was reviewed; the signed bytes go to the engine once, and the engine reads the chain back and issues
 * the receipt. A signature this tab learned is kept before the bytes leave, so a reload can still read it back; an
 * unclear answer is only ever read back by that signature, never signed or sent again. Nothing here holds a key,
 * prices anything or decides whether a transfer is allowed.
 */

export const NETWORK = 'mainnet' as const;

/** The shared transfer copy, said in the city's language (English as written). */
const SAY = sayer(SEND_COPY_WORDS);

export type SendAsset = Readonly<{ native: boolean; mint: string | null; decimals: number; symbol: string }>;

export type SendIntent = Readonly<{
  /** The wallet's name, for the signature. */
  wallet: string;
  sender: string;
  asset: SendAsset;
  /** The address the money goes to — for a `.skr` name, where it pointed when last read. */
  recipient: string;
  amountRaw: string;
  /** The `.skr` name typed, read again before the Review, before the wallet and before the bytes leave. */
  name: string | null;
}>;

/** The plan route's answer: the bundle the engine signed over, and its Review counted (`check`). */
export type SendBundle = Readonly<{
  plan: TransferPlan;
  preflight: unknown;
  verdict: Readonly<{ verdict: string }> & Record<string, unknown>;
  provider: Readonly<{ role: 'primary' | 'fallback'; host: string }>;
  support: Readonly<{ decision: string; findings: readonly unknown[] }>;
  safety: Readonly<{ decision: string; findings: readonly unknown[] }>;
  canaryIntent: unknown;
  canaryVerdict: unknown;
  reviewProof: Readonly<{ status: 'SIGNED' | 'UNSIGNED'; reasonCode?: string }>;
  check: SendCheck;
}>;

export type SignResult = Readonly<{ ok: true; signedWireBase64: string }> | Readonly<{ ok: false; reason: string }>;

export type SendDeps = Readonly<{
  fetch: FetchLike;
  /** The person's wallet, asked to sign these exact bytes. In tests, a stub. */
  sign: (unsignedWireBase64: string) => Promise<SignResult>;
  /** The engine's own comparison of what came back with what was reviewed (`lib/solana/fingerprint.client.ts`). */
  checkReturned: (plan: TransferPlan, signedWireBase64: string) => Promise<Pick<BytesCheck, 'verdict' | 'signature'>>;
  resolveName: (name: string) => Promise<SkrResolve>;
  /** The record of a signature whose outcome this tab has not seen yet. */
  pending: Readonly<{ remember: (pending: PendingSend) => void; forget: (wallet: string) => void }>;
  keepReceipt: (wallet: string, receipt: unknown) => void;
  rememberRecipient: (wallet: string, recipient: string) => void;
  now: () => number;
  onPhase?: (phase: SendPhase) => void;
}>;

export type SendPhase = 'reviewing' | 'preparing' | 'wallet' | 'sending';

/** The engine's transfer input for the intent: SOL and tokens are two actions. */
export function transferInput(intent: Pick<SendIntent, 'sender' | 'asset' | 'recipient' | 'amountRaw'>): NativeSolTransferInput | SplTransferInput {
  if (intent.asset.native) {
    return { schemaVersion: '1.0.0', actionRef: NATIVE_SOL_TRANSFER_ACTION_REF, network: NETWORK, sender: intent.sender, recipient: intent.recipient, amountRaw: intent.amountRaw };
  }
  return {
    schemaVersion: '1.0.0',
    actionRef: SPL_TRANSFER_ACTION_REF,
    network: NETWORK,
    mint: intent.asset.mint as string,
    sender: intent.sender,
    recipient: intent.recipient,
    amountRaw: intent.amountRaw,
  };
}

/** The world a Review was authorized over; the wallet opens only while the fresh one is the same world. */
export function environmentOf(bundle: SendBundle, symbol: string): SolanaEnvironmentContext {
  return {
    network: NETWORK,
    wallet: bundle.plan.sender,
    provider: `${bundle.provider.role} · ${bundle.provider.host}`,
    amount: { raw: bundle.plan.amountRaw, display: `${displayAmount(bundle.plan.amountRaw, bundle.plan.decimals)} ${symbol}` },
    mint: bundle.plan.mint ?? null,
    bound: { recipient: bundle.plan.recipient },
  };
}

/** Whether the wallet may open for this exact Review: the engine's own verdict, and the client gates the web keeps too. */
export function signable(bundle: SendBundle): boolean {
  if (bundle.check?.signable !== true) return false;
  const open = canSubmitSendAction({ network: NETWORK, safety: bundle.safety as never });
  if (!open) return false;
  return assessSendReadiness({
    plan: bundle.plan,
    preflight: bundle.preflight as never,
    verdict: bundle.verdict as never,
    support: bundle.support as never,
    reviewProof: bundle.reviewProof,
    requireReviewProof: true,
  }).ready;
}

/** Why a Review cannot be signed, in the engine's own words, in the city's language when the engine gave it. */
export function blockedLine(bundle: SendBundle): string {
  const stop = bundle.check?.warnings?.find((warning) => warning.stops);
  const lang = langNow();
  const blocked = bundle.check?.blocked;
  return (blocked ? (blocked[lang] ?? blocked.en) : undefined) ?? (stop ? (stop[lang] ?? stop.en) : undefined) ?? wordsNow(SEND_WORDS).cannotBeSent;
}

export function isBundle(value: unknown): value is SendBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Record<string, unknown>;
  const plan = bundle.plan as Record<string, unknown> | undefined;
  const check = bundle.check as Record<string, unknown> | undefined;
  return (
    typeof plan?.unsignedWireBase64 === 'string' &&
    typeof plan.amountRaw === 'string' &&
    typeof plan.recipient === 'string' &&
    typeof plan.sender === 'string' &&
    typeof (plan.fingerprint as Record<string, unknown> | undefined)?.messageHash === 'string' &&
    typeof check?.signable === 'boolean' &&
    typeof (check.send as Record<string, unknown> | undefined)?.amount === 'string' &&
    !!bundle.safety &&
    !!bundle.reviewProof
  );
}

export type Refusal = Readonly<{ code: string; message: string }>;

export function refusalOf(failure: Pick<EngineFailure, 'code'>): Refusal {
  return { code: failure.code, message: sendFailureCopy(failure.code, SAY) };
}

const NAME_MOVED: Readonly<Record<string, string>> = { SKR_CHANGED: 'SKR_CHANGED', NOT_FOUND: 'SKR_GONE', UNAVAILABLE: 'SKR_UNREAD' };

/** A `.skr` name read again — never taken from the copy on screen. Null while it still points where the money goes. */
async function nameMoved(deps: SendDeps, name: string | null, expected: string): Promise<Refusal | null> {
  if (!name) return null;
  const again = await deps.resolveName(name).catch(() => ({ state: 'UNAVAILABLE' as const, name }));
  if (again.state === 'FOUND' && again.address === expected) return null;
  const code = again.state === 'FOUND' ? 'SKR_CHANGED' : NAME_MOVED[again.state];
  return { code, message: sendFailureCopy(code, SAY) };
}

async function plan(deps: SendDeps, intent: SendIntent): Promise<Readonly<{ ok: true; bundle: SendBundle }> | Readonly<{ ok: false; refusal: Refusal }>> {
  const answer = await ask<unknown>(deps.fetch, '/api/solana/transfer/plan', { body: { input: transferInput(intent) }, timeoutMs: TIMEOUT_MS.plan });
  if (!answer.ok) return { ok: false, refusal: refusalOf(answer.failure) };
  if (!isBundle(answer.value)) return { ok: false, refusal: { code: 'BUILD_UNREADABLE', message: sendFailureCopy(null, SAY) } };
  return { ok: true, bundle: answer.value };
}

export type ReviewOutcome =
  | Readonly<{ kind: 'review'; bundle: SendBundle; authorized: SolanaEnvironmentContext }>
  | Readonly<{ kind: 'refused'; refusal: Refusal }>;

/** The engine's Review of the intent: the exact transfer, its fee and what arrives — nothing is signed yet. */
export async function reviewSend(deps: SendDeps, intent: SendIntent): Promise<ReviewOutcome> {
  deps.onPhase?.('reviewing');
  const moved = await nameMoved(deps, intent.name, intent.recipient);
  if (moved) return { kind: 'refused', refusal: moved.code === 'SKR_UNREAD' ? { code: 'SKR_UNCHECKED', message: sendFailureCopy('SKR_UNCHECKED', SAY) } : moved };
  const built = await plan(deps, intent);
  if (!built.ok) return { kind: 'refused', refusal: built.refusal };
  return { kind: 'review', bundle: built.bundle, authorized: environmentOf(built.bundle, intent.asset.symbol) };
}

/** What the engine settled: the chain read back, or a state that says what is still open. */
export type Settled = Readonly<{ state: string; signature: string; observed: boolean; receipt: unknown | null }>;

export type ConfirmOutcome =
  /** The engine sent it once and read the chain: `observed` is the money moving; otherwise `settled.state` says why not. */
  | Readonly<{ kind: 'settled'; settled: Settled; line: string | null }>
  /** Signed, maybe on its way, no answer yet: read back by signature, never sent again. */
  | Readonly<{ kind: 'unresolved'; signature: string; line: string }>
  /** Nothing was signed or nothing was sent. */
  | Readonly<{ kind: 'refused'; refusal: Refusal }>
  /** The wallet said no. */
  | Readonly<{ kind: 'cancelled'; line: string }>
  /** The world moved since the Review: a fresh one to read before the wallet opens. */
  | Readonly<{ kind: 'review'; bundle: SendBundle; authorized: SolanaEnvironmentContext; line: string }>;

const SETTLE_FIELDS = ['plan', 'preflight', 'verdict', 'provider', 'canaryIntent', 'canaryVerdict', 'reviewProof'] as const;

function bundleBody(bundle: SendBundle, signedWireBase64: string): Record<string, unknown> {
  const body: Record<string, unknown> = { signedWireBase64 };
  for (const field of SETTLE_FIELDS) body[field] = bundle[field];
  return body;
}

/**
 * The one tap after the Review. The exact transfer is built again at this moment — a Review's bytes live about a
 * minute — and the wallet opens only if it is still the world the person authorized and the engine still lets it
 * open.
 */
export async function confirmSend(deps: SendDeps, intent: SendIntent, authorized: SolanaEnvironmentContext): Promise<ConfirmOutcome> {
  deps.onPhase?.('preparing');
  const before = await nameMoved(deps, intent.name, intent.recipient);
  if (before) return { kind: 'refused', refusal: before };

  const built = await plan(deps, intent);
  if (!built.ok) return { kind: 'refused', refusal: built.refusal };
  const fresh = built.bundle;
  const current = environmentOf(fresh, intent.asset.symbol);
  if (checkEnvironmentLock({ authorized, current }).verdict !== 'LOCKED') {
    return { kind: 'review', bundle: fresh, authorized: current, line: wordsNow(SEND_WORDS).changed };
  }
  if (!signable(fresh)) return { kind: 'review', bundle: fresh, authorized: current, line: blockedLine(fresh) };

  deps.onPhase?.('wallet');
  const signed = await deps.sign(fresh.plan.unsignedWireBase64);
  if (!signed.ok) return { kind: 'cancelled', line: walletFailureCopy(signed.reason, SAY) };

  let bundle = fresh;
  let check = await deps.checkReturned(fresh.plan, signed.signedWireBase64);
  if (check.verdict === 'BYTES_FEE_ADDED') {
    // The wallet added only its own fee and guard instructions: the engine re-reviews those exact bytes.
    deps.onPhase?.('sending');
    const adopted = await ask<unknown>(deps.fetch, '/api/solana/transfer/adopt', { body: bundleBody(fresh, signed.signedWireBase64), timeoutMs: TIMEOUT_MS.plan });
    if (!adopted.ok) return { kind: 'refused', refusal: refusalOf(adopted.failure) };
    if (!isBundle(adopted.value)) return { kind: 'refused', refusal: { code: 'SIGNED_BYTES_REJECTED', message: sendFailureCopy('SIGNED_BYTES_REJECTED', SAY) } };
    bundle = adopted.value;
    check = await deps.checkReturned(bundle.plan, signed.signedWireBase64);
  }
  if (check.verdict !== 'BYTES_MATCH') return { kind: 'refused', refusal: { code: 'SIGNED_BYTES_REJECTED', message: sendFailureCopy('SIGNED_BYTES_REJECTED', SAY) } };

  // The wallet may have been open for minutes: a name is read once more before the signed bytes leave.
  deps.onPhase?.('sending');
  const after = await nameMoved(deps, intent.name, bundle.plan.recipient);
  if (after) return { kind: 'refused', refusal: after };

  // Kept before the request: everything after this line may be lost, and these bytes are signed.
  if (check.signature) deps.pending.remember({ wallet: intent.sender, signature: check.signature, network: NETWORK, signedAt: new Date(deps.now()).toISOString() });

  const answer = await ask<Record<string, unknown>>(deps.fetch, '/api/solana/transfer/settle', { body: bundleBody(bundle, signed.signedWireBase64), timeoutMs: TIMEOUT_MS.settle });
  if (!answer.ok) {
    const signature = typeof answer.failure.extra.signature === 'string' ? answer.failure.extra.signature : null;
    // An answer that names a signature is a transfer whose outcome is open; the kept record lets it be read back.
    if (signature) return { kind: 'unresolved', signature, line: sendFailureCopy(answer.failure.code, SAY) };
    if (check.signature && /TIMEOUT|NETWORK/.test(answer.failure.code)) return { kind: 'unresolved', signature: check.signature, line: wordsNow(SEND_WORDS).noAnswer };
    return { kind: 'refused', refusal: refusalOf(answer.failure) };
  }
  const value = answer.value;
  const signature = typeof value.signature === 'string' ? value.signature : check.signature;
  const state = typeof value.state === 'string' ? value.state : 'UNKNOWN';
  if (!signature) return { kind: 'refused', refusal: { code: 'SETTLE_UNREADABLE', message: sendFailureCopy(null, SAY) } };
  const observed = !!value.observation && typeof value.observation === 'object';
  const receipt = value.receipt && typeof value.receipt === 'object' ? value.receipt : null;
  if (receipt) deps.keepReceipt(intent.sender, receipt);
  if (observed) deps.rememberRecipient(intent.sender, bundle.plan.recipient);
  deps.pending.forget(intent.sender);
  return { kind: 'settled', settled: { state, signature, observed, receipt }, line: observed ? null : sendOutcomeCopy(state, SAY) };
}

/** How a settled transfer reads: sent, not sent, or not confirmed yet. */
export function settledWord(settled: Pick<Settled, 'observed' | 'state'>): 'Sent' | 'Not sent' | 'Not confirmed' {
  return settled.observed ? 'Sent' : nothingMoved(settled.state) ? 'Not sent' : 'Not confirmed';
}

export type ResumeState = 'CHECKING' | 'LANDED' | 'FAILED' | 'UNKNOWN';

export type ResumeDeps = Readonly<{
  fetch: FetchLike;
  forget: (wallet: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onState: (state: ResumeState | null) => void;
  /** Stop asking: the window closed, another wallet came. */
  live: () => boolean;
}>;

/* The web card's bounds: a signature whose blockhash still lives is genuinely open, so it is read for a while. */
export const RESUME_DEADLINE_MS = 150_000;
export const RESUME_INTERVAL_MS = 3_000;

/**
 * A transfer this device signed and never saw the end of, read back by its signature through the engine's recovery
 * route — which accepts no bytes and can move nothing. The engine's own rule decides what to say and when the record
 * may go (`decideResume`); while it is open, no new transfer is built.
 */
export async function resumeSend(deps: ResumeDeps, pending: PendingSend): Promise<ResumeState | null> {
  const deadline = deps.now() + RESUME_DEADLINE_MS;
  deps.onState('CHECKING');
  for (;;) {
    const answer = await ask<Record<string, unknown>>(deps.fetch, '/api/solana/transfer/recover', { body: { network: pending.network, signature: pending.signature } });
    if (!deps.live()) return null;
    const primary = answer.ok ? (answer.value.primary as Record<string, unknown> | undefined) : undefined;
    const status = primary?.status as Record<string, unknown> | undefined;
    const decision = decideResume({
      read:
        answer.ok && status
          ? { seen: status.seen === true, err: typeof status.err === 'string' ? status.err : null, hasAttempt: answer.value.attempt !== null && answer.value.attempt !== undefined }
          : null,
      ageMs: deps.now() - Date.parse(pending.signedAt),
    });
    deps.onState(decision.show);
    if (decision.forget) deps.forget(pending.wallet);
    if (!decision.keepPolling || deps.now() >= deadline) return decision.show;
    await deps.sleep(RESUME_INTERVAL_MS);
    if (!deps.live()) return null;
  }
}
