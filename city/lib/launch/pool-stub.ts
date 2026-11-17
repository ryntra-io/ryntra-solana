import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { LaunchPoolBuildResponse, LaunchPoolView } from '../../../lib/api/v1/contract.ts';
import { DLMM_PRO_LAUNCH_TERMS, DLMM_PRO_PROGRAM_ID } from '../../../lib/core/launch/dlmm-pro.ts';
import type { Answer } from './engine.ts';
import type { PoolEngine, PoolListed, PoolStage } from './pool.ts';
import { STUB_CREATOR, stubAddress, stubSignature } from './stub.ts';

/**
 * The stand-in for the engine's launch into a pool, beside the stub engine on the development stand
 * (`/?launch=stub&pool=open`): it builds nothing real, signs nothing and holds no key — it answers the same routes in
 * the same shapes, so every state of the door, the three steps, the set launch and the tower's window can be looked
 * at. Never in a production bundle (`district.ts` loads it only in development).
 *
 * The stand starts with two launches of its own — one counting down, one trading — so the docks show both towers
 * (`&pooltowers=none` leaves them out).
 */

export type PoolStubOptions = Readonly<{ delayMs?: number; now?: () => number }>;

type StubLaunch = { mint: string; pool: string; creator: string; name: string; symbol: string; pair: 'SOL' | 'USDC'; opensAt: number; ladder: boolean; done: PoolStage[]; createdAt: string; steps: Record<PoolStage, string[]> };

const ORDER: readonly PoolStage[] = ['COIN', 'POOL', 'SUPPLY'];
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A step's bytes as the city's own reader takes them: the creator pays; the coin's account is made in the first; the pool is named after. */
function stubWires(stage: PoolStage, creator: string, mint: string, pool: string, seed: string, ladder = false): string[] {
  const payer = new PublicKey(creator);
  const blockhash = stubAddress(`blockhash:${seed}`);
  const tx = (instruction: TransactionInstruction) => toBase64(new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(instruction).serialize({ requireAllSignatures: false, verifySignatures: false }));
  if (stage === 'COIN') return [tx(SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: new PublicKey(mint), lamports: 4_000_000, space: 300, programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') }))];
  /* A call of DLMM Pro on the launch's pool — the shape the city's reader holds a step to; the stand's program does nothing with it. */
  const call = () => new TransactionInstruction({ programId: new PublicKey(DLMM_PRO_PROGRAM_ID), data: new Uint8Array(8) as Buffer, keys: [{ pubkey: new PublicKey(pool), isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: true }] });
  const proof = SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(pool), lamports: 1 });
  if (stage === 'POOL') return [toBase64(new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(proof, call()).serialize({ requireAllSignatures: false, verifySignatures: false }))];
  /* The supply: the creator's position, Ryntra's, its hand-over — and the creator's ladder where there is one. */
  return [tx(call()), tx(call()), tx(call()), ...(ladder ? [tx(call())] : [])];
}

export function stubPoolEngine(options: PoolStubOptions = {}): PoolEngine {
  const now = options.now ?? Date.now;
  const seconds = () => Math.floor(now() / 1000);
  const wait = (factor = 1) => new Promise<void>((resolve) => setTimeout(resolve, (options.delayMs ?? 0) * factor));
  const launches = new Map<string, StubLaunch>();
  const builds = new Map<string, { mint: string; stage: PoolStage; creator: string; wires: string[]; used: boolean }>();
  const asked = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  if (asked.get('pooltowers') !== 'none') {
    /* The stand's own two towers: one twelve minutes from its opening, one trading for an hour. */
    for (const [symbol, name, pair, opens, ladder] of [
      ['GLOW', 'Night Glow', 'SOL', seconds() + 12 * 60 + 4, true],
      ['TIDE', 'Low Tide', 'USDC', seconds() - 3_600, true],
    ] as const) {
      const mint = stubAddress(`pool-mint:${symbol}`);
      launches.set(mint, { mint, pool: stubAddress(`pool:${symbol}`), creator: stubAddress(`pool-creator:${symbol}`), name, symbol, pair, opensAt: opens, ladder, done: [...ORDER], createdAt: new Date(now() - 30 * 60_000).toISOString(), steps: { COIN: [stubSignature(`${symbol}:coin`)], POOL: [stubSignature(`${symbol}:pool`)], SUPPLY: [stubSignature(`${symbol}:s1`), stubSignature(`${symbol}:s2`), stubSignature(`${symbol}:s3`), stubSignature(`${symbol}:s4`)] } });
    }
  }
  const nextOf = (launch: StubLaunch): PoolStage | null => ORDER.find((stage) => !launch.done.includes(stage)) ?? null;
  const listed = (launch: StubLaunch): PoolListed => ({ mint: launch.mint, pool: launch.pool, creator: launch.creator, name: launch.name, symbol: launch.symbol, metadataUri: '', pair: launch.pair, opensAt: launch.opensAt, phase: nextOf(launch) !== null ? 'BUILDING' : seconds() >= launch.opensAt ? 'OPEN' : 'COUNTDOWN', createdAt: launch.createdAt });
  const terms = DLMM_PRO_LAUNCH_TERMS;
  /* The creator's ladder as the engine tells it: a twentieth of the supply, five prices from ×2 to ×10. */
  const ladderRaw = (BigInt(terms.coin.supply) * 10n ** BigInt(terms.coin.decimals) * BigInt(terms.ladder.shareBps)) / 10_000n;
  const ladderTold = { shareBps: terms.ladder.shareBps, amountRaw: ladderRaw.toString(), nearMultiple: 1 + terms.ladder.nearBps / 10_000, farMultiple: 1 + terms.ladder.farBps / 10_000, rungs: terms.ladder.rungs };
  const viewOf = (launch: StubLaunch): LaunchPoolView => {
    const next = nextOf(launch);
    const open = next === null && seconds() >= launch.opensAt;
    const start = terms.startCap[launch.pair] / terms.coin.supply;
    /* A trading tower on the stand stands at ×1.83 with the fee where the rehearsal read it there: 12.9 %. */
    const times = open ? 1.83 : 1;
    return {
      network: 'solana:devnet',
      mint: launch.mint,
      pool: launch.pool,
      creator: launch.creator,
      name: launch.name,
      symbol: launch.symbol,
      metadataUri: '',
      pair: launch.pair,
      opensAt: launch.opensAt,
      phase: next !== null ? 'BUILDING' : open ? 'OPEN' : 'COUNTDOWN',
      next,
      fee: { startBps: terms.fee.startBps, endBps: launch.done.includes('POOL') ? 100.13 : null, nowBps: launch.done.includes('POOL') ? (open ? 1_292 : terms.fee.startBps) : null },
      price: { start: launch.done.includes('POOL') ? start : null, now: launch.done.includes('POOL') ? start * times : null },
      split: { creatorBps: terms.split.creatorBps, ryntraBps: terms.split.ryntraBps },
      /* A trading tower on the stand has sold its ladder's nearest price: what is left of it rests on the other four. */
      ladder: launch.ladder ? { ...ladderTold, leftRaw: launch.done.includes('SUPPLY') ? (open ? ((ladderRaw * 14n) / 15n).toString() : ladderRaw.toString()) : null, state: launch.done.includes('SUPPLY') ? (open ? 'SELLING' : 'RESTING') : null } : null,
      honest: next === null ? true : null,
      problems: [],
      receipt: { COIN: launch.steps.COIN, POOL: launch.steps.POOL, SUPPLY: launch.steps.SUPPLY },
      costLamports: '98419000',
      at: seconds(),
    };
  };
  const refusal = (code: string, message: string): Answer<never> => ({ ok: false, code, message });

  return {
    build: async (body) => {
      await wait();
      let launch: StubLaunch;
      if (body.mint) {
        const known = launches.get(body.mint);
        if (!known) return refusal('LAUNCH_NOT_FOUND', 'No launch of this coin here.');
        if (known.creator !== body.creator) return refusal('WALLET_MISMATCH', 'Another wallet.');
        launch = known;
      } else {
        const seed = `${launches.size}:${now()}`;
        const mint = stubAddress(`pool-mint:${seed}`);
        const words = (body.metadataUri ?? '').split('/').pop() ?? '';
        launch = { mint, pool: stubAddress(`pool:${seed}`), creator: body.creator, name: words.slice(0, 6) || 'Coin', symbol: 'COIN', pair: body.pair ?? 'SOL', opensAt: body.opensAt ?? seconds() + terms.opening.defaultAfter, ladder: body.ladder === true, done: [], createdAt: new Date(now()).toISOString(), steps: { COIN: [], POOL: [], SUPPLY: [] } };
        launches.set(mint, launch);
      }
      const stage = nextOf(launch);
      if (stage === null) return refusal('VALIDATION_ERROR', 'This launch is on chain whole; there is nothing left to sign.');
      const buildId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const wires = stubWires(stage, launch.creator, launch.mint, launch.pool, buildId, launch.ladder);
      builds.set(buildId, { mint: launch.mint, stage, creator: launch.creator, wires, used: false });
      const left = { COIN: 99_929_000, POOL: 95_408_000, SUPPLY: 88_031_000 }[stage];
      const data: LaunchPoolBuildResponse = {
        buildId,
        network: 'solana:devnet',
        stage,
        unsignedWireBase64: wires,
        mint: launch.mint,
        pool: launch.pool,
        pair: launch.pair,
        opensAt: launch.opensAt,
        feeLamports: stage === 'SUPPLY' ? 25_000 : stage === 'COIN' ? 10_000 : 5_000,
        rentLamports: stage === 'SUPPLY' ? 88_006_000 : stage === 'COIN' ? 4_511_000 : 8_763_000,
        remainingLamports: String(left),
        fee: { startBps: terms.fee.startBps, endBps: stage === 'COIN' ? null : 100.13, askedEndBps: terms.fee.endBps, priceMultiple: terms.fee.priceMultiple },
        split: { creatorBps: terms.split.creatorBps, ryntraBps: terms.split.ryntraBps },
        ladder: launch.ladder ? { ...ladderTold } : null,
        expiresAt: new Date(now() + 60_000).toISOString(),
        signableMs: 25_000,
      };
      return { ok: true, data };
    },
    submit: async (body) => {
      await wait(4);
      const build = builds.get(body.buildId);
      if (!build) return refusal('LAUNCH_NOT_FOUND', 'No build by that id.');
      if (build.used) return refusal('LAUNCH_BUILD_USED', 'This step was already sent.');
      if (body.creator !== build.creator) return refusal('WALLET_MISMATCH', 'Another wallet.');
      if (body.signedWireBase64.length !== build.wires.length || body.signedWireBase64.some((wire, index) => !wire.startsWith(build.wires[index]!.slice(0, 16)))) return refusal('LAUNCH_SIGNED_OTHER_BYTES', 'The signed bytes are not the built ones.');
      build.used = true;
      const launch = launches.get(build.mint)!;
      /* `&poolhalt=supply` on the stand: the supply's send lands in part — the launch waits half-way. */
      const halt = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('poolhalt') === build.stage.toLowerCase() && launch.steps[build.stage].length === 0;
      const signatures = build.wires.map((_, index) => stubSignature(`${body.buildId}:${index}`));
      launch.steps[build.stage] = halt ? signatures.slice(0, 1) : signatures;
      if (!halt) launch.done.push(build.stage);
      return { ok: true, data: { mint: launch.mint, pool: launch.pool, stage: build.stage, state: halt ? 'FAILED' : 'CONFIRMED', signatures: launch.steps[build.stage], reason: halt ? 'the stand dropped a transaction' : null, next: nextOf(launch), opensAt: launch.opensAt } };
    },
    view: async (mint) => {
      await wait(0.3);
      const launch = launches.get(mint);
      return launch ? { ok: true, data: viewOf(launch) } : refusal('LAUNCH_NOT_FOUND', 'No launch of this coin here.');
    },
    list: async () => {
      await wait(0.3);
      return { ok: true, data: { network: 'solana:devnet', launches: [...launches.values()].reverse().map(listed) } };
    },
  };
}

export { STUB_CREATOR };
