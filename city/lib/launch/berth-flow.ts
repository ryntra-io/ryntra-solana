import type { LaunchClaimBuildResponse, LaunchClaimSubmitResponse } from '../../../lib/api/v1/contract.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { BerthEngine } from './berth.ts';
import type { Answer, Network } from './engine.ts';
import type { Signer } from './flow.ts';

/**
 * «Забрати» from the berth: the engine's own creator claim (`/api/v1/launch/{mint}/claim/{build,submit}`, live since
 * contract 1.29.0), nothing new. The engine builds every pocket holding something into one or a few transactions, the
 * wallet signs them in one prompt as the only signer and fee payer, the engine sends them once and reads the receipts
 * from the programs' own events. The city signs nothing and counts nothing; it checks only that the bytes put before the
 * wallet are a claim of this launch, on this network, in its pair currency. Bytes live about thirty seconds: a
 * signature after that is not sent — the engine builds again and the wallet is asked once more.
 */

export type ClaimDone = Readonly<{
  /** CONFIRMED — every transaction landed; PENDING — sent, not confirmed in time; PARTIAL — the first landed, a later one did not. */
  state: LaunchClaimSubmitResponse['state'];
  /** What the wallet's account received, by the receipts read back. */
  receivedRaw: string;
  /** Every transaction's signature: landed, then pending. */
  signatures: readonly string[];
  network: Network;
}>;

export type ClaimFailure = Readonly<{ code: string; stage: 'before' | 'send'; message: string }>;

export type ClaimPhase =
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; again: boolean; expectedRaw: string; transactions: number }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; done: ClaimDone }>
  | Readonly<{ step: 'failed'; failure: ClaimFailure }>;

export const CLAIM_CLOSED = 'CITY_CLAIM_CLOSED';
export const BUILD_UNEXPECTED = 'CITY_BUILD_UNEXPECTED';
export const WALLET_REFUSED = 'WALLET_REFUSED';
export const BUILD_AGED = 'LAUNCH_BUILD_EXPIRED';

/** Whether a build is a claim of this launch: this network, this pair currency, something to take, one to five transactions. */
export function claimBuildMatches(built: LaunchClaimBuildResponse, expected: Readonly<{ network: Network; pairMint: string }>): boolean {
  if (built.network !== expected.network || built.pair.mint !== expected.pairMint) return false;
  if (built.unsignedWireBase64.length < 1 || built.unsignedWireBase64.length > 5) return false;
  return BigInt(built.expectedRaw) > 0n;
}

/** What the wallet received, by the receipts the engine read back from the chain. */
export function receivedOf(submitted: Pick<LaunchClaimSubmitResponse, 'receipts'>): string {
  return submitted.receipts.reduce((sum, receipt) => sum + BigInt(receipt.receivedRaw), 0n).toString();
}

export async function runClaim(args: Readonly<{
  engine: BerthEngine;
  signer: Signer;
  token: string;
  pairMint: string;
  network: Network;
  /** Whether claiming from the city is open here: the city's Launch gate, or the development stand-in. */
  open: boolean;
  onPhase: (phase: ClaimPhase) => void;
  now?: () => number;
}>): Promise<ClaimPhase> {
  const { engine, signer, token, network, onPhase } = args;
  const fail = (code: string, message = '', stage: 'before' | 'send' = 'before'): ClaimPhase => {
    const phase: ClaimPhase = { step: 'failed', failure: { code, stage, message } };
    onPhase(phase);
    return phase;
  };
  if (!args.open) return fail(CLAIM_CLOSED);

  let again = false;
  const fresh = await signFreshBytes<LaunchClaimBuildResponse, readonly string[], Extract<Answer<LaunchClaimBuildResponse>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const built = await engine.build(token, { wallet: signer.address });
      if (!built.ok) return built;
      /* Bytes for another network or currency, or with nothing to take, are not this claim and never reach the wallet. */
      if (!claimBuildMatches(built.data, { network, pairMint: args.pairMint })) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another claim.' };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, again, expectedRaw: built.expectedRaw, transactions: built.unsignedWireBase64.length });
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
  if (fresh.signed.length !== fresh.built.unsignedWireBase64.length) return fail(WALLET_REFUSED, 'The wallet returned another number of signed transactions.');

  onPhase({ step: 'send' });
  const sent = await engine.submit(token, { buildId: fresh.built.buildId, wallet: signer.address, signedWireBase64: [...fresh.signed] });
  if (!sent.ok) return fail(sent.code, sent.message, 'send');
  const done: ClaimPhase = {
    step: 'done',
    done: { state: sent.data.state, receivedRaw: receivedOf(sent.data), signatures: [...sent.data.receipts.map((receipt) => receipt.signature), ...sent.data.pending], network },
  };
  onPhase(done);
  return done;
}
