import type { LaunchBuildResponse, LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import { wordsNow } from '../i18n/dict.ts';
import { cityLaunchOpen } from './gate.ts';
import { FAILURE_WORDS } from './words.ts';

/**
 * One launch from the city, start to end: the picture and the words go to the engine's store, the engine builds the
 * creation, the creator's wallet signs it, the engine sends it. One transaction, no first purchase, no lock: the three
 * fields and nothing else. The bytes live about thirty seconds, so a signature that comes back after them is not sent —
 * the engine builds once more and the wallet is asked again (`signFreshBytes`).
 */

/** The creator's wallet, as the flow needs it: who signs, and the signature of exactly the bytes it is handed. */
export type Signer = Readonly<{
  wallet: string;
  address: string;
  sign: (wires: readonly string[], chain: Network) => Promise<Readonly<{ ok: true; signed: readonly string[] }> | Readonly<{ ok: false; reason: string }>>;
}>;

export type LaunchFields = Readonly<{ name: string; symbol: string; picture: Readonly<{ base64: string; url: string }> }>;

export type Liftoff = Readonly<{
  token: string;
  signature: string;
  /** LAUNCHED — the chain confirmed it; PENDING — sent and not confirmed in time, the token's read settles it. */
  state: 'LAUNCHED' | 'PENDING';
  network: Network;
  name: string;
  symbol: string;
  /** The picture as the creator chose it, for the card while the engine's copy is on its way. */
  picture: string;
  creator: string;
  at: number;
}>;

/** Why a launch stopped. `before` — nothing was sent; `send` — the signed creation reached the engine and its fate is the chain's. */
export type LaunchFailure = Readonly<{ code: string; stage: 'before' | 'send'; message: string; token: string | null }>;

export type Phase =
  | Readonly<{ step: 'upload' }>
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; costLamports: string | null; again: boolean }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; liftoff: Liftoff }>
  | Readonly<{ step: 'failed'; failure: LaunchFailure }>;

/** The city's own refusals, beside the engine's codes. */
export const CITY_CLOSED = 'CITY_LAUNCH_CLOSED';
export const BUILD_UNEXPECTED = 'CITY_BUILD_UNEXPECTED';
export const WALLET_REFUSED = 'WALLET_REFUSED';
export const BUILD_AGED = 'LAUNCH_BUILD_EXPIRED';

export async function runLaunch(args: Readonly<{
  engine: LaunchEngine;
  signer: Signer;
  fields: LaunchFields;
  preset: LaunchPresetView;
  network: Network;
  onPhase: (phase: Phase) => void;
  now?: () => number;
  /** The flow reads the city's own value otherwise. */
  ownerWord?: boolean;
  /** The deployment's switch, for tests and the development stand-in; the flow reads the city's own value otherwise. */
  switchOpen?: boolean;
}>): Promise<Phase> {
  const { engine, signer, fields, preset, network, onPhase } = args;
  const now = args.now ?? Date.now;
  const fail = (code: string, message = '', stage: 'before' | 'send' = 'before', token: string | null = null): Phase => {
    const phase: Phase = { step: 'failed', failure: { code, stage, message, token } };
    onPhase(phase);
    return phase;
  };
  if (!cityLaunchOpen(network, args.ownerWord, args.switchOpen)) return fail(CITY_CLOSED);

  onPhase({ step: 'upload' });
  const stored = await engine.metadata({ name: fields.name, symbol: fields.symbol, description: '', website: '', x: '', telegram: '', imageBase64: fields.picture.base64 });
  if (!stored.ok) return fail(stored.code, stored.message);

  let again = false;
  const fresh = await signFreshBytes<LaunchBuildResponse, readonly string[], Extract<Answer<LaunchBuildResponse>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const built = await engine.build({ creator: signer.address, preset: preset.id, metadataUri: stored.data.metadataUri, firstBuyRaw: '0', lock: null });
      if (!built.ok) return built;
      /* The review showed one launch on this network and nothing more: bytes for another network, a lock or a sharing
         of fees are not this launch, and are never put before the wallet. */
      if (built.data.network !== network) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built for another network.' };
      if (built.data.lockUnsignedWireBase64 !== null || built.data.splitUnsignedWireBase64) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built more than the launch.' };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, costLamports: built.creatorCostLamports, again });
      const answer = await signer.sign([built.unsignedWireBase64], built.network);
      return answer.ok ? { ok: true, value: answer.signed } : answer;
    },
    onRebuild: (why) => {
      again = why === 'late';
    },
    now,
  });
  if (!fresh.ok) {
    if (fresh.stage === 'build') return fail(fresh.failure.code, fresh.failure.message);
    if (fresh.stage === 'sign') return fail(WALLET_REFUSED, fresh.reason);
    return fail(BUILD_AGED);
  }
  const signed = fresh.signed[0];
  if (fresh.signed.length !== 1 || !signed) return fail(WALLET_REFUSED, wordsNow(FAILURE_WORDS).otherCount);

  onPhase({ step: 'send' });
  const sent = await engine.submit({ buildId: fresh.built.buildId, creator: signer.address, signedWireBase64: signed, signedLockWireBase64: null });
  if (!sent.ok) return fail(sent.code, sent.message, 'send', fresh.built.token);
  const done: Phase = {
    step: 'done',
    liftoff: {
      token: sent.data.token,
      signature: sent.data.signature,
      state: sent.data.state,
      network,
      name: stored.data.name,
      symbol: stored.data.symbol,
      picture: fields.picture.url,
      creator: signer.address,
      at: now(),
    },
  };
  onPhase(done);
  return done;
}

/** A failure in the city's words: what happened, and whether anything left. At most two short sentences. */
export function failureWords(failure: LaunchFailure, wallet: string | null = null): string {
  const message = failure.message.trim();
  const w = wordsNow(FAILURE_WORDS);
  switch (failure.code) {
    case CITY_CLOSED:
      return w.closed;
    case WALLET_REFUSED:
      return /closed|cancel|reject|declin|refus/i.test(message) || !message ? w.notSigned(wallet ?? w.theWallet) : w.walletSaid(message.replace(/\.$/, ''));
    case BUILD_AGED:
    case 'LAUNCH_BUILD_EXPIRED':
      return w.aged;
    case BUILD_UNEXPECTED:
      return w.unexpected;
    case 'LAUNCH_NAME_BORROWED':
      return message ? w.borrowedSaid(message) : w.borrowed;
    case 'VALIDATION_ERROR':
      return w.invalid;
    case 'LAUNCH_IMAGE_INVALID':
      return w.imageInvalid;
    case 'LAUNCH_IMAGE_REFUSED':
      return w.imageRefused;
    case 'LAUNCH_IMAGE_CHECK_UNAVAILABLE':
      return w.imageUnchecked;
    case 'LAUNCH_LIMIT':
      return w.limit;
    case 'LAUNCH_PAUSED':
    case 'LAUNCH_QUOTE_PAUSED':
      return w.paused;
    case 'LAUNCH_BUSY':
      return w.busy;
    case 'LAUNCH_UNAVAILABLE':
      return w.unavailable;
    case 'RATE_LIMITED':
      return w.rateLimited;
    case 'WALLET_MISMATCH':
      return w.mismatch;
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return w.otherBytes;
    case 'LAUNCH_BUILD_USED':
      return w.used;
    case 'LAUNCH_SUBMIT_FAILED':
      return message ? w.submitSaid(message.replace(/\.$/, '')) : w.submit;
    default:
      return failure.stage === 'send' ? w.noAnswer : w.wrong;
  }
}
