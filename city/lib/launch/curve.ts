import type { LaunchClaimBuildResponse, LaunchTradeBuildResponse } from '../../../lib/api/v1/contract.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, type LaunchFailure, type Signer } from './flow.ts';
import { cityLaunchOpen } from './gate.ts';
import { wordsNow } from '../i18n/dict.ts';
import { CURVE_FAILURE_WORDS } from './words.ts';

/**
 * A launch's tower, traded and claimed from its card: a buy or a sale on its curve (or in its pool after it moved), and
 * the creator's «Claim» of the fees that wait for them. The engine prices, builds and checks each transaction and sends
 * it once; the city hands the wallet exactly the bytes it built and shows what the engine answers. Nothing is counted
 * here — no fee, no split, no amount out — and the city's Launch switch opens it, as it opens launching.
 */

export type Side = 'buy' | 'sell';

/** Slippage the card trades with: the curve moves fast in the first minutes. */
export const CURVE_SLIPPAGE_BPS = 500;

export type Fill = Readonly<{
  side: Side;
  signature: string;
  /** CONFIRMED — the chain confirmed it; PENDING — sent and not confirmed in time, never sent again. */
  state: 'CONFIRMED' | 'PENDING';
  /** What moved, from the program's own event; null when it could not be read yet. */
  tokensRaw: string | null;
  pairRaw: string | null;
  network: Network;
}>;

export type TradePhase =
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; again: boolean }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; fill: Fill }>
  | Readonly<{ step: 'failed'; failure: LaunchFailure }>;

export type Claimed = Readonly<{
  /** CONFIRMED — every transaction landed; PENDING — one was sent and not confirmed in time; PARTIAL — part was taken. */
  state: 'CONFIRMED' | 'PENDING' | 'PARTIAL';
  /** What the wallet's balance of the pair currency received, by the receipts; null when none was read yet. */
  receivedRaw: string | null;
  signatures: readonly string[];
  network: Network;
}>;

export type ClaimPhase =
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; transactions: number; again: boolean }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; claimed: Claimed }>
  | Readonly<{ step: 'failed'; failure: LaunchFailure }>;

const RAW = /^\d{1,30}$/;

type Gate = Readonly<{ ownerWord?: boolean; switchOpen?: boolean; now?: () => number }>;

function failer<P>(onPhase: (phase: P) => void) {
  return (code: string, message = '', stage: 'before' | 'send' = 'before'): P => {
    const phase = { step: 'failed', failure: { code, stage, message, token: null } } as P;
    onPhase(phase);
    return phase;
  };
}

/** One buy or sale: the engine builds it, the wallet signs exactly that, the engine sends it once. */
export async function runCurveTrade(
  args: Gate &
    Readonly<{
      engine: LaunchEngine;
      signer: Signer;
      token: string;
      side: Side;
      /** What is spent: the pair currency on a buy, the token on a sale, raw. */
      amountRaw: string;
      network: Network;
      slippageBps?: number;
      onPhase: (phase: TradePhase) => void;
    }>,
): Promise<TradePhase> {
  const { engine, signer, token, side, network, onPhase } = args;
  const fail = failer<TradePhase>(onPhase);
  if (!cityLaunchOpen(network, args.ownerWord, args.switchOpen)) return fail(CITY_CLOSED);
  if (!RAW.test(args.amountRaw) || BigInt(args.amountRaw) === 0n) return fail('VALIDATION_ERROR', 'amount: above zero');
  const slippageBps = args.slippageBps ?? CURVE_SLIPPAGE_BPS;

  let again = false;
  const fresh = await signFreshBytes<LaunchTradeBuildResponse, readonly string[], Extract<Answer<LaunchTradeBuildResponse>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const built = await engine.tradeBuild(token, { wallet: signer.address, side, amountRaw: args.amountRaw, slippageBps });
      if (!built.ok) return built;
      /* Bytes for another network, or for the other side of the trade, are not what the card showed. */
      if (built.data.network !== network || built.data.quote.side !== side) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another trade.' };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, again });
      const answer = await signer.sign([built.unsignedWireBase64], built.network);
      return answer.ok ? { ok: true, value: answer.signed } : answer;
    },
    onRebuild: (why) => {
      again = why === 'late';
    },
    now: args.now,
  });
  if (!fresh.ok) {
    if (fresh.stage === 'build') return fail(fresh.failure.code, fresh.failure.message);
    if (fresh.stage === 'sign') return fail(WALLET_REFUSED, fresh.reason);
    return fail(BUILD_AGED);
  }
  const signed = fresh.signed[0];
  if (fresh.signed.length !== 1 || !signed) return fail(WALLET_REFUSED, wordsNow(CURVE_FAILURE_WORDS).otherCount);

  onPhase({ step: 'send' });
  const sent = await engine.tradeSubmit(token, { buildId: fresh.built.buildId, wallet: signer.address, signedWireBase64: signed });
  if (!sent.ok) return fail(sent.code, sent.message, 'send');
  const done: TradePhase = {
    step: 'done',
    fill: { side, signature: sent.data.signature, state: sent.data.state, tokensRaw: sent.data.filled?.tokensRaw ?? null, pairRaw: sent.data.filled?.pairRaw ?? null, network },
  };
  onPhase(done);
  return done;
}

/** The creator's claim: every source holding a fee now, in the transactions the engine built, each signed by the wallet. */
export async function runClaim(
  args: Gate & Readonly<{ engine: LaunchEngine; signer: Signer; token: string; network: Network; onPhase: (phase: ClaimPhase) => void }>,
): Promise<ClaimPhase> {
  const { engine, signer, token, network, onPhase } = args;
  const fail = failer<ClaimPhase>(onPhase);
  if (!cityLaunchOpen(network, args.ownerWord, args.switchOpen)) return fail(CITY_CLOSED);

  let again = false;
  const fresh = await signFreshBytes<LaunchClaimBuildResponse, readonly string[], Extract<Answer<LaunchClaimBuildResponse>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const built = await engine.claimBuild(token, signer.address);
      if (!built.ok) return built;
      if (built.data.network !== network) return { ok: false, code: BUILD_UNEXPECTED, message: wordsNow(CURVE_FAILURE_WORDS).otherNetwork };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, transactions: built.unsignedWireBase64.length, again });
      const answer = await signer.sign(built.unsignedWireBase64, built.network);
      return answer.ok ? { ok: true, value: answer.signed } : answer;
    },
    onRebuild: (why) => {
      again = why === 'late';
    },
    now: args.now,
  });
  if (!fresh.ok) {
    if (fresh.stage === 'build') return fail(fresh.failure.code, fresh.failure.message);
    if (fresh.stage === 'sign') return fail(WALLET_REFUSED, fresh.reason);
    return fail(BUILD_AGED);
  }
  if (fresh.signed.length !== fresh.built.unsignedWireBase64.length) return fail(WALLET_REFUSED, wordsNow(CURVE_FAILURE_WORDS).otherCount);

  onPhase({ step: 'send' });
  const sent = await engine.claimSubmit(token, { buildId: fresh.built.buildId, wallet: signer.address, signedWireBase64: [...fresh.signed] });
  if (!sent.ok) return fail(sent.code, sent.message, 'send');
  const receipts = sent.data.receipts;
  const done: ClaimPhase = {
    step: 'done',
    claimed: {
      state: sent.data.state,
      receivedRaw: receipts.length ? receipts.reduce((sum, receipt) => sum + BigInt(receipt.receivedRaw), 0n).toString() : null,
      signatures: [...receipts.map((receipt) => receipt.signature), ...sent.data.pending],
      network,
    },
  };
  onPhase(done);
  return done;
}

/** A trade's or a claim's failure in the card's words: what happened and whether anything left. At most two sentences. */
export function tradeFailureWords(failure: LaunchFailure, wallet: string | null = null): string {
  const message = failure.message.trim();
  const w = wordsNow(CURVE_FAILURE_WORDS);
  switch (failure.code) {
    case CITY_CLOSED:
      return w.closed;
    case WALLET_REFUSED:
      return /closed|cancel|reject|declin|refus/i.test(message) || !message ? w.notSigned(wallet ?? w.theWallet) : w.walletSaid(message.replace(/\.$/, ''));
    case BUILD_AGED:
      return w.aged;
    case BUILD_UNEXPECTED:
      return w.unexpected;
    case 'VALIDATION_ERROR':
      return w.invalid;
    case 'LAUNCH_BALANCE_LOW':
      return w.balanceLow;
    case 'LAUNCH_GRADUATING':
      return w.graduating;
    case 'LAUNCH_SLIPPAGE':
      return w.slippage;
    case 'LAUNCH_NOTHING_TO_CLAIM':
      return w.nothingToClaim;
    case 'WALLET_MISMATCH':
      return w.notCreator;
    case 'LAUNCH_BUILD_USED':
      return w.used;
    case 'LAUNCH_SUBMIT_FAILED':
      return w.submit;
    case 'LAUNCH_PAUSED':
    case 'LAUNCH_QUOTE_PAUSED':
      return w.paused;
    case 'LAUNCH_UNAVAILABLE':
      return w.unavailable;
    case 'RATE_LIMITED':
      return w.rateLimited;
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return w.otherBytes;
    default:
      if (failure.stage === 'send') return w.noAnswer;
      return message ? w.said(message.replace(/\.$/, '').slice(0, 110)) : w.wrong;
  }
}
