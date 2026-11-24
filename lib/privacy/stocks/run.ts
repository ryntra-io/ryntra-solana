/**
 * A stock from the private balance, and a stock pool's income back into it — run, each under one wallet approval. The
 * ways are `plan.ts`'s; where the coins are after any break is `recover.ts`'s, read from the chain. Nothing here keeps a
 * key: the keys are the private balance's (`../flows.ts`), the signature is the person's wallet. It builds on the
 * private swap (`../swap/**`) and changes none of it: the same open order with Ryntra's fee, the same ring
 * steps, the same rules before money, the same «never sent twice».
 *
 * Buy, in order, nothing signed before the last check:
 * 1. The pair, the network and the stock's own state are checked (an issuer that paused the token, or new accounts that
 *    start frozen, refuse before anything is proved). Out of the ring goes to the person's own wallet only — the rules
 *    before money leave that always open.
 * 2. The withdrawal's proof is computed (`stage: 'proving'`, up to 20 seconds).
 * 3. One v1 transaction (withdrawal + route) is compiled and simulated, or the pack of two is put together.
 * 4. The wallet signs once; each answer must carry the same bytes; the record is handed to `remember` before sending.
 * 5. Sent one by one, each once; the chain says where the coins are. The stock lands on the person's wallet.
 *
 * Income, in order: the coin that goes back is SOL or USDC; the rules before money are asked as for a «Hide»; the claim
 * the engine built and the deposit go as one transaction or as a pack in one approval; the chain says where it is.
 */

import { getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';

import { PrivateError, passGate, submit, sync, type Book, type Ctx, type Landed } from '../flows.ts';
import { PRIVATE_CHAIN, RING_SOL } from '../network.ts';
import type { EdgeShape, Holding } from '../swap/plan.ts';
import { ASSOCIATED_TOKEN_PROGRAM, boughtAccount, compiledOf, routeInstructions, routeOf } from '../swap/route.ts';
import { BLOCKHASH_LIFE, TOKEN_PROGRAM, abilities, receivedBy, tokenAccountOf, walletHeld, type OpenOrder, type Stage, type SwapSigner } from '../swap/run.ts';
import { buyWithdrawal, chooseBuyPath, chooseIncomePath, splitIncome, USDC_MINTS, WSOL, type BuyPath, type ClaimShape, type IncomePath, type IncomeShown, type IssuerState } from './plan.ts';
import { buyFactsOf, incomeFactsOf, onChainOf, whereAfterBuy, whereAfterIncome, type BuyRecord, type BuyWhere, type IncomeRecord, type IncomeWhere, type StockRecord } from './recover.ts';
import { ringAdmits, type Admission } from './ring-admits.ts';

export type { Stage };

/**
 * The Token-2022 program, as `@solana/spl-token` names it. The private swap's own constant (`../swap/run.ts`) carries a
 * mistyped address, so a stock — always Token-2022 — is read here by this one.
 */
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/* ── small parts ────────────────────────────────────────────────────────────────────────────────────────────────── */

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

const solMintOf = (ctx: Ctx) => String(ctx.sdk.SOL_MINT ?? RING_SOL);
const isSol = (ctx: Ctx, mint: string) => mint === WSOL || mint === RING_SOL || mint === solMintOf(ctx);

/** A mint's extensions as Solana's parsed data lists them, with each one's state. */
type ParsedExtension = Readonly<{ extension?: unknown; state?: Readonly<Record<string, unknown>> }>;

/** What the issuer's mint says now, from its parsed extensions: paused, and the state a new account starts in. */
export function issuerOf(extensions: readonly ParsedExtension[]): IssuerState {
  let paused = false;
  let frozenByDefault = false;
  for (const ext of extensions) {
    if (ext.extension === 'pausableConfig' && ext.state?.paused === true) paused = true;
    if (ext.extension === 'defaultAccountState' && ext.state?.accountState === 'frozen') frozenByDefault = true;
  }
  return { paused, frozenByDefault };
}

export type MintFacts = Readonly<{ program: string | null; holding: Holding; extensions: readonly string[]; issuer: IssuerState; ring: Admission }>;

/** The stock's mint as the chain shows it: its token program, its extensions, the issuer's state, and whether the ring takes it. */
export async function mintFactsOf(ctx: Ctx, mint: string): Promise<MintFacts> {
  if (isSol(ctx, mint)) return { program: null, holding: 'native', extensions: [], issuer: { paused: false, frozenByDefault: false }, ring: { admitted: true, refused: [] } };
  const { value } = await ctx.client.solanaRpc.getAccountInfo(mint, { encoding: 'jsonParsed', commitment: 'confirmed' }).send();
  if (!value) throw new PrivateError('SEND_FAILED', 'the coin is not a token this network knows');
  const program = String(value.owner);
  if (program !== TOKEN_PROGRAM && program !== TOKEN_2022) throw new PrivateError('SEND_FAILED', 'the coin is not a token this network knows');
  const parsed = (value.data as { parsed?: { info?: { extensions?: readonly ParsedExtension[] } } } | null)?.parsed?.info?.extensions ?? [];
  const extensions = parsed.map((e) => String(e.extension));
  return { program, holding: program === TOKEN_2022 ? 'token2022' : 'classic', extensions, issuer: issuerOf(parsed), ring: ringAdmits(extensions) };
}

/** The associated token account of an owner in a mint under a token program. */
export async function associatedAccount(owner: string, mint: string, program: string): Promise<string> {
  const e = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({ programAddress: ASSOCIATED_TOKEN_PROGRAM as never, seeds: [e.encode(owner as never), e.encode(program as never), e.encode(mint as never)] });
  return String(pda);
}

/** The person's wallet signing transactions of a stock flow; a refusal or changed bytes are thrown in the person's terms. */
async function signAll(ctx: Ctx, wallet: SwapSigner, built: readonly Uint8Array[]): Promise<Readonly<{ signed: readonly Uint8Array[]; signatures: readonly string[] }>> {
  const { sdk } = ctx;
  if (!wallet.signWires) throw new PrivateError('WALLET_REFUSED');
  let signed: readonly Uint8Array[];
  try {
    signed = await wallet.signWires(built);
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
  return { signed, signatures };
}

/** Sends signed transactions one by one, each once; stops at the first that does not confirm. Returns how many landed. */
async function sendInOrder(ctx: Ctx, signed: readonly Uint8Array[], signatures: readonly string[], onLanded?: (i: number) => void): Promise<number> {
  const { client } = ctx;
  for (let i = 0; i < signed.length; i++) {
    try {
      await client.solanaRpc.sendTransaction(toBase64(signed[i]), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
      await client.confirmTransaction(signatures[i]);
    } catch {
      // Never sent again: whatever happened, the chain says where the coins are.
      return i;
    }
    onLanded?.(i);
  }
  return signed.length;
}

/** The height a transaction lives to, never shorter than a blockhash can: a step read as expired too early would offer back coins still landing. */
async function ceilingOf(ctx: Ctx): Promise<bigint> {
  return BigInt(await ctx.client.solanaRpc.getBlockHeight({ commitment: 'confirmed' }).send()) + BLOCKHASH_LIFE;
}

function lastValidOf(tx: unknown, ceiling: bigint): bigint {
  const height = (tx as { lifetimeConstraint?: { lastValidBlockHeight?: bigint | number } } | null)?.lifetimeConstraint?.lastValidBlockHeight;
  return height === undefined ? ceiling : BigInt(height);
}

/** Compiles instructions as one v1 transaction with the given compute and simulates it; null when it does not fit or fails. */
async function compileOne(ctx: Ctx, owner: string, instructions: readonly unknown[], computeUnits: number): Promise<Readonly<{ tx: unknown; lastValid: bigint }> | null> {
  const { sdk, client } = ctx;
  try {
    const { value: lifetime } = await client.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const tx = sdk.compileUnsignedTransaction({ feePayer: owner, lifetime, instructions, computeUnitLimit: computeUnits });
    const wire = toBase64(new Uint8Array(sdk.getTransactionEncoder().encode(tx)));
    const simulated = await client.solanaRpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }).send();
    if (simulated.value?.err) return null;
    return { tx, lastValid: BigInt(lifetime.lastValidBlockHeight) };
  } catch {
    return null;
  }
}

const instructionsOf = (ctx: Ctx, tx: { messageBytes: Uint8Array }) => ctx.sdk.decompileTransactionMessage(ctx.sdk.getCompiledTransactionMessageDecoder().decode(tx.messageBytes)).instructions as readonly unknown[];

function edgeOf(ctx: Ctx, tx: { messageBytes: Uint8Array }): EdgeShape {
  const compiled = ctx.sdk.getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as { staticAccounts: readonly string[] };
  return { addresses: compiled.staticAccounts.map(String), bytes: new Uint8Array(ctx.sdk.getTransactionEncoder().encode(tx)).length };
}

/** One transaction under the wallet's one signature, the record kept before it is sent. */
async function submitOne<R extends StockRecord>(ctx: Ctx, wallet: SwapSigner, tx: unknown, record: (sig: string) => R, remember: ((r: StockRecord) => Promise<void> | void) | undefined, on: (s: Stage) => void): Promise<Landed> {
  const { sdk } = ctx;
  return submit(ctx, tx, {
    wallet: {
      address: wallet.address,
      signWire: async (wire) => {
        const signed = await wallet.signWire(wire);
        const sig = sdk.getSignatureFromTransaction(sdk.getTransactionDecoder().decode(signed)) as string;
        await remember?.(record(sig));
        on('sending');
        return signed;
      },
    },
  });
}

/* ── buy ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type BuyAsk = Readonly<{
  ringChain?: string;
  ctx: Ctx;
  book: Book;
  wallet: SwapSigner;
  /** The stock ticket's exact open order: the coin paid with → the stock, with Ryntra's fee as in the open. */
  order: OpenOrder;
  /** The ticket's order as it stands now — after the proof, the freshest order of the same pair and amount is taken. */
  fresh?: () => OpenOrder | null;
  on?: (stage: Stage) => void;
  remember?: (record: StockRecord) => Promise<void> | void;
}>;

export type BuyEnd = Readonly<{ path: BuyPath; record: StockRecord | null; where: BuyWhere; ring: Admission | null }>;

/** Buys the stock from the private balance; ends with where the coins are, read from the chain. */
export async function buyStockPrivately(ask: BuyAsk): Promise<BuyEnd> {
  const { ctx, book, wallet } = ask;
  const { sdk, client } = ctx;
  const on = ask.on ?? (() => undefined);
  const owner = wallet.address;
  let order = ask.order;
  const payMint = order.inputMint;
  const stockMint = order.outputMint;
  const outAmount = buyWithdrawal(order.inAmountRaw);
  const refuse = (path: BuyPath, ring: Admission | null = null): BuyEnd => ({ path, record: null, where: { place: 'private' }, ring });

  on('checking');
  const ringChain = ask.ringChain ?? PRIVATE_CHAIN;
  if (order.chain !== ringChain) return refuse({ kind: 'refuse', code: 'ELSEWHERE' });
  const route = routeOf(order.wireBase64);
  const [payHold, stock] = await Promise.all([mintFactsOf(ctx, payMint), mintFactsOf(ctx, stockMint)]);
  const can = abilities(ctx, wallet);
  const input = { owner, payMint, payHolding: payHold.holding, stockMint, routeChain: order.chain, ringChain, route, issuer: stock.issuer, canOne: can.canOne, canPack: can.canPack };
  const early = chooseBuyPath({ ...input, edge: { addresses: [], bytes: 0 } });
  if (early.kind === 'refuse') return refuse(early, stock.ring);
  // Out of the ring to the person's own wallet: always open — nothing is asked, nothing new enters the ring.
  await passGate(ctx, { kind: 'return', owner, to: owner });

  on('proving');
  const withdrawal = await sdk.buildWithdrawalTransaction({
    client,
    wallet: book.wallet,
    keys: book.keys,
    feePayer: owner,
    recipient: owner,
    amount: outAmount,
    ...(isSol(ctx, payMint) ? {} : { asset: payMint, splTokenProgram: payHold.program }),
  });
  const renewed = ask.fresh?.() ?? null;
  if (renewed && renewed.inputMint === payMint && renewed.outputMint === stockMint && renewed.inAmountRaw === order.inAmountRaw && renewed.chain === order.chain) order = renewed;
  const minStock = BigInt(order.minReceivedRaw);
  const facts = { payMint, stockMint, outAmount: outAmount.toString(), minStock: minStock.toString(), paySol: isSol(ctx, payMint) };
  const ceiling = await ceilingOf(ctx);

  let path: BuyPath = early;
  let one: Readonly<{ tx: unknown; lastValid: bigint }> | null = null;
  if (can.canOne && early.kind === 'one') {
    path = chooseBuyPath({ ...input, route: routeOf(order.wireBase64), edge: edgeOf(ctx, withdrawal) });
    if (path.kind === 'one') {
      one = await compileOne(ctx, owner, [...instructionsOf(ctx, withdrawal), ...routeInstructions(order.wireBase64)], path.computeUnits);
      if (!one) path = can.canPack ? { kind: 'pack', why: 'BYTES' } : { kind: 'refuse', code: 'ONE_PROMPT', why: 'BYTES' };
    }
  }
  if (path.kind === 'refuse') return refuse(path, stock.ring);

  if (one) {
    on('signing');
    const lastValid = one.lastValid.toString();
    const recordOf = (sig: string): BuyRecord => ({ v: 1, flow: 'buy', kind: 'one', owner, signatures: [sig], lastValidBlockHeight: lastValid, facts });
    const landed = await submitOne(ctx, wallet, one.tx, recordOf, ask.remember, on);
    if (facts.paySol) ctx.gate?.landed('out', outAmount);
    on('reading');
    const record = recordOf(landed.signature);
    return { path, record, where: await readBuyWhere(ctx, record), ring: stock.ring };
  }

  // The pack: out (v1) · the open order (v0), signed in one approval.
  const built = [new Uint8Array(sdk.getTransactionEncoder().encode(withdrawal)), fromBase64(order.wireBase64)];
  on('signing');
  const { signed, signatures } = await signAll(ctx, wallet, built);
  const lastValid = [lastValidOf(withdrawal, ceiling), BigInt(order.lastValidBlockHeight)].reduce((a, b) => (b > a ? b : a), 0n);
  const record: BuyRecord = { v: 1, flow: 'buy', kind: 'pack', owner, signatures, lastValidBlockHeight: lastValid.toString(), facts };
  await ask.remember?.(record);
  on('sending');
  await sendInOrder(ctx, signed, signatures, (i) => {
    if (i === 0 && facts.paySol) ctx.gate?.landed('out', outAmount);
  });
  on('reading');
  return { path, record, where: await readBuyWhere(ctx, record), ring: stock.ring };
}

/** Where the coins of a buy are now, from the chain. */
export async function readBuyWhere(ctx: Ctx, record: BuyRecord): Promise<BuyWhere> {
  const { client } = ctx;
  const facts = buyFactsOf(record);
  const { value } = await client.solanaRpc.getSignatureStatuses(record.signatures, { searchTransactionHistory: true }).send();
  const steps = (value as readonly ({ err?: unknown; confirmationStatus?: string | null } | null)[]).map((s) => ({ status: onChainOf(s) }));
  const height = BigInt(await client.solanaRpc.getBlockHeight({ commitment: 'confirmed' }).send());
  const expired = height > BigInt(record.lastValidBlockHeight);
  const routeAt = record.kind === 'pack' ? 1 : 0;
  const routeStep = steps[routeAt];
  const [walletPay, received] = await Promise.all([walletHeld(ctx, record.owner, facts.payMint), routeStep?.status === 'landed' ? receivedBy(ctx, record.signatures[routeAt], record.owner, facts.stockMint) : Promise.resolve(null)]);
  return whereAfterBuy(record.kind === 'pack' ? { kind: 'pack', out: steps[0], route: steps[1], expired, walletPay, received } : { kind: 'one', out: steps[0], expired, walletPay, received }, facts);
}

/* ── income ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** One transaction of the engine's claim, as its Review hands it: unsigned bytes and keys that already signed. */
export type ClaimTx = Readonly<{ wireBase64: string; presigned: readonly string[] }>;

export type IncomeClaim = Readonly<{
  /** The engine's Review of a claim (or of a leave with its fees): its transactions, in order. */
  transactions: readonly ClaimTx[];
  /** What the Review says the claim pays, each side: `claimed` of a claim, `feesClaimed` of a leave. */
  shown: IncomeShown;
  /** The network the claim was built for, as `solana:mainnet`. */
  chain: string;
}>;

export type IncomeAsk = Readonly<{
  ringChain?: string;
  ctx: Ctx;
  book: Book;
  wallet: SwapSigner;
  claim: IncomeClaim;
  /** USDC's mints on this network; mainnet and devnet by default. */
  usdc?: readonly string[];
  on?: (stage: Stage) => void;
  remember?: (record: StockRecord) => Promise<void> | void;
}>;

export type IncomeEnd = Readonly<{ path: IncomePath; record: StockRecord | null; where: IncomeWhere }>;

/** Whether the claim's bytes close a wrapped-SOL account into the person's wallet (token «CloseAccount», tag 9). */
export function claimUnwrapsSol(wires: readonly string[], owner: string): boolean {
  for (const wire of wires) {
    const m = compiledOf(wire);
    for (const ix of m.instructions) {
      const program = m.staticAccounts[ix.programAddressIndex];
      if (program !== TOKEN_PROGRAM && program !== TOKEN_2022) continue;
      const data = ix.data;
      const destination = m.staticAccounts[ix.accountIndices?.[1] ?? -1];
      if (data && data.length >= 1 && data[0] === 9 && destination === owner) return true;
    }
  }
  return false;
}

/** The claim's shape for the path. */
export function claimShapeOf(claim: IncomeClaim, owner: string): ClaimShape {
  const wires = claim.transactions.map((t) => t.wireBase64);
  return {
    route: routeOf(wires[0]),
    count: wires.length,
    presigned: claim.transactions.flatMap((t) => t.presigned),
    unwrapsSol: claimUnwrapsSol(wires, owner),
  };
}

/** Takes the pool's income and puts its SOL or USDC side into the private balance; ends with where it is, from the chain. */
export async function incomeToPrivate(ask: IncomeAsk): Promise<IncomeEnd> {
  const { ctx, book, wallet, claim } = ask;
  const { sdk, client } = ctx;
  const on = ask.on ?? (() => undefined);
  const owner = wallet.address;
  const refuse = (path: IncomePath): IncomeEnd => ({ path, record: null, where: { place: 'pool' } });
  if (claim.transactions.length === 0) return refuse({ kind: 'refuse', code: 'COIN' });

  on('checking');
  const ringChain = ask.ringChain ?? PRIVATE_CHAIN;
  if (claim.chain !== ringChain) return refuse({ kind: 'refuse', code: 'ELSEWHERE' });
  const split = splitIncome(claim.shown, ask.usdc ?? USDC_MINTS);
  const shape = claimShapeOf(claim, owner);
  const can = abilities(ctx, wallet);
  const input = { owner, split, claim: shape, claimChain: claim.chain, ringChain, canOne: can.canOne, canPack: can.canPack };
  const early = chooseIncomePath({ ...input, edge: { addresses: [], bytes: 0 } });
  if (early.kind === 'refuse' || !split.back) return refuse(early.kind === 'refuse' ? early : { kind: 'refuse', code: 'COIN' });
  const back = split.back;
  const sol = back.coin === 'sol';
  // Into the ring: a «Hide». SOL income is new money in the balance and counts against its cap; a token is not priced here.
  const solHeld = async () => (await sync(ctx, book)).find((h) => h.mint === solMintOf(ctx))?.amount ?? 0n;
  await passGate(ctx, { kind: 'hide', owner, amount: sol ? back.amount : 0n }, solHeld);

  on('proving');
  let token: Readonly<{ asset: string; splTokenAccount: string; splTokenProgram: string }> | null = null;
  if (!sol) {
    const hold = await mintFactsOf(ctx, back.mint);
    const program = hold.program ?? TOKEN_PROGRAM;
    const opened = claim.transactions.map((t) => boughtAccount(t.wireBase64, owner, back.mint)).find(Boolean) ?? null;
    const held = opened ? null : await tokenAccountOf(ctx, owner, back.mint);
    const account = opened?.account ?? held?.account ?? (await associatedAccount(owner, back.mint, program));
    token = { asset: back.mint, splTokenAccount: account, splTokenProgram: opened?.program ?? program };
  }
  const deposit = () => sdk.buildDepositTransaction({ client, feePayer: owner, depositor: owner, recipient: book.keys.address(), amount: back.amount, ...(token ?? {}) });
  const facts = { mint: back.mint, amount: back.amount.toString(), isSol: sol };
  const depositTx = await deposit();
  const ceiling = await ceilingOf(ctx);

  let path: IncomePath = early;
  let one: Readonly<{ tx: unknown; lastValid: bigint }> | null = null;
  if (can.canOne && early.kind === 'one') {
    path = chooseIncomePath({ ...input, edge: edgeOf(ctx, depositTx) });
    if (path.kind === 'one') {
      one = await compileOne(ctx, owner, [...routeInstructions(claim.transactions[0].wireBase64), ...instructionsOf(ctx, depositTx)], path.computeUnits);
      if (!one) path = can.canPack ? { kind: 'pack', why: 'BYTES' } : { kind: 'refuse', code: 'ONE_PROMPT', why: 'BYTES' };
    }
  }
  if (path.kind === 'refuse') return refuse(path);

  if (one) {
    on('signing');
    const lastValid = one.lastValid.toString();
    const recordOf = (sig: string): IncomeRecord => ({ v: 1, flow: 'income', kind: 'one', owner, signatures: [sig], lastValidBlockHeight: lastValid, facts });
    const landed = await submitOne(ctx, wallet, one.tx, recordOf, ask.remember, on);
    if (sol) ctx.gate?.landed('in', back.amount);
    on('reading');
    const record = recordOf(landed.signature);
    return { path, record, where: await readIncomeWhere(ctx, record) };
  }

  // The pack: the claim's transactions as the engine built them · the deposit (v1), signed in one approval.
  const built = [...claim.transactions.map((t) => fromBase64(t.wireBase64)), new Uint8Array(sdk.getTransactionEncoder().encode(depositTx))];
  on('signing');
  const { signed, signatures } = await signAll(ctx, wallet, built);
  // The claim's bytes name a blockhash the engine took; the ceiling (a blockhash's longest life from now) covers it.
  const depositLast = lastValidOf(depositTx, ceiling);
  const lastValid = depositLast > ceiling ? depositLast : ceiling;
  const record: IncomeRecord = { v: 1, flow: 'income', kind: 'pack', owner, signatures, lastValidBlockHeight: lastValid.toString(), facts };
  await ask.remember?.(record);
  on('sending');
  await sendInOrder(ctx, signed, signatures, (i) => {
    if (i === built.length - 1 && sol) ctx.gate?.landed('in', back.amount);
  });
  on('reading');
  return { path, record, where: await readIncomeWhere(ctx, record) };
}

/** Where a pool's income is now, from the chain. */
export async function readIncomeWhere(ctx: Ctx, record: IncomeRecord): Promise<IncomeWhere> {
  const { client } = ctx;
  const facts = incomeFactsOf(record);
  const { value } = await client.solanaRpc.getSignatureStatuses(record.signatures, { searchTransactionHistory: true }).send();
  const steps = (value as readonly ({ err?: unknown; confirmationStatus?: string | null } | null)[]).map((s) => ({ status: onChainOf(s) }));
  const height = BigInt(await client.solanaRpc.getBlockHeight({ commitment: 'confirmed' }).send());
  const expired = height > BigInt(record.lastValidBlockHeight);
  const walletNow = await walletHeld(ctx, record.owner, facts.mint);
  if (record.kind === 'one') return whereAfterIncome({ kind: 'one', claims: [steps[0]], expired, walletHeld: walletNow }, facts);
  return whereAfterIncome({ kind: 'pack', claims: steps.slice(0, -1), deposit: steps.at(-1), expired, walletHeld: walletNow }, facts);
}

/** Where a kept record's coins are now. */
export async function readStockWhere(ctx: Ctx, record: StockRecord): Promise<BuyWhere | IncomeWhere> {
  return record.flow === 'buy' ? readBuyWhere(ctx, record) : readIncomeWhere(ctx, record);
}
