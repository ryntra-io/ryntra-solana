import type { LaunchEarlyAccessBuildResponse, LaunchMetadataResponse } from '../../../lib/api/v1/contract.ts';
import type { EarlyAccessRules } from '../../../lib/core/launch/early-access.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { EarlyCheck } from './early-check.ts';
import { earlyDoorOpen, type EarlyBounds } from './early.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import type { LaunchFields, Phase, Signer } from './flow.ts';
import { cityLaunchOpen } from './gate.ts';
import { FIELDS_REFUSED } from './prepare.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, EARLY_PARTIAL, WALLET_REFUSED } from './refusal.ts';
import { REFUSAL_WORDS } from './words.ts';

/**
 * A launch with early access from the city (CITY-212), start to end: the picture and the words go to the engine's
 * store as for any launch; the engine builds the creation — the mint, the pool, the vault — from the rules the sheet
 * made of the creator's goal (`early.ts`); the city reads the bytes back (`early-check.ts`); the creator's wallet signs
 * all three in one prompt; the engine sends them one after the other. Nothing here signs, counts or sends by itself.
 *
 * Shut unless the door is open (`earlyDoorOpen`): the city's switch, the engine's bounds, the network.
 */

export type EarlyChecker = (built: LaunchEarlyAccessBuildResponse, args: Readonly<{ network: Network; creator: string; rules: EarlyAccessRules }>) => EarlyCheck;

export async function runEarlyAccess(args: Readonly<{
  engine: LaunchEngine;
  signer: Signer;
  fields: LaunchFields;
  network: Network;
  bounds: EarlyBounds | null;
  /** The rules at a moment (unix seconds): made at each build, so the window always opens ahead of the press. */
  rulesAt: (now: number) => EarlyAccessRules | null;
  onPhase: (phase: Phase) => void;
  now?: () => number;
  ownerWord?: boolean;
  switchOpen?: boolean;
  /** The city's own switch for early access, for tests and the stand-in; the flow reads the city's value otherwise. */
  earlySwitch?: boolean;
  stored?: Promise<Answer<LaunchMetadataResponse>> | null;
  check?: EarlyChecker;
}>): Promise<Phase> {
  const { engine, signer, fields, network, onPhase } = args;
  const now = args.now ?? Date.now;
  const fail = (code: string, message = '', stage: 'before' | 'send' = 'before', token: string | null = null): Phase => {
    const phase: Phase = { step: 'failed', failure: { code, stage, message, token } };
    onPhase(phase);
    return phase;
  };
  if (!cityLaunchOpen(network, args.ownerWord, args.switchOpen) || !earlyDoorOpen(network, args.bounds, args.earlySwitch)) return fail(CITY_CLOSED);

  onPhase({ step: 'upload' });
  let ahead = args.stored ? await args.stored : null;
  if (ahead?.ok && (ahead.data.name !== fields.name || ahead.data.symbol !== fields.symbol)) ahead = null;
  if (ahead && !ahead.ok && !FIELDS_REFUSED.has(ahead.code)) ahead = null;
  const stored = ahead ?? (await engine.metadata({ name: fields.name, symbol: fields.symbol, description: '', website: '', x: '', telegram: '', imageBase64: fields.picture.base64 }));
  if (!stored.ok) return fail(stored.code, stored.message);
  const check = args.check ?? (await import('./early-check.ts')).checkEarly;

  let again = false;
  const fresh = await signFreshBytes<LaunchEarlyAccessBuildResponse, readonly string[], Extract<Answer<LaunchEarlyAccessBuildResponse>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const rules = args.rulesAt(Math.floor(now() / 1000));
      if (!rules) return { ok: false, code: 'VALIDATION_ERROR', message: 'No rules inside the bounds.' };
      const built = await engine.earlyBuild({ creator: signer.address, metadataUri: stored.data.metadataUri, rules });
      if (!built.ok) return built;
      const read = check(built.data, { network, creator: signer.address, rules });
      if (!read.ok) return { ok: false, code: BUILD_UNEXPECTED, message: read.reason };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, costLamports: null, again, early: true });
      const answer = await signer.sign(built.unsignedWireBase64, built.network);
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
  if (fresh.signed.length !== 3 || fresh.signed.some((wire) => !wire)) return fail(WALLET_REFUSED, wordsNow(REFUSAL_WORDS).otherCount);

  onPhase({ step: 'send' });
  const sent = await engine.earlySubmit({ buildId: fresh.built.buildId, creator: signer.address, signedWireBase64: [...fresh.signed] });
  if (!sent.ok) return fail(sent.code, sent.message, 'send', fresh.built.mint);
  /* Part of it landed and part did not: said as it is, never as a launch. */
  if (sent.data.state === 'PARTIAL') return fail(EARLY_PARTIAL, '', 'send', sent.data.mint);
  const times = { opensAt: fresh.built.schedule.depositStartsAt, publicAt: fresh.built.schedule.activatesAt };
  const done: Phase = {
    step: 'opened',
    opened: { mint: sent.data.mint, name: stored.data.name, symbol: stored.data.symbol, picture: fields.picture.url, network, state: sent.data.state, opensAt: times.opensAt, publicAt: times.publicAt },
  };
  onPhase(done);
  return done;
}
