import type { LaunchBuildRequest, LaunchBuildResponse, LaunchMetadataResponse, LaunchPresetView, LaunchSubmitResponse } from '../../../lib/api/v1/contract.ts';
import { feeShareProblems, withCreatorShare, type FeeShare } from '../../../lib/core/launch/fee-shares.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import { wordsNow } from '../i18n/dict.ts';
import { cityLaunchOpen } from './gate.ts';
import { FIELDS_REFUSED, asReviewed, freshPrebuilt, launchRequest, type Prebuilt } from './prepare.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, type LaunchFailure } from './refusal.ts';
import { REFUSAL_WORDS } from './words.ts';

export { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, causeOf, failureWords, pictureRefused, readRefusal, type LaunchFailure, type Refusal } from './refusal.ts';

/**
 * One launch from the city, start to end: the picture and the words go to the engine's store, the engine builds the
 * creation, the creator's wallet signs it, the engine sends it. One transaction, no first purchase, no lock: the three
 * fields and nothing else — or, when the review showed the creator's fees shared (CITY-212), a second transaction the
 * same wallet signs in the same prompt, read back first (`split-check.ts`) so it is exactly the shares shown. The bytes live about thirty seconds, so a signature that comes back after them is not sent —
 * the engine builds once more and the wallet is asked again (`signFreshBytes`).
 *
 * The sheet may have done the first two steps ahead of the press (CITY-143, `prepare.ts`): the store's answer for these
 * very fields is taken instead of storing them again, and a build of exactly this launch is taken instead of the first
 * build — only while a wallet may still be opened on its bytes.
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
  /** The creator's fees shared, as the engine settled it: SHARED, PENDING, or FAILED — then the creator keeps every fee. */
  sharing: Readonly<{ state: 'SHARED' | 'PENDING' | 'FAILED'; shares: readonly FeeShare[] }> | null;
}>;

/** An early-access launch, set on chain (CITY-212): unix seconds for its two moments. */
export type Opened = Readonly<{ mint: string; name: string; symbol: string; picture: string; network: Network; state: 'PENDING' | 'OPEN'; opensAt: number; publicAt: number }>;

export type Phase =
  | Readonly<{ step: 'upload' }>
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; costLamports: string | null; again: boolean; shared?: boolean; early?: boolean }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; liftoff: Liftoff }>
  /** CITY-212: an early-access launch is set — its people get in at `opensAt`, everyone trades from `publicAt`. */
  | Readonly<{ step: 'opened'; opened: Opened }>
  | Readonly<{ step: 'failed'; failure: LaunchFailure }>;

/** The reader of a sharing's bytes (`split-check.ts`'s `checkSplit`). */
export type SplitChecker = (args: Readonly<{ creationWire: string; splitWire: string; creator: string; token: string; feeVault: string | null | undefined; shares: readonly FeeShare[] }>) => Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

function sharingOf(sharing: LaunchSubmitResponse['feeSharing']): Liftoff['sharing'] {
  return sharing ? { state: sharing.state, shares: sharing.shares } : null;
}

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
  /** The store's answer for these fields, already on its way (the sheet stores them while the creator types). */
  stored?: Promise<Answer<LaunchMetadataResponse>> | null;
  /** The build the sheet made ahead for its cost, handed over once when it is exactly this launch. */
  takePrebuilt?: (request: LaunchBuildRequest, network: Network) => Prebuilt | null;
  /** CITY-212: the other wallets and their parts of the creator's fees, as the review showed them; the creator keeps the rest. */
  others?: readonly FeeShare[];
  /** The reader of the sharing's bytes; loaded on the press when a launch shares (`split-check.ts`). */
  checkSplit?: SplitChecker;
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
  /* The sheet's answer for these fields, when it is theirs: a refusal of the fields stands; any other is asked again. */
  let ahead = args.stored ? await args.stored : null;
  if (ahead?.ok && (ahead.data.name !== fields.name || ahead.data.symbol !== fields.symbol)) ahead = null;
  if (ahead && !ahead.ok && !FIELDS_REFUSED.has(ahead.code)) ahead = null;
  const stored = ahead ?? (await engine.metadata({ name: fields.name, symbol: fields.symbol, description: '', website: '', x: '', telegram: '', imageBase64: fields.picture.base64 }));
  if (!stored.ok) return fail(stored.code, stored.message);

  /* The split as the review showed it, the creator keeping the rest — refused here, before anything is built, where the
     engine would refuse it. */
  const shares = args.others?.length ? withCreatorShare(signer.address, args.others) : null;
  if (shares && feeShareProblems(signer.address, shares).length) return fail('LAUNCH_SHARES_INVALID');
  const check = shares ? (args.checkSplit ?? (await import('./split-check.ts')).checkSplit) : null;
  const request = launchRequest(signer.address, preset.id, stored.data.metadataUri, shares);
  let ready = args.takePrebuilt?.(request, network) ?? null;
  let again = false;
  const fresh = await signFreshBytes<LaunchBuildResponse, readonly string[], Extract<Answer<LaunchBuildResponse>, { ok: false }>>({
    build: async () => {
      /* The first build may be the one the sheet made ahead, while a wallet may still be opened on it; then fresh ones. */
      const reused = freshPrebuilt(ready, request, network, now());
      ready = null;
      if (!reused) onPhase({ step: 'build' });
      const built: Answer<LaunchBuildResponse> = reused ? { ok: true, data: reused } : await engine.build(request);
      if (!built.ok) return built;
      /* The review showed one launch on this network and nothing more: bytes for another network, a lock or a sharing
         of fees are not this launch, and are never put before the wallet. */
      if (built.data.network !== network) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built for another network.' };
      if (!asReviewed(built.data, network, shares !== null)) return { ok: false, code: BUILD_UNEXPECTED, message: shares ? 'The engine did not build the sharing the review showed.' : 'The engine built more than the launch.' };
      if (shares && check) {
        const read = check({ creationWire: built.data.unsignedWireBase64, splitWire: built.data.splitUnsignedWireBase64 ?? '', creator: signer.address, token: built.data.token, feeVault: built.data.feeVault, shares });
        if (!read.ok) return { ok: false, code: BUILD_UNEXPECTED, message: read.reason };
      }
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, costLamports: built.creatorCostLamports, again, shared: shares !== null });
      const wires = shares && built.splitUnsignedWireBase64 ? [built.unsignedWireBase64, built.splitUnsignedWireBase64] : [built.unsignedWireBase64];
      const answer = await signer.sign(wires, built.network);
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
  const [signed, signedSplit] = fresh.signed;
  if (fresh.signed.length !== (shares ? 2 : 1) || !signed || (shares && !signedSplit)) return fail(WALLET_REFUSED, wordsNow(REFUSAL_WORDS).otherCount);

  onPhase({ step: 'send' });
  const sent = await engine.submit({ buildId: fresh.built.buildId, creator: signer.address, signedWireBase64: signed, signedLockWireBase64: null, ...(shares ? { signedSplitWireBase64: signedSplit } : {}) });
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
      sharing: sharingOf(sent.data.feeSharing),
    },
  };
  onPhase(done);
  return done;
}
