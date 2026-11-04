import type { LaunchBuildRequest, LaunchBuildResponse, LaunchMetadataResponse, LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import { wordsNow } from '../i18n/dict.ts';
import { cityLaunchOpen } from './gate.ts';
import { FIELDS_REFUSED, freshPrebuilt, launchRequest, onlyTheLaunch, type Prebuilt } from './prepare.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, type LaunchFailure } from './refusal.ts';
import { REFUSAL_WORDS } from './words.ts';

export { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, causeOf, failureWords, pictureRefused, readRefusal, type LaunchFailure, type Refusal } from './refusal.ts';

/**
 * One launch from the city, start to end: the picture and the words go to the engine's store, the engine builds the
 * creation, the creator's wallet signs it, the engine sends it. One transaction, no first purchase, no lock: the three
 * fields and nothing else. The bytes live about thirty seconds, so a signature that comes back after them is not sent —
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
}>;

export type Phase =
  | Readonly<{ step: 'upload' }>
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; costLamports: string | null; again: boolean }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; liftoff: Liftoff }>
  | Readonly<{ step: 'failed'; failure: LaunchFailure }>;

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

  const request = launchRequest(signer.address, preset.id, stored.data.metadataUri);
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
      if (!onlyTheLaunch(built.data, network)) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built more than the launch.' };
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
  if (fresh.signed.length !== 1 || !signed) return fail(WALLET_REFUSED, wordsNow(REFUSAL_WORDS).otherCount);

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
