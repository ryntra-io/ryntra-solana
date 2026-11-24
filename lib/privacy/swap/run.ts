/**
 * A swap from the private balance, run: out of the ring → the market route → back into the ring, under one wallet
 * approval. The way is `plan.ts`'s; where the coins are after any break is `recover.ts`'s, read from the chain. Nothing
 * here keeps a key: the keys are the private balance's (`flows.ts`), the signature is the person's wallet.
 *
 * In order, and nothing signed before the last check:
 * 1. The rules before money (`passGate`) at both ends: out of the ring goes to the person's own wallet only — always
 *    open; back into the ring is a «Hide», so a pause, a flagged address or a check that did not answer refuses the
 *    whole swap here, before anything moves (a swap that could leave the ring but not come back is never started).
 *    The swap adds no new money to the balance, so the cap is asked with nothing new (`amount: 0`).
 * 2. The ring's sides are built — the withdrawal's proof is computed here, up to 20 seconds (`stage: 'proving'`).
 * 3. The way is chosen; one transaction is compiled and simulated, or the three of the pack are put together.
 * 4. The wallet signs once — one transaction, or three in one approval; each answer must carry the same bytes.
 * 5. The record of signatures is handed to `remember` before anything is sent, so a closed tab finds its way back.
 * 6. Sent one by one, each once; a step that does not confirm is never sent again — the chain is read instead.
 *
 * The route is the open swap's own exact order (`route.ts`): the same Jupiter route and the same Ryntra fee as a swap
 * in the open. Out goes to the person's own address only — nothing here sends to another address.
 */

import { PrivateError, passGate, submit, sync, type Book, type Ctx, type Landed, type PrivateSigner } from '../flows.ts';
import { choosePath, depositAmount, type EdgeShape, type Holding, type Path } from './plan.ts';
import { factsOf, onChainOf, whereAreCoins, type ChainRead, type PackFacts, type PackRecord, type Where } from './recover.ts';
import { boughtAccount, routeInstructions, routeOf } from './route.ts';
import { PRIVATE_CHAIN, RING_SOL } from '../network.ts';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EpFLC1PTNBfn9oCrxDNSRF';

/** The most blocks a blockhash lives (150) with room: the ceiling for a step that does not say its own. */
export const BLOCKHASH_LIFE = 300n;

/** The wallet as a swap needs it: one transaction, or several in one approval when the wallet can. */
export type SwapSigner = PrivateSigner &
  Readonly<{
    /** Signs these whole wire transactions in one approval and returns them signed, in order. */
    signWires?: (wires: readonly Uint8Array[]) => Promise<readonly Uint8Array[]>;
  }>;

/** The open swap's exact order, as the swap's card holds it. */
export type OpenOrder = Readonly<{
  /** The order's exact bytes (version 0), assembled for this wallet with Ryntra's fee in them. */
  wireBase64: string;
  lastValidBlockHeight: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  /** The route's minimum (`otherAmountThreshold`). */
  minReceivedRaw: string;
  /** The network the order was built for, as `solana:mainnet`. */
  chain: string;
}>;

/** What the screen shows while the swap runs. */
export type Stage = 'checking' | 'proving' | 'signing' | 'sending' | 'reading';

export type Abilities = Readonly<{ canOne: boolean; canPack: boolean }>;

/**
 * What this build and this wallet can do. One transaction needs the SDK's own v1 compiler and a message decoder in the
 * bundle (`scripts/privacy/vendor/entry.mjs` — the bundle of 18.11 has neither, so today a swap goes the pack's way);
 * the pack needs a wallet that signs several transactions in one approval.
 */
export function abilities(ctx: Ctx, wallet: SwapSigner): Abilities {
  const { sdk } = ctx;
  return {
    canOne: typeof sdk.compileUnsignedTransaction === 'function' && typeof sdk.getCompiledTransactionMessageDecoder === 'function' && typeof sdk.decompileTransactionMessage === 'function',
    canPack: typeof wallet.signWires === 'function',
  };
}

/** Wrapped SOL — how the market's routes name SOL; the ring names it by the system program (`RING_SOL`). */
export const WSOL = 'So11111111111111111111111111111111111111112';

/** SOL in the ring's own balance list. */
const solMintOf = (ctx: Ctx) => String(ctx.sdk.SOL_MINT ?? RING_SOL);
/** SOL by any of its names: plain lamports on the wallet, the ring's SOL, wrapped SOL in a route. */
const isSol = (ctx: Ctx, mint: string) => mint === WSOL || mint === RING_SOL || mint === solMintOf(ctx);

/** How a coin is held: SOL itself, or the token program that owns its mint (read from the chain). */
export async function holdingOf(ctx: Ctx, mint: string): Promise<Readonly<{ holding: Holding; program: string | null }>> {
  if (isSol(ctx, mint)) return { holding: 'native', program: null };
  const { value } = await ctx.client.solanaRpc.getAccountInfo(mint, { encoding: 'base64', commitment: 'confirmed' }).send();
  const owner = value ? String(value.owner) : null;
  if (owner === TOKEN_2022_PROGRAM) return { holding: 'token2022', program: owner };
  if (owner === TOKEN_PROGRAM) return { holding: 'classic', program: owner };
  throw new PrivateError('SEND_FAILED', 'the coin is not a token this network knows');
}

/** The person's own token account in a coin, read from the chain; null when they hold none. */
export async function tokenAccountOf(ctx: Ctx, owner: string, mint: string): Promise<Readonly<{ account: string; amount: bigint }> | null> {
  const { value } = await ctx.client.solanaRpc.getTokenAccountsByOwner(owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }).send();
  let best: { account: string; amount: bigint } | null = null;
  for (const entry of value as readonly { pubkey: string; account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[]) {
    const amount = BigInt(entry.account.data.parsed?.info?.tokenAmount?.amount ?? '0');
    if (!best || amount > best.amount) best = { account: String(entry.pubkey), amount };
  }
  return best;
}

/** The person's own wallet in a coin, in its smallest units (SOL in lamports). */
export async function walletHeld(ctx: Ctx, owner: string, mint: string): Promise<bigint> {
  if (isSol(ctx, mint)) return BigInt(await ctx.client.getBalance(owner));
  return (await tokenAccountOf(ctx, owner, mint))?.amount ?? 0n;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** The swap as asked. */
export type SwapAsk = Readonly<{
  ringChain?: string;
  ctx: Ctx;
  book: Book;
  wallet: SwapSigner;
  order: OpenOrder;
  /**
   * The card's order as it stands now — the card renews its bytes about every thirty seconds, and the proof may take
   * twenty: after the proof the freshest order of the same pair and amount is taken, so the swap's bytes do not expire
   * before they are sent. Absent, or another pair or amount, the order asked with stays.
   */
  fresh?: () => OpenOrder | null;
  on?: (stage: Stage) => void;
  remember?: (record: PackRecord) => Promise<void> | void;
}>;

export type SwapEnd = Readonly<{ path: Path; record: PackRecord | null; where: Where }>;

/** The rules at both ends, asked before anything is built or signed. */
export async function gateBothEnds(ctx: Ctx, book: Book, owner: string): Promise<void> {
  // Out of the ring: to the person's own wallet — always open, nothing asked.
  await passGate(ctx, { kind: 'return', owner, to: owner });
  // Back in: a «Hide». Nothing new enters the balance — the swap moves what is already there.
  const solHeld = async () => (await sync(ctx, book)).find((h) => h.mint === solMintOf(ctx))?.amount ?? 0n;
  await passGate(ctx, { kind: 'hide', owner, amount: 0n }, solHeld);
}

/** Runs the swap; ends with where the coins are, read from the chain. */
export async function swapPrivately(ask: SwapAsk): Promise<SwapEnd> {
  const { ctx, book, wallet } = ask;
  let order = ask.order;
  const on = ask.on ?? (() => undefined);
  const owner = wallet.address;
  const { sdk, client } = ctx;
  const inMint = order.inputMint;
  const outMint = order.outputMint;
  const outAmount = BigInt(order.inAmountRaw);
  let inAmount = depositAmount(order.minReceivedRaw);

  on('checking');
  const ringChain = ask.ringChain ?? PRIVATE_CHAIN;
  // Another network than the private balance's: said at once, before the chain is asked about coins it does not have.
  if (order.chain !== ringChain) return { path: { kind: 'refuse', code: 'ELSEWHERE' }, record: null, where: { place: 'private', done: false } };
  const route = routeOf(order.wireBase64);
  const [inHold, outHold] = await Promise.all([holdingOf(ctx, inMint), holdingOf(ctx, outMint)]);
  const can = abilities(ctx, wallet);
  // A refusal that needs no proof is said before the gate and before 20 seconds of proving.
  const early = choosePath({ owner, inMint, outMint, inHolding: inHold.holding, outHolding: outHold.holding, routeChain: order.chain, ringChain, edge: { addresses: [], bytes: 0 }, route, canOne: can.canOne, canPack: can.canPack });
  if (early.kind === 'refuse') return { path: early, record: null, where: { place: 'private', done: false } };
  await gateBothEnds(ctx, book, owner);

  on('proving');
  const bought = isSol(ctx, outMint) ? null : (boughtAccount(order.wireBase64, owner, outMint) ?? (await tokenAccountOf(ctx, owner, outMint).then((a) => (a ? { account: a.account, program: outHold.program ?? TOKEN_PROGRAM } : null))));
  if (!isSol(ctx, outMint) && !bought) throw new PrivateError('SEND_FAILED', 'the route opens no account for the coin bought');
  const withdrawal = await sdk.buildWithdrawalTransaction({
    client,
    wallet: book.wallet,
    keys: book.keys,
    feePayer: owner,
    recipient: owner,
    amount: outAmount,
    ...(isSol(ctx, inMint) ? {} : { asset: inMint, splTokenProgram: inHold.program }),
  });
  // The proof took its time: the card's freshest bytes for the same pair and amount, if it renewed them meanwhile.
  const renewed = ask.fresh?.() ?? null;
  if (renewed && renewed.inputMint === inMint && renewed.outputMint === outMint && renewed.inAmountRaw === order.inAmountRaw && renewed.chain === order.chain) {
    order = renewed;
    inAmount = depositAmount(order.minReceivedRaw);
  }
  // A transaction that does not say how long it lives is counted to live the longest a blockhash can, never shorter:
  // a step read as expired too early would offer to return coins that are still landing.
  const ceiling = BigInt(await client.solanaRpc.getBlockHeight({ commitment: 'confirmed' }).send()) + BLOCKHASH_LIFE;
  const lastValidOf = (tx: unknown) => {
    const height = (tx as { lifetimeConstraint?: { lastValidBlockHeight?: bigint | number } } | null)?.lifetimeConstraint?.lastValidBlockHeight;
    return height === undefined ? ceiling : BigInt(height);
  };
  const deposit = (setupInstructions?: readonly unknown[]) =>
    sdk.buildDepositTransaction({
      client,
      feePayer: owner,
      depositor: owner,
      recipient: book.keys.address(),
      amount: inAmount,
      ...(bought ? { asset: outMint, splTokenAccount: bought.account, splTokenProgram: bought.program } : {}),
      ...(setupInstructions ? { setupInstructions } : {}),
    });

  let path: Path = early;
  let one: unknown = null;
  let oneLastValid = ceiling;
  if (can.canOne && early.kind === 'one') {
    const instructionsOf = (tx: { messageBytes: Uint8Array }) => sdk.decompileTransactionMessage(sdk.getCompiledTransactionMessageDecoder().decode(tx.messageBytes)).instructions as readonly unknown[];
    const withdrawIx = instructionsOf(withdrawal);
    const edgeTx = await deposit(withdrawIx);
    const compiled = sdk.getCompiledTransactionMessageDecoder().decode(edgeTx.messageBytes) as { staticAccounts: readonly string[] };
    const edge: EdgeShape = { addresses: compiled.staticAccounts.map(String), bytes: new Uint8Array(sdk.getTransactionEncoder().encode(edgeTx)).length };
    path = choosePath({ owner, inMint, outMint, inHolding: inHold.holding, outHolding: outHold.holding, routeChain: order.chain, ringChain, edge, route, canOne: true, canPack: can.canPack });
    if (path.kind === 'one') {
      try {
        const depositIx = instructionsOf(await deposit());
        const { value: lifetime } = await client.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
        oneLastValid = BigInt(lifetime.lastValidBlockHeight);
        one = sdk.compileUnsignedTransaction({ feePayer: owner, lifetime, instructions: [...withdrawIx, ...routeInstructions(order.wireBase64), ...depositIx], computeUnitLimit: path.computeUnits });
        const wire = toBase64(new Uint8Array(sdk.getTransactionEncoder().encode(one)));
        const simulated = await client.solanaRpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }).send();
        if (simulated.value?.err) throw new Error('the one transaction does not simulate');
      } catch {
        // Larger than v1 allows once compiled, or it does not simulate: the pack, or an honest refusal.
        one = null;
        path = can.canPack ? { kind: 'pack', why: 'BYTES' } : { kind: 'refuse', code: 'ONE_PROMPT', why: 'BYTES' };
      }
    }
  }
  if (path.kind === 'refuse') return { path, record: null, where: { place: 'private', done: false } };
  const facts: PackFacts = { inMint, outMint, outAmount, inAmount, solMint: isSol(ctx, inMint) ? inMint : isSol(ctx, outMint) ? outMint : WSOL };
  const recordFacts = { inMint, outMint, outAmount: outAmount.toString(), inAmount: inAmount.toString(), solMint: facts.solMint };

  if (one) {
    on('signing');
    const landed: Landed = await submit(ctx, one, {
      wallet: {
        address: owner,
        signWire: async (wire) => {
          const signed = await wallet.signWire(wire);
          const sig = sdk.getSignatureFromTransaction(sdk.getTransactionDecoder().decode(signed)) as string;
          await ask.remember?.({ v: 1, kind: 'one', owner, signatures: [sig], lastValidBlockHeight: String(oneLastValid), facts: recordFacts });
          on('sending');
          return signed;
        },
      },
    });
    if (isSol(ctx, inMint)) ctx.gate?.landed('out', outAmount);
    if (isSol(ctx, outMint)) ctx.gate?.landed('in', inAmount);
    on('reading');
    const record: PackRecord = { v: 1, kind: 'one', owner, signatures: [landed.signature], lastValidBlockHeight: String(oneLastValid), facts: recordFacts };
    return { path, record, where: await readWhere(ctx, record) };
  }

  // The pack: out (v1) · the open order (v0) · in (v1), signed in one approval.
  const signWires = wallet.signWires;
  if (!signWires) return { path: { kind: 'refuse', code: 'ONE_PROMPT', why: path.kind === 'pack' ? path.why : 'NO_ONE' }, record: null, where: { place: 'private', done: false } };
  const inTx = await deposit();
  const built: Uint8Array[] = [
    new Uint8Array(sdk.getTransactionEncoder().encode(withdrawal)),
    fromBase64(order.wireBase64),
    new Uint8Array(sdk.getTransactionEncoder().encode(inTx)),
  ];
  on('signing');
  let signed: readonly Uint8Array[];
  try {
    signed = await signWires(built);
  } catch (error) {
    throw new PrivateError('WALLET_REFUSED', error instanceof Error ? error.message : String(error));
  }
  if (signed.length !== built.length) throw new PrivateError('WALLET_REFUSED');
  const decoder = sdk.getTransactionDecoder();
  const signatures = signed.map((wire, i) => {
    const before = decoder.decode(built[i]);
    const after = decoder.decode(wire);
    if (!sameBytes(new Uint8Array(after.messageBytes), new Uint8Array(before.messageBytes))) throw new PrivateError('WALLET_CHANGED_MESSAGE');
    return sdk.getSignatureFromTransaction(after) as string;
  });
  const lastValid = [lastValidOf(withdrawal), lastValidOf(inTx), BigInt(order.lastValidBlockHeight)].reduce((a, b) => (b > a ? b : a), 0n);
  const record: PackRecord = { v: 1, kind: 'pack', owner, signatures, lastValidBlockHeight: lastValid.toString(), facts: recordFacts };
  await ask.remember?.(record);

  on('sending');
  for (let i = 0; i < signed.length; i++) {
    try {
      await client.solanaRpc.sendTransaction(toBase64(signed[i]), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
      await client.confirmTransaction(signatures[i]);
    } catch {
      // Never sent again: whatever happened, the chain says where the coins are.
      break;
    }
    if (i === 0 && isSol(ctx, inMint)) ctx.gate?.landed('out', outAmount);
    if (i === 2 && isSol(ctx, outMint)) ctx.gate?.landed('in', inAmount);
  }
  on('reading');
  return { path, record, where: await readWhere(ctx, record) };
}

/** What the chain says of a record now. */
export async function readChain(ctx: Ctx, record: PackRecord): Promise<ChainRead> {
  const { client } = ctx;
  const facts = factsOf(record);
  const { value: statuses } = await client.solanaRpc.getSignatureStatuses(record.signatures, { searchTransactionHistory: true }).send();
  const steps = (statuses as readonly ({ err?: unknown; confirmationStatus?: string | null } | null)[]).map((s) => ({ status: onChainOf(s) }));
  const height = BigInt(await client.solanaRpc.getBlockHeight({ commitment: 'confirmed' }).send());
  const expired = height > BigInt(record.lastValidBlockHeight);
  const [inHeld, outHeld] = await Promise.all([walletHeld(ctx, record.owner, facts.inMint), walletHeld(ctx, record.owner, facts.outMint)]);
  const swapStep = record.kind === 'pack' ? steps[1] : steps[0];
  const received = swapStep?.status === 'landed' ? await receivedBy(ctx, record.signatures[record.kind === 'pack' ? 1 : 0], record.owner, facts.outMint) : null;
  return record.kind === 'pack'
    ? { kind: 'pack', out: steps[0], swap: steps[1], in: steps[2], expired, wallet: { inMint: inHeld, outMint: outHeld }, received }
    : { kind: 'one', out: steps[0], expired, wallet: { inMint: inHeld, outMint: outHeld }, received };
}

/** What the swap paid the person in the coin bought, from its own transaction on chain; null when unreadable. */
export async function receivedBy(ctx: Ctx, signature: string, owner: string, mint: string): Promise<bigint | null> {
  try {
    const tx = await ctx.client.solanaRpc.getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }).send();
    const meta = tx?.meta;
    if (!meta) return null;
    if (isSol(ctx, mint)) {
      // The fee payer is the person: what came in, the fee given back. Rent the route spent counts against it — never more.
      const delta = BigInt(meta.postBalances[0]) - BigInt(meta.preBalances[0]) + BigInt(meta.fee);
      return delta > 0n ? delta : 0n;
    }
    const sum = (list: readonly { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }[] | undefined) =>
      (list ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((s, b) => s + BigInt(b.uiTokenAmount?.amount ?? '0'), 0n);
    const delta = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
    return delta > 0n ? delta : 0n;
  } catch {
    return null;
  }
}

/** Where the coins of a record are, from the chain. */
export async function readWhere(ctx: Ctx, record: PackRecord): Promise<Where> {
  return whereAreCoins(await readChain(ctx, record), factsOf(record));
}

/**
 * «Return to private balance»: a coin on the person's own wallet back into their private balance — the one action a
 * break offers. It is a «Hide», so the rules are asked again; refused, the coins stay on the person's own wallet.
 */
export async function returnToPrivate(ctx: Ctx, wallet: PrivateSigner, book: Book, mint: string, amount: bigint): Promise<Landed> {
  if (amount <= 0n) throw new PrivateError('TOO_SMALL');
  const owner = wallet.address;
  const solHeld = async () => (await sync(ctx, book)).find((h) => h.mint === solMintOf(ctx))?.amount ?? 0n;
  const gate = await passGate(ctx, { kind: 'hide', owner, amount: 0n }, solHeld);
  let token: Readonly<{ asset: string; splTokenAccount: string; splTokenProgram: string }> | null = null;
  if (!isSol(ctx, mint)) {
    const [held, hold] = await Promise.all([tokenAccountOf(ctx, owner, mint), holdingOf(ctx, mint)]);
    if (!held || held.amount < amount) throw new PrivateError('TOO_MUCH');
    token = { asset: mint, splTokenAccount: held.account, splTokenProgram: hold.program ?? TOKEN_PROGRAM };
  }
  const tx = await ctx.sdk.buildDepositTransaction({ client: ctx.client, feePayer: owner, depositor: owner, recipient: book.keys.address(), amount, ...(token ?? {}) });
  const landed = await submit(ctx, tx, { wallet });
  if (!token) gate.landed('in', amount);
  return landed;
}
