import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { earlyAccessSchedule, type EarlyAccessRules } from '../../../lib/core/launch/early-access.ts';
import { ALPHA_VAULT_PROGRAM, LANDS, walletAccount, type EntryKind } from './entry-check.ts';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
import type { EarlyView, EntryEngine } from './entry.ts';
import type { Answer } from './engine.ts';
import { stubAddress, stubSignature } from './stub.ts';

/**
 * The development stand-in for the people's early-access window (CITY-220) — never in a production bundle
 * (`district.ts` loads it beside the stub engine). One made-up launch at the moment the address asks for
 * (`&phase=soon|join|fill|wait|claim|refund|done`), its vault answering deposits and steps with bytes laid out as the
 * engine's, so the window's read of them (`entry-check.ts`) runs on the stand as on a network. Nothing here is sent.
 */

export type EntryStubPhase = 'soon' | 'join' | 'fill' | 'wait' | 'claim' | 'refund' | 'done';
export const ENTRY_STUB_MINT = stubAddress('early:KITE');
const VAULT = stubAddress('early:vault');
const POOL = stubAddress('early:pool');
const CREATOR = stubAddress('early:creator');
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (value: Uint8Array) => value as unknown as Buffer;

const DATA: Readonly<Record<EntryKind, readonly number[]>> = {
  DEPOSIT: [242, 35, 198, 137, 82, 225, 242, 182],
  WITHDRAW: [183, 18, 70, 156, 148, 109, 161, 34],
  WITHDRAW_REMAINING: [54, 253, 188, 34, 100, 145, 59, 127],
  CLAIM: [116, 206, 27, 191, 166, 19, 0, 73],
  FILL: [221, 175, 108, 48, 19, 204, 125, 23],
};
const WALLET_AT: Readonly<Record<EntryKind, number>> = { DEPOSIT: 7, WITHDRAW: 7, WITHDRAW_REMAINING: 7, CLAIM: 6, FILL: 15 };

/** A step's bytes as the engine lays them: the wallet pays and signs; the vault first, the wallet where the IDL puts it. */
function stepWire(kind: EntryKind, wallet: string, amountRaw: string | null): string {
  const program = new PublicKey(ALPHA_VAULT_PROGRAM);
  const owner = new PublicKey(wallet);
  const data = new Uint8Array(kind === 'DEPOSIT' || kind === 'WITHDRAW' || kind === 'FILL' ? 16 : 8);
  data.set(DATA[kind]);
  if (data.length === 16) new DataView(data.buffer).setBigUint64(8, BigInt(amountRaw ?? '0'), true);
  const keys = Array.from({ length: Math.max(WALLET_AT[kind] + 1, 10) }, (_, i) => ({ pubkey: new PublicKey(stubAddress(`early:account:${kind}:${i}`)), isSigner: false, isWritable: i < 4 }));
  keys[0] = { pubkey: new PublicKey(VAULT), isSigner: false, isWritable: true };
  keys[WALLET_AT[kind]] = { pubkey: owner, isSigner: true, isWritable: true };
  const lands = LANDS[kind];
  if (lands) {
    keys[lands.tokenProgram] = { pubkey: new PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false };
    keys[lands.destination] = { pubkey: new PublicKey(walletAccount(wallet, keys[lands.mint]!.pubkey.toBase58(), TOKEN_PROGRAM)!), isSigner: false, isWritable: true };
  }
  const tx = new Transaction({ feePayer: owner, recentBlockhash: stubAddress(`early:blockhash:${kind}:${amountRaw}`) }).add(new TransactionInstruction({ programId: program, keys, data: bytes(data) }));
  return toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

export function stubEntryEngine(options: Readonly<{ phase: EntryStubPhase; delayMs?: number; now?: () => number }>): EntryEngine {
  const now = options.now ?? Date.now;
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 0));
  const t = Math.floor(now() / 1000);
  /* The deposit window opens or closes around now as the phase asks; the schedule follows from the rules. */
  const startsAt = { soon: t + 9 * 60, join: t - 20 * 60, fill: t - 100 * 60, wait: t - 100 * 60, claim: t - 4 * 3600, refund: t - 4 * 3600, done: t - 4 * 3600 }[options.phase];
  const rules: EarlyAccessRules = { mode: 'PRO_RATA', depositStartsAt: startsAt, depositEndsAt: startsAt + 3600, maxCapRaw: '5000000000', individualCapRaw: null, vestingHours: 0, startMarketCapUsd: 50_000, supply: 1_000_000_000 };
  let deposited = options.phase === 'soon' ? 0n : 3_200_000_000n;
  let mine = ['join', 'soon'].includes(options.phase) ? 0n : 100_000_000n;
  let filled = ['wait', 'claim', 'refund', 'done'].includes(options.phase);
  let claimable = options.phase === 'claim' ? 18_750_000_000_000n : 0n;
  let remaining = options.phase === 'refund' ? 40_000_000n : 0n;
  const built = new Map<string, { kind: EntryKind; amountRaw: string | null }>();
  const view = (wallet: string | null): EarlyView => ({
    network: 'solana:devnet',
    mint: ENTRY_STUB_MINT,
    pool: POOL,
    vault: VAULT,
    creator: CREATOR,
    name: 'Kite',
    symbol: 'KITE',
    rules,
    schedule: earlyAccessSchedule(rules),
    lines: { uk: [], en: [] },
    state: options.phase === 'soon' ? 'UPCOMING' : options.phase === 'join' ? 'DEPOSITS' : options.phase === 'fill' || options.phase === 'wait' ? 'FILLING' : 'VESTING',
    creation: { state: 'OPEN', steps: { MINT: { signature: null, state: 'CONFIRMED', reason: null }, POOL: { signature: null, state: 'CONFIRMED', reason: null }, VAULT: { signature: null, state: 'CONFIRMED', reason: null } } },
    terms: { startPriceUsd: 0.00005, presaleBps: 1_000, ryntraShareBps: 0, atCap: { spentRaw: '0', feeRaw: '0', tokensOutRaw: '0', shareBps: 0, averagePriceUsd: 0, priceAfterUsd: 0, marketCapAfterUsd: 0, refundRaw: '0' } },
    read: 'OK',
    depositedRaw: deposited.toString(),
    capRaw: rules.maxCapRaw,
    depositors: '23',
    boughtRaw: filled ? '75000000000000' : '0',
    filled,
    atDeposited: null,
    chainProblems: [],
    mine: wallet ? { depositedRaw: mine.toString(), claimableRaw: claimable.toString(), claimedRaw: '0', allocatedRaw: claimable.toString(), remainingQuoteRaw: remaining.toString(), roomRaw: null, refunded: false } : null,
  });
  const make = (kind: EntryKind, wallet: string, amountRaw: string | null) => {
    const buildId = stubAddress(`early:build:${built.size}`).slice(0, 32).toLowerCase().replace(/[^0-9a-f]/g, 'a');
    built.set(buildId, { kind, amountRaw });
    return { buildId, network: 'solana:devnet' as const, unsignedWireBase64: stepWire(kind, wallet, amountRaw), expiresAt: new Date(now() + 60_000).toISOString(), signableMs: 25_000 };
  };
  const sent = (buildId: string): Answer<{ state: 'CONFIRMED'; signature: string }> => {
    const step = built.get(buildId);
    if (!step) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No build by that id.' };
    built.delete(buildId);
    if (step.kind === 'DEPOSIT') {
      deposited += BigInt(step.amountRaw ?? '0');
      mine += BigInt(step.amountRaw ?? '0');
    }
    if (step.kind === 'WITHDRAW') {
      deposited -= mine;
      mine = 0n;
    }
    if (step.kind === 'FILL') filled = true;
    if (step.kind === 'CLAIM') claimable = 0n;
    if (step.kind === 'WITHDRAW_REMAINING') remaining = 0n;
    return { ok: true, data: { state: 'CONFIRMED', signature: stubSignature(`early:${buildId}`) } };
  };
  return {
    view: async (mint, wallet) => (await wait(), mint === ENTRY_STUB_MINT ? { ok: true, data: view(wallet) } : { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No early-access launch of this token here.' }),
    depositBuild: async (_mint, body) => (await wait(), { ok: true, data: { ...make('DEPOSIT', body.wallet, body.amountRaw), escrow: stubAddress('early:escrow'), opensEscrow: mine === 0n, amountRaw: body.amountRaw } }),
    depositSubmit: async (_mint, body) => (await wait(), await wait(), sent(body.buildId)),
    actionBuild: async (_mint, body) => {
      await wait();
      const amountRaw = body.action === 'CLAIM' ? claimable.toString() : body.action === 'WITHDRAW_REMAINING' ? remaining.toString() : body.action === 'WITHDRAW' ? (body.amountRaw ?? mine.toString()) : null;
      return { ok: true, data: { ...make(body.action, body.wallet, body.action === 'WITHDRAW' ? amountRaw : body.action === 'FILL' ? deposited.toString() : null), action: body.action, amountRaw } };
    },
    actionSubmit: async (_mint, body) => (await wait(), await wait(), sent(body.buildId)),
  };
}
