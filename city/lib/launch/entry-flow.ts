import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { EntryCheck, EntryKind } from './entry-check.ts';
import { stepAction, type EntryEngine, type EntryStep } from './entry.ts';
import type { Answer, Network } from './engine.ts';
import type { Signer } from './flow.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED } from './refusal.ts';

/**
 * One step of early access from the people's window (CITY-220), start to end: the engine builds it for this wallet
 * alone, the city reads it back (`entry-check.ts`), the wallet signs it in one prompt, the engine sends it. A coming-in
 * goes only through an open door (`entryStep` says so); a way back to one's own tokens and USDC never waits for one.
 * Nothing here signs, counts or sends by itself.
 */

export type EntryPhase =
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; again: boolean }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; kind: EntryKind; state: 'CONFIRMED' | 'PENDING'; amountRaw: string | null }>
  | Readonly<{ step: 'failed'; code: string; stage: 'before' | 'send'; message: string }>;

export type EntryChecker = (args: Readonly<{ wire: string; builtNetwork: string; network: Network; kind: EntryKind; wallet: string; vault: string; amountRaw: string | null }>) => EntryCheck;

type Built = Readonly<{ buildId: string; network: string; unsignedWireBase64: string; signableMs: number; amountRaw: string | null }>;

export async function runEntry(args: Readonly<{
  engine: EntryEngine;
  signer: Signer;
  network: Network;
  mint: string;
  vault: string;
  /** The step the window shows now; its one action is the one sent. */
  step: EntryStep;
  /** A deposit's amount, raw USDC. */
  amountRaw?: string | null;
  /** Pro Rata, while the window is open: the deposit back (`WITHDRAW`), the window's quiet second way. */
  takeBack?: boolean;
  onPhase: (phase: EntryPhase) => void;
  now?: () => number;
  check?: EntryChecker;
}>): Promise<EntryPhase> {
  const { engine, signer, network, mint, vault, step, onPhase } = args;
  const fail = (code: string, message = '', stage: 'before' | 'send' = 'before'): EntryPhase => {
    const phase: EntryPhase = { step: 'failed', code, stage, message };
    onPhase(phase);
    return phase;
  };
  const kind: EntryKind | null = args.takeBack ? (step.kind === 'join' && step.takeBack ? 'WITHDRAW' : null) : stepAction(step);
  if (!kind) return fail(CITY_CLOSED);
  const amountRaw = kind === 'DEPOSIT' ? (args.amountRaw ?? null) : kind === 'WITHDRAW' && step.kind === 'join' ? step.mineRaw : null;
  if ((kind === 'DEPOSIT' || kind === 'WITHDRAW') && !amountRaw) return fail('VALIDATION_ERROR');
  /* The one buy spends what the window showed deposited, never more (review 8.11): its bytes are read against that. */
  const spends = kind === 'FILL' && step.kind === 'fill' ? step.depositedRaw : null;
  if (kind === 'FILL' && !spends) return fail('VALIDATION_ERROR');
  const check = args.check ?? (await import('./entry-check.ts')).checkEntry;

  let again = false;
  const fresh = await signFreshBytes<Built, readonly string[], Extract<Answer<Built>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const built: Answer<Built> =
        kind === 'DEPOSIT'
          ? await engine.depositBuild(mint, { wallet: signer.address, amountRaw: amountRaw! })
          : await engine.actionBuild(mint, { wallet: signer.address, action: kind, ...(kind === 'WITHDRAW' ? { amountRaw } : {}) });
      if (!built.ok) return built;
      const read = check({ wire: built.data.unsignedWireBase64, builtNetwork: built.data.network, network, kind, wallet: signer.address, vault, amountRaw: kind === 'DEPOSIT' || kind === 'WITHDRAW' ? amountRaw : spends });
      if (!read.ok) return { ok: false, code: BUILD_UNEXPECTED, message: read.reason };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, again });
      const answer = await signer.sign([built.unsignedWireBase64], network);
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
  const [signed] = fresh.signed;
  if (fresh.signed.length !== 1 || !signed) return fail(WALLET_REFUSED);

  onPhase({ step: 'send' });
  const body = { buildId: fresh.built.buildId, wallet: signer.address, signedWireBase64: signed };
  const sent = kind === 'DEPOSIT' ? await engine.depositSubmit(mint, body) : await engine.actionSubmit(mint, body);
  if (!sent.ok) return fail(sent.code, sent.message, 'send');
  const done: EntryPhase = { step: 'done', kind, state: sent.data.state, amountRaw: fresh.built.amountRaw ?? amountRaw };
  onPhase(done);
  return done;
}
