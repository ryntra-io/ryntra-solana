import type { LaunchMetadataResponse, LaunchPoolBuildRequest, LaunchPoolBuildResponse } from '../../../lib/api/v1/contract.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import type { LaunchFields, Phase, Signer } from './flow.ts';
import { cityLaunchOpen } from './gate.ts';
import type { PoolCheck } from './pool-check.ts';
import { POOL_LADDER, POOL_STAGES, poolDoorOpen, poolOpensAt, type PoolChoice, type PoolEngine, type PoolStage } from './pool.ts';
import { FIELDS_REFUSED } from './prepare.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED } from './refusal.ts';

/**
 * A launch straight into a pool from the city, start to end: the picture and the words go to the engine's
 * store as for any launch; then the engine builds one step at a time — the coin, the pool, the locked supply — each
 * from the chain as the step before left it. The city reads every step's bytes back (`pool-check.ts`), the creator's
 * wallet signs them, the engine sends them. Nothing here signs, counts or sends by itself.
 *
 * A step that did not land stops the launch where it is: nothing more is sent, and the launch waits for its creator —
 * the same flow, started with the coin's address (`resume`), takes it up at the step the chain shows.
 *
 * Shut unless the door is open (`poolDoorOpen`): the city's switch, the network.
 */

/** A step did not land: the launch is on chain in part, and waits for its creator. */
export const POOL_HALF_WAY = 'POOL_HALF_WAY';

export type PoolChecker = (args: Readonly<{ wires: readonly string[]; stage: PoolStage; creator: string; mint: string; pool: string }>) => PoolCheck;

/** How long the flow waits for a step that was sent and not answered for, and how often it asks. */
const SETTLE_MS = 45_000;
const SETTLE_EVERY_MS = 3_000;

export async function runPoolLaunch(args: Readonly<{
  engine: LaunchEngine;
  pool: PoolEngine;
  signer: Signer;
  fields: LaunchFields;
  network: Network;
  choice: PoolChoice;
  onPhase: (phase: Phase) => void;
  /** A launch already begun: its coin. The fields are then only for the card — nothing is stored or minted again. */
  resume?: string | null;
  now?: () => number;
  ownerWord?: boolean;
  switchOpen?: boolean;
  /** The city's own switch for the pool format, and its word on mainnet — for tests and the stand-in. */
  poolSwitch?: boolean;
  poolWord?: boolean;
  stored?: Promise<Answer<LaunchMetadataResponse>> | null;
  check?: PoolChecker;
  wait?: (ms: number) => Promise<void>;
}>): Promise<Phase> {
  const { engine, pool, signer, fields, network, onPhase } = args;
  const now = args.now ?? Date.now;
  const wait = args.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fail = (code: string, message = '', stage: 'before' | 'send' = 'before', token: string | null = null): Phase => {
    const phase: Phase = { step: 'failed', failure: { code, stage, message, token } };
    onPhase(phase);
    return phase;
  };
  if (!cityLaunchOpen(network, args.ownerWord, args.switchOpen) || !poolDoorOpen(network, args.poolSwitch, args.poolWord)) return fail(CITY_CLOSED);

  let mint: string | null = args.resume ?? null;
  let metadataUri: string | null = null;
  let name = fields.name;
  let symbol = fields.symbol;
  if (mint === null) {
    onPhase({ step: 'upload' });
    let ahead = args.stored ? await args.stored : null;
    if (ahead?.ok && (ahead.data.name !== fields.name || ahead.data.symbol !== fields.symbol)) ahead = null;
    if (ahead && !ahead.ok && !FIELDS_REFUSED.has(ahead.code)) ahead = null;
    const stored = ahead ?? (await engine.metadata({ name: fields.name, symbol: fields.symbol, description: '', website: '', x: '', telegram: '', imageBase64: fields.picture.base64 }));
    if (!stored.ok) return fail(stored.code, stored.message);
    metadataUri = stored.data.metadataUri;
    name = stored.data.name;
    symbol = stored.data.symbol;
  }
  const check = args.check ?? (await import('./pool-check.ts')).checkPoolStep;
  /* The opening is fixed at the first build and is the launch's own from then on: a later step never moves it. */
  const opensAt = mint === null ? poolOpensAt(args.choice, Math.floor(now() / 1000)) : null;

  let poolAddress: string | null = null;
  let opens = opensAt ?? 0;
  /* Whether the launch has the split, as its first build in this flow said: the one NFT a later step may hand over is held to it. */
  let split: boolean | null = null;
  /* At most one pass per step, and one more for a step taken up after a send that was not answered for. */
  for (let pass = 0; pass < POOL_STAGES.length + 2; pass += 1) {
    let again = false;
    const request: LaunchPoolBuildRequest = mint === null ? { creator: signer.address, metadataUri: metadataUri!, pair: args.choice.pair, opensAt, ...(args.choice.ladder ? { ladder: true } : {}) } : { creator: signer.address, mint };
    const fresh = await signFreshBytes<LaunchPoolBuildResponse, readonly string[], Extract<Answer<LaunchPoolBuildResponse>, { ok: false }>>({
      build: async () => {
        onPhase({ step: 'build' });
        const built: Answer<LaunchPoolBuildResponse> = await pool.build(request);
        if (!built.ok) return built;
        if (built.data.network !== network) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built for another network.' };
        if (mint !== null && built.data.mint !== mint) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built a step of another launch.' };
        /* The coin's step carries the opening the review showed; the pool's may move it when the creator came back late — said at the wallet's prompt. */
        if (opensAt !== null && built.data.stage === 'COIN' && built.data.opensAt !== opensAt) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another opening time than the review showed.' };
        /* The ladder is the creator's to ask for: a new launch is built with it exactly when the review showed it. */
        if (mint === null && built.data.stage === 'COIN' && (built.data.ladder !== null) !== args.choice.ladder) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another ladder than the review showed.' };
        const told = built.data.ladder;
        if (told && (told.shareBps !== POOL_LADDER.shareBps || told.nearMultiple !== POOL_LADDER.near || told.farMultiple !== POOL_LADDER.far)) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another ladder than the review showed.' };
        split ??= built.data.split !== null;
        if ((built.data.split !== null) !== split) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another split than the launch has.' };
        const read = check({ wires: built.data.unsignedWireBase64, stage: built.data.stage, creator: signer.address, mint: built.data.mint, pool: built.data.pool, handOvers: split ? 1 : 0 });
        if (!read.ok) return { ok: false, code: BUILD_UNEXPECTED, message: read.reason };
        return built;
      },
      signableMsOf: (built) => built.signableMs,
      sign: async (built) => {
        onPhase({ step: 'sign', wallet: signer.wallet, costLamports: built.remainingLamports, again, pool: { stage: built.stage, opensAt: built.opensAt } });
        const answer = await signer.sign(built.unsignedWireBase64, built.network);
        return answer.ok ? { ok: true, value: answer.signed } : answer;
      },
      onRebuild: (why) => {
        again = why === 'late';
      },
      now,
    });
    /* A launch whose coin is on chain is half-way whatever stopped a later step: said as it is — part landed, nothing more was sent — with one way on, «Continue». */
    const halt = (code: string, message = ''): Phase => (mint !== null ? fail(POOL_HALF_WAY, [code, message].filter(Boolean).join(': '), 'send', mint) : fail(code, message));
    if (!fresh.ok) {
      if (fresh.stage === 'build') {
        /* The chain shows the launch whole: a step sent and not answered for landed after all. */
        if (mint !== null && fresh.failure.code === 'VALIDATION_ERROR' && pass > 0 && poolAddress !== null) break;
        return halt(fresh.failure.code, fresh.failure.message);
      }
      if (fresh.stage === 'sign') return halt(WALLET_REFUSED, fresh.reason);
      return halt(BUILD_AGED);
    }
    const built = fresh.built;
    if (fresh.signed.length !== built.unsignedWireBase64.length || fresh.signed.some((wire) => !wire)) return halt(WALLET_REFUSED);
    mint = built.mint;
    poolAddress = built.pool;
    opens = built.opensAt;

    onPhase({ step: 'send', pool: { stage: built.stage } });
    const sent = await pool.submit({ buildId: built.buildId, creator: signer.address, signedWireBase64: [...fresh.signed] });
    /* The coin's own send refused: nothing landed, and the launch is begun anew. A later step refused: the launch waits half-way. */
    if (!sent.ok) return built.stage === 'COIN' ? fail(sent.code, sent.message, 'send', null) : fail(POOL_HALF_WAY, `${sent.code}: ${sent.message}`, 'send', mint);
    let next = sent.data.next;
    if (sent.data.state === 'FAILED') return fail(POOL_HALF_WAY, sent.data.reason ?? '', 'send', mint);
    if (sent.data.state === 'PENDING') {
      /* Sent, and not answered for in time: the launch's own read says when the step is there. */
      const until = now() + SETTLE_MS;
      let settled = false;
      while (now() < until) {
        await wait(SETTLE_EVERY_MS);
        const view = await pool.view(mint);
        if (view.ok && view.data.next !== built.stage) {
          next = view.data.next;
          settled = true;
          break;
        }
      }
      if (!settled) return fail(POOL_HALF_WAY, '', 'send', mint);
    }
    if (next === null) break;
    /* The same step again means part of it is still to sign — the hand-over alone, when the transaction before it landed and it did not. */
  }
  if (mint === null || poolAddress === null) return fail(BUILD_UNEXPECTED);
  const done: Phase = { step: 'pooled', pooled: { mint, pool: poolAddress, name, symbol, picture: fields.picture.url, network, opensAt: opens } };
  onPhase(done);
  return done;
}
