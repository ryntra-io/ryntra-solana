import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { FeeShare } from '../../../lib/core/launch/fee-shares.ts';
import { BONDING_CURVE_PROGRAM, FEE_SHARING_PROGRAM } from './split-check.ts';

/**
 * The development stand-in's bytes for a launch (CITY-212, CITY-220) — never in a production bundle (`stub.ts` loads it).
 * A creation and a sharing laid out as the engine lays them (`lib/core/venues/meteora-dbc/fee-sharing.server.ts`), with
 * made-up keys and no signatures, so the sheet's read of the sharing (`split-check.ts`) runs on the stand as on a
 * network. Nothing here is ever sent.
 */

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const PAIR = new PublicKey('So11111111111111111111111111111111111111112');
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
/* The bytes as web3.js's instruction takes them: it encodes them, never needs Node's own Buffer, so the stand needs no polyfill. */
const bytes = (value: Uint8Array) => value as unknown as Buffer;

/** The coin as the stand stored it: its name, ticker and metadata address, laid into the creation as the engine lays them. */
export type StubCoin = Readonly<{ name: string; symbol: string; uri: string }>;

export function stubSplitWires(args: Readonly<{ creator: string; token: string; feeVault: string; blockhash: string; shares: readonly FeeShare[]; filler: (seed: string) => string; coin: StubCoin }>): Readonly<{ creation: string; split: string }> {
  const creator = new PublicKey(args.creator);
  const token = new PublicKey(args.token);
  const vault = new PublicKey(args.feeVault);
  const key = (seed: string) => new PublicKey(args.filler(seed));

  const creation = stubCreation({ creator: args.creator, token: args.token, blockhash: args.blockhash, filler: args.filler, coin: args.coin });
  /* `initialize_fee_vault_pda`: the discriminator, eight zero u64s, then the users — each a key and a u32 share. */
  const data = new Uint8Array(8 + 64 + 4 + 36 * args.shares.length);
  data.set([250, 250, 156, 113, 88, 143, 60, 233]);
  const view = new DataView(data.buffer);
  view.setUint32(72, args.shares.length, true);
  args.shares.forEach((share, i) => {
    data.set(new PublicKey(share.address).toBytes(), 76 + 36 * i);
    view.setUint32(76 + 36 * i + 32, share.bps, true);
  });
  const program = new PublicKey(FEE_SHARING_PROGRAM);
  const curve = new PublicKey(BONDING_CURVE_PROGRAM);
  const init = new TransactionInstruction({
    programId: program,
    data: bytes(data),
    keys: [
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: key('vault-authority'), isSigner: false, isWritable: false },
      { pubkey: key('token-vault'), isSigner: false, isWritable: true },
      { pubkey: PAIR, isSigner: false, isWritable: false },
      { pubkey: creator, isSigner: false, isWritable: false },
      { pubkey: token, isSigner: true, isWritable: false },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: key('dfs-events'), isSigner: false, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: false },
    ],
  });
  const handover = new TransactionInstruction({
    programId: curve,
    data: bytes(Uint8Array.from([20, 7, 169, 33, 58, 147, 166, 33])),
    keys: [
      { pubkey: key('pool'), isSigner: false, isWritable: true },
      { pubkey: key('config'), isSigner: false, isWritable: false },
      { pubkey: creator, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: key('dbc-events'), isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: false },
    ],
  });
  const split = new Transaction({ feePayer: creator, recentBlockhash: args.blockhash }).add(init, handover);
  return { creation: wire(creation), split: wire(split) };
}

const wire = (tx: Transaction) => toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));

/** What the stand's pool payer is handed in a creation, lamports — the cost line's own figure. */
export const STUB_PAYER_COVERED = 7_350_240;

/**
 * A creation laid out as the engine lays it (CITY-220): Ryntra's pool payer pays; the creator hands it the rent; the
 * bonding curve's `initialize_virtual_pool_with_token2022` names the config, the creator and the new mint — so the
 * sheet's read of the creation (`create-check.ts`) runs on the stand as on a network.
 */
/** `InitializePoolParameters`: three Borsh strings — a u32 length, then UTF-8 — after the discriminator. */
function poolParams(coin: StubCoin): Uint8Array {
  const parts = [coin.name, coin.symbol, coin.uri].map((text) => new TextEncoder().encode(text));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + 4 + part.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const part of parts) {
    view.setUint32(at, part.length, true);
    out.set(part, at + 4);
    at += 4 + part.length;
  }
  return out;
}

function stubCreation(args: Readonly<{ creator: string; token: string; blockhash: string; filler: (seed: string) => string; coin: StubCoin }>): Transaction {
  const creator = new PublicKey(args.creator);
  const token = new PublicKey(args.token);
  const key = (seed: string) => new PublicKey(args.filler(seed));
  const payer = key('payer');
  const curve = new PublicKey(BONDING_CURVE_PROGRAM);
  const create = new TransactionInstruction({
    programId: curve,
    data: bytes(Uint8Array.from([169, 118, 51, 78, 145, 110, 220, 155, ...poolParams(args.coin)])),
    keys: [
      { pubkey: key('config'), isSigner: false, isWritable: false },
      { pubkey: key('pool-authority'), isSigner: false, isWritable: false },
      { pubkey: creator, isSigner: true, isWritable: false },
      { pubkey: token, isSigner: true, isWritable: true },
      { pubkey: PAIR, isSigner: false, isWritable: false },
      { pubkey: key('pool'), isSigner: false, isWritable: true },
      { pubkey: key('base-vault'), isSigner: false, isWritable: true },
      { pubkey: key('quote-vault'), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: key('dbc-events'), isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: false },
    ],
  });
  return new Transaction({ feePayer: payer, recentBlockhash: args.blockhash }).add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: payer, lamports: STUB_PAYER_COVERED }), create);
}

/** The stand's creation of a launch that shares nothing, as its wire. */
export function stubCreationWire(args: Readonly<{ creator: string; token: string; blockhash: string; filler: (seed: string) => string; coin: StubCoin }>): string {
  return wire(stubCreation(args));
}

/** Three made-up transactions of an early-access creation, each paid by the creator and naming its new account. */
export function stubEarlyWires(args: Readonly<{ creator: string; mint: string; pool: string; vault: string; blockhash: string }>): readonly string[] {
  const creator = new PublicKey(args.creator);
  const step = (account: string, signer: boolean) => {
    const tx = new Transaction({ feePayer: creator, recentBlockhash: args.blockhash }).add(
      new TransactionInstruction({ programId: SystemProgram.programId, data: bytes(new Uint8Array(4)), keys: [{ pubkey: creator, isSigner: true, isWritable: true }, { pubkey: new PublicKey(account), isSigner: signer, isWritable: true }] }),
    );
    return toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  };
  return [step(args.mint, true), step(args.pool, false), step(args.vault, false)];
}
