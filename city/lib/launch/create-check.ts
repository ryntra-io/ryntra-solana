import { VersionedTransaction } from '@solana/web3.js';
import { ATTRIBUTION_REGISTRY } from '../../../lib/attribution/registry.ts';
import type { Network } from './engine.ts';

/**
 * A launch's creation, read before the wallet sees it (CITY-220). The review showed one launch: this coin, on this
 * preset, by this creator, buying nothing. The engine builds the bytes and checks them itself (`honestLaunchProblems`,
 * `signedAsBuilt`); this is the city's own look, so bytes for another curve never reach the creator's wallet:
 *
 * - three signers and no more: Ryntra's pool payer (it pays the fee and the rent), the creator and the new mint;
 * - the creator hands the pool payer exactly what the review counted (`payerCoveredLamports`), and nothing else moves;
 * - one instruction of the bonding curve, the pool's creation — never a swap (the city's launch buys nothing at birth);
 * - that creation names the creator, the coin, and — on mainnet — the very config of the preset the review showed, as
 *   the published registry names it. With the shield on (`shield.ts`) that config is Classic's, whose fee schedule on
 *   chain is the halo's (bots pay 20 % falling to 1 % over two minutes: `create-check.test.mjs` reads it from mainnet's
 *   recorded config). On the devnet stand the configs are the stand's own and only the rest is read;
 * - its name, ticker and metadata address are exactly the ones the review showed — the details the engine stored for
 *   this launch (review 8.11), so a coin under another name or with other metadata never reaches the wallet.
 *
 * The layouts are the program's IDL (`@meteora-ag/dynamic-bonding-curve-sdk` `initialize_virtual_pool_with_*`); the test
 * builds the engine's real creation on mainnet's recorded configs and checks this reader against it.
 */

export const CURVE_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** The pool's creation, by token program: its discriminator and where its accounts stand. */
const CREATIONS = [
  { name: 'initialize_virtual_pool_with_token2022', data: [169, 118, 51, 78, 145, 110, 220, 155], at: { config: 0, creator: 2, mint: 3, payer: 8 } },
  { name: 'initialize_virtual_pool_with_spl_token', data: [140, 85, 215, 176, 102, 54, 104, 79], at: { config: 0, creator: 2, mint: 3, payer: 10 } },
] as const;

/**
 * The most the creator may hand the pool payer, whatever the engine's answer says: the pool's rent is about 0.0074 SOL,
 * so 0.05 SOL leaves room for the rent to change and never lets an answer turn the launch into a payment.
 */
export const MAX_COVERED_LAMPORTS = 50_000_000n;

/** The pool payer on mainnet, as the published registry names it — the engine refuses any other one itself. */
export function poolPayer(network: Network): string | null {
  if (network !== 'solana:mainnet') return null;
  return ATTRIBUTION_REGISTRY.find((row) => row.id === 'solana-launch-pool-payer' && row.end === null)?.address ?? null;
}

export type CreationCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

/** What the review showed of the coin: the name, the ticker and the metadata address the engine stored for it. */
export type ReviewedCoin = Readonly<{ name: string; symbol: string; uri: string }>;

/**
 * The creation's `InitializePoolParameters` — `name`, `symbol`, `uri`, each a Borsh string (a u32 length, then UTF-8) —
 * after the 8-byte discriminator, and nothing after them; null when the bytes do not read so.
 */
export function creationParams(data: Uint8Array): ReviewedCoin | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = new TextDecoder('utf-8', { fatal: true });
  const out: string[] = [];
  let at = 8;
  try {
    for (let i = 0; i < 3; i += 1) {
      if (at + 4 > data.length) return null;
      const length = view.getUint32(at, true);
      at += 4;
      if (length > 512 || at + length > data.length) return null;
      out.push(text.decode(data.subarray(at, at + length)));
      at += length;
    }
  } catch {
    return null;
  }
  return at === data.length ? { name: out[0]!, symbol: out[1]!, uri: out[2]! } : null;
}

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const starts = (data: Uint8Array, prefix: readonly number[]) => prefix.every((byte, i) => data[i] === byte);

/** The config a preset launches on, as the published registry names it on mainnet; null on the stand (its own configs). */
export function presetConfig(network: Network, preset: string): string | null {
  if (network !== 'solana:mainnet') return null;
  return ATTRIBUTION_REGISTRY.find((row) => row.id === `solana-launch-config-${preset}` && row.end === null)?.address ?? null;
}

export function checkCreation(args: Readonly<{ wire: string; network: Network; preset: string; creator: string; token: string; payerCoveredLamports: string; coin: ReviewedCoin }>): CreationCheck {
  const no = (reason: string): CreationCheck => ({ ok: false, reason });
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(fromBase64(args.wire));
  } catch {
    return no('Unreadable transaction.');
  }
  const message = tx.message;
  if (message.addressTableLookups.length) return no('Unexpected lookup tables.');
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  const payer = keys[0]!;
  const signers = keys.slice(0, message.header.numRequiredSignatures);
  if (payer === args.creator || signers.length !== 3 || !signers.includes(args.creator) || !signers.includes(args.token)) return no('Unexpected signers.');
  const registeredPayer = poolPayer(args.network);
  if (args.network === 'solana:mainnet' && payer !== registeredPayer) return no('Another payer.');
  const want = args.network === 'solana:mainnet' ? presetConfig(args.network, args.preset) : null;
  if (args.network === 'solana:mainnet' && !want) return no('No config named for this preset.');

  let covered = 0n;
  let created = 0;
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const account = (at: number) => keys[ix.accountKeyIndexes[at] ?? -1];
    const data = ix.data;
    if (program === SYSTEM_PROGRAM) {
      /* `transfer`: u32 2, then the lamports as u64 — from the creator to the pool payer, once, before the creation. */
      if (created || covered || data.length !== 12 || new DataView(data.buffer, data.byteOffset, 12).getUint32(0, true) !== 2) return no('Unexpected transfer.');
      if (account(0) !== args.creator || account(1) !== payer) return no('Unexpected transfer.');
      covered = new DataView(data.buffer, data.byteOffset, 12).getBigUint64(4, true);
      if (covered === 0n) return no('Unexpected transfer.');
      continue;
    }
    if (program !== CURVE_PROGRAM) return no('Unexpected program.');
    const kind = CREATIONS.find((entry) => starts(data, entry.data));
    /* A swap here would be a first purchase the review never showed; anything else is not a launch. */
    if (!kind || created) return no('Not the launch the review showed.');
    created += 1;
    if (account(kind.at.creator) !== args.creator || account(kind.at.mint) !== args.token) return no('Another launch.');
    if (account(kind.at.payer) !== payer) return no('Another payer.');
    if (want && account(kind.at.config) !== want) return no('Another curve.');
    const coin = creationParams(data);
    if (!coin || coin.name !== args.coin.name || coin.symbol !== args.coin.symbol || coin.uri !== args.coin.uri) return no('Another coin.');
  }
  if (!created) return no('Not the launch the review showed.');
  if (!/^\d{1,20}$/.test(args.payerCoveredLamports) || covered !== BigInt(args.payerCoveredLamports)) return no('Another amount.');
  if (covered > MAX_COVERED_LAMPORTS) return no('Another amount.');
  return { ok: true };
}
