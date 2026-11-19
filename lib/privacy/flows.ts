/**
 * Ryntra Private — the private balance's steps, the same in the browser and in the devnet pass
 * (`scripts/privacy/devnet-pass.mjs`). Each step builds with the Privacy Rings SDK, has the person's wallet sign, sends
 * through Ryntra's relay and waits until the ring's indexer has it. Nothing here keeps a key: the caller hands keys in
 * and decides where they live (in the browser — `vault.client.ts`).
 *
 * Keys. The person's private balance has its own viewing key and nullifier secret, made at random in their browser —
 * the fallback the probe asked for, since no wallet yet proves it signs the derivation envelope the same way twice.
 * Together with the wallet's own address they form the private address; spending still needs the wallet's signature.
 * Keys from one signed envelope (`fromDerivationSeed`) are used only for wallets the owner's check passed
 * (`DERIVE_FROM_WALLET`, empty for now).
 *
 * The link. «Send privately» to someone without a private balance makes a one-time ring wallet from a 32-byte seed
 * that lives only in the link's `#fragment`: the sender tops its public address up with the network fees, registers it
 * (the link pays its own rent) and sends the amount to it privately. Whoever opens the link takes it out with that seed
 * alone — they need no SOL and sign nothing. Until someone takes it, the sender can take it back the same way; nothing
 * on chain returns it after a deadline. The public top-up ties the link's address to the sender: taken into a private
 * balance, recipient and amount stay hidden; taken to a wallet, the chain reads sender → link → wallet and the amount
 * (`exposure.ts`).
 */

import { LINK_FEE_LAMPORTS, LINK_MIN_LAMPORTS } from './network.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK bundle is loaded at run time and typed here by use. */
export type Spr = any;
export type SprClient = any;
export type WalletKeys = any;
export type KitSigner = Readonly<{ address: string }> & Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The person's wallet as the steps need it: an address and «sign these exact bytes, give them back signed». */
export type PrivateSigner = Readonly<{
  address: string;
  /** Signs a whole wire transaction (all signature slots present) and returns the wire bytes it signed. */
  signWire(wire: Uint8Array): Promise<Uint8Array>;
}>;

export type Ctx = Readonly<{ sdk: Spr; client: SprClient }>;
export type Landed = Readonly<{ signature: string; slot: bigint }>;

export type PrivateErrorCode =
  | 'WALLET_CHANGED_MESSAGE'
  | 'WALLET_REFUSED'
  | 'NOT_REGISTERED'
  | 'KEYS_ELSEWHERE'
  | 'LINK_EMPTY'
  | 'LINK_TAKEN'
  | 'TOO_MUCH'
  | 'TOO_SMALL'
  | 'SEND_FAILED';

export class PrivateError extends Error {
  readonly code: PrivateErrorCode;
  constructor(code: PrivateErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** The SDK's own error codes, read from wherever it put them, so the screen can say what happened. */
export function sdkCodes(error: unknown): readonly string[] {
  const e = error as { code?: unknown; causeCodes?: unknown; cause?: { code?: unknown } } | null;
  const out: string[] = [];
  if (typeof e?.code === 'string') out.push(e.code);
  if (Array.isArray(e?.causeCodes)) out.push(...e.causeCodes.map(String));
  if (typeof e?.cause?.code === 'string') out.push(e.cause.code);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Signs and sends one built transaction: the extra signers (a link's own key) first, then the person's wallet when it
 * is a signer; the wallet's answer must carry the same message, byte for byte. Waits for the chain and the indexer.
 */
export async function submit(ctx: Ctx, tx: unknown, opts: Readonly<{ wallet?: PrivateSigner; extra?: readonly KitSigner[] }>): Promise<Landed> {
  const { sdk, client } = ctx;
  let built = tx;
  if (opts.extra?.length) built = await sdk.partiallySignTransactionWithSigners(opts.extra, built);
  const message: Uint8Array = (built as { messageBytes: Uint8Array }).messageBytes;
  let wire: Uint8Array = new Uint8Array(sdk.getTransactionEncoder().encode(built));
  if (opts.wallet) {
    try {
      wire = await opts.wallet.signWire(wire);
    } catch (error) {
      throw new PrivateError('WALLET_REFUSED', error instanceof Error ? error.message : String(error));
    }
  }
  const signed = sdk.getTransactionDecoder().decode(wire);
  if (!sameBytes(new Uint8Array(signed.messageBytes), new Uint8Array(message))) throw new PrivateError('WALLET_CHANGED_MESSAGE');
  const signature = sdk.getSignatureFromTransaction(signed) as string;
  try {
    await client.solanaRpc.sendTransaction(toBase64(wire), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  } catch (error) {
    throw new PrivateError('SEND_FAILED', error instanceof Error ? error.message : String(error));
  }
  const slot = (await client.confirmTransaction(signature)) as bigint;
  return { signature, slot };
}

/* ---------------- keys ---------------- */

export type OwnSecrets = Readonly<{ viewing: Uint8Array; nullifier: Uint8Array }>;

/** A fresh viewing key and nullifier secret, from the browser's random source. */
export function makeSecrets(sdk: Spr): OwnSecrets {
  const viewing = sdk.ViewingKey.generate();
  const secrets = { viewing: new Uint8Array(viewing.secretBytes()), nullifier: crypto.getRandomValues(new Uint8Array(31)) };
  viewing.destroy?.();
  return secrets;
}

/** The private balance's keys for this wallet: its address with the person's own viewing and nullifier keys. */
export function ownKeys(ctx: Ctx, owner: string, secrets: OwnSecrets): WalletKeys {
  const { sdk, client } = ctx;
  const viewing = sdk.ViewingKey.fromBytes(new Uint8Array(secrets.viewing));
  const nullifier = sdk.NullifierKey.fromSecret(new Uint8Array(secrets.nullifier));
  const signing = sdk.ShieldedPublicKey.fromEd25519(sdk.getAddressEncoder().encode(owner));
  const address = sdk.ShieldedAddress.fromPublicKeys(signing, nullifier.publicKey(), viewing.publicKey());
  return sdk.LocalKeys.fromKeys({ address, viewingKeys: [viewing], nullifierKey: nullifier }, client.proofService);
}

/** Keys from the wallet's signature over the derivation envelope — only for wallets the owner's check passed. */
export function envelopeKeys(ctx: Ctx, owner: string, signature: Uint8Array): WalletKeys {
  return ctx.sdk.LocalKeys.fromDerivationSeed({ solanaPublicKey: owner, derivationSeed: new Uint8Array(signature) }, ctx.client.proofService);
}

export type Registration = 'none' | 'mine' | 'other';

/** Is this wallet registered for a private balance, and with these keys? */
export async function registrationOf(ctx: Ctx, owner: string, keys: WalletKeys | null): Promise<Registration> {
  if (!keys) return (await canReceive(ctx, owner)) ? 'other' : 'none';
  // The SDK answers it in its own words: nothing to build — registered with these keys; «keys mismatch» — with others.
  try {
    const tx = await ctx.sdk.buildRegistrationTransaction({ client: ctx.client, owner, address: keys.address() });
    return tx === undefined ? 'mine' : 'none';
  } catch (error) {
    if (sdkCodes(error).some((c) => c.includes('KEYS_MISMATCH'))) return 'other';
    throw error;
  }
}

/* ---------------- the person's own balance ---------------- */

export type Held = Readonly<{ mint: string; amount: bigint }>;

export type Book = Readonly<{ wallet: unknown; keys: WalletKeys; owner: string }>;

export function openBook(ctx: Ctx, owner: string, keys: WalletKeys): Book {
  return { wallet: new ctx.sdk.Wallet({ identity: keys.address() }), keys, owner };
}

/** Reads the private balance again; after a step, waits until the indexer has that step's slot. */
export async function sync(ctx: Ctx, book: Book, slot?: bigint): Promise<readonly Held[]> {
  await ctx.sdk.syncWallet({ client: ctx.client, wallet: book.wallet, keys: book.keys, config: slot ? { requireSlot: slot } : undefined });
  return (ctx.sdk.getPrivateTokenBalances(book.wallet) as readonly { mint: string; amount: bigint }[])
    .map((b) => ({ mint: String(b.mint), amount: BigInt(b.amount) }))
    .filter((b) => b.amount > 0n);
}

/** Turns the private balance on: registers the wallet's private address. Nothing when it already is. */
export async function enable(ctx: Ctx, wallet: PrivateSigner, keys: WalletKeys): Promise<Landed | null> {
  let tx: unknown;
  try {
    tx = await ctx.sdk.buildRegistrationTransaction({ client: ctx.client, owner: wallet.address, address: keys.address() });
  } catch (error) {
    if (sdkCodes(error).some((c) => c.includes('KEYS_MISMATCH'))) throw new PrivateError('KEYS_ELSEWHERE');
    throw error;
  }
  if (tx === undefined) return null;
  return submit(ctx, tx, { wallet });
}

/** «Hide»: SOL from the wallet into its private balance. */
export async function hide(ctx: Ctx, wallet: PrivateSigner, book: Book, lamports: bigint): Promise<Landed> {
  const tx = await ctx.sdk.buildDepositTransaction({ client: ctx.client, feePayer: wallet.address, recipient: book.keys.address(), amount: lamports });
  return submit(ctx, tx, { wallet });
}

/** «Return»: SOL from the private balance back to the wallet. */
export async function giveBack(ctx: Ctx, wallet: PrivateSigner, book: Book, lamports: bigint): Promise<Landed> {
  const tx = await ctx.sdk.buildWithdrawalTransaction({ client: ctx.client, wallet: book.wallet, keys: book.keys, feePayer: wallet.address, recipient: wallet.address, amount: lamports });
  return submit(ctx, tx, { wallet });
}

/** Is this address ready to receive privately? */
export async function canReceive(ctx: Ctx, to: string): Promise<boolean> {
  const { records } = await ctx.client.getUserRecords([to]);
  return Boolean(records[0]);
}

/** «Send privately» to a wallet with a private balance: only the sender is seen. */
export async function send(ctx: Ctx, wallet: PrivateSigner, book: Book, to: string, lamports: bigint): Promise<Landed> {
  if (!(await canReceive(ctx, to))) throw new PrivateError('NOT_REGISTERED');
  const tx = await ctx.sdk.buildTransferTransaction({ client: ctx.client, wallet: book.wallet, keys: book.keys, feePayer: wallet.address, recipient: to, amount: lamports });
  return submit(ctx, tx, { wallet });
}

/* ---------------- the link ---------------- */

export type LinkWallet = Readonly<{ signer: KitSigner; keys: WalletKeys; address: string }>;

/** The one-time ring wallet a link's seed opens. */
export async function linkWallet(ctx: Ctx, seed: Uint8Array): Promise<LinkWallet> {
  const { sdk, client } = ctx;
  const signer = (await sdk.createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed))) as KitSigner;
  const shielded = sdk.ShieldedKeypair.fromKeypair(sdk.SigningKey.fromEd25519Bytes(new Uint8Array(seed)));
  const keys = sdk.LocalKeys.fromKeypair(shielded, client.proofService);
  return { signer, keys, address: signer.address };
}

/** A plain SOL transfer the wallet signs — version 0, which every wallet signs. */
async function topUp(ctx: Ctx, wallet: PrivateSigner, to: string, lamports: bigint): Promise<Landed> {
  const { sdk, client } = ctx;
  const { value: latest } = await client.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const noop = { address: wallet.address } as KitSigner;
  const message = sdk.pipe(
    sdk.createTransactionMessage({ version: 0 }),
    (m: unknown) => sdk.setTransactionMessageFeePayer(wallet.address, m),
    (m: unknown) => sdk.setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m: unknown) => sdk.appendTransactionMessageInstruction(sdk.getTransferSolInstruction({ source: noop, destination: to, amount: lamports }), m),
  );
  return submit(ctx, sdk.compileTransaction(message), { wallet });
}

export type LinkMade = Readonly<{ link: string; steps: readonly Landed[] }>;

/** Lamports the link needs on its own address before it can register: rent of its record and the fee. */
const LINK_REGISTER_NEEDS = 1_500_000n;

/**
 * Puts `lamports` of the private balance into a link. Three steps, two of them signed by the wallet: the link's network
 * fees (public, small), the link's registration (signed by the link's own key), the private transfer. Each step is
 * read from the chain first and skipped when it already stands, so a link half made is finished from where it stopped
 * — a refused second signature never makes the sender pay the fees again. `remember` runs before anything is signed.
 */
export async function makeLink(
  ctx: Ctx,
  wallet: PrivateSigner,
  book: Book,
  lamports: bigint,
  seed: Uint8Array,
  remember: (address: string) => Promise<void>,
): Promise<LinkMade> {
  if (lamports < LINK_MIN_LAMPORTS) throw new PrivateError('TOO_SMALL');
  const link = await linkWallet(ctx, seed);
  await remember(link.address);
  const steps: Landed[] = [];
  const registered = await canReceive(ctx, link.address);
  if (!registered) {
    const has = BigInt(await ctx.client.getBalance(link.address));
    if (has < LINK_REGISTER_NEEDS) steps.push(await topUp(ctx, wallet, link.address, LINK_FEE_LAMPORTS - has));
    const registration = await ctx.sdk.buildRegistrationTransaction({ client: ctx.client, owner: link.address, address: link.keys.address() });
    if (registration !== undefined) steps.push(await submit(ctx, registration, { extra: [link.signer] }));
  }
  // Already funded (the transfer landed, the answer was lost): nothing is sent twice.
  const held = (await sync(ctx, openBook(ctx, link.address, link.keys))).find((h) => h.mint === String(ctx.sdk.SOL_MINT))?.amount ?? 0n;
  if (held > 0n) return { link: link.address, steps };
  const tx = await ctx.sdk.buildTransferTransaction({ client: ctx.client, wallet: book.wallet, keys: book.keys, feePayer: wallet.address, recipient: link.address, amount: lamports });
  steps.push(await submit(ctx, tx, { wallet }));
  return { link: link.address, steps };
}

export type LinkState = Readonly<{ address: string; held: bigint; feeLeft: bigint; book: Book; link: LinkWallet }>;

/** What a link holds now. */
export async function readLink(ctx: Ctx, seed: Uint8Array): Promise<LinkState> {
  const link = await linkWallet(ctx, seed);
  const book = openBook(ctx, link.address, link.keys);
  const held = (await sync(ctx, book)).find((h) => h.mint === String(ctx.sdk.SOL_MINT))?.amount ?? 0n;
  const feeLeft = BigInt(await ctx.client.getBalance(link.address));
  return { address: link.address, held, feeLeft, book, link };
}

/**
 * Takes what a link holds to `to`: into their private balance when they have one, else to their wallet in the open.
 * The link's own key signs and pays; the person signs nothing.
 */
export async function takeLink(ctx: Ctx, state: LinkState, to: string, into: 'private' | 'wallet'): Promise<Landed> {
  if (state.held <= 0n) throw new PrivateError('LINK_EMPTY');
  const base = { client: ctx.client, wallet: state.book.wallet, keys: state.link.keys, feePayer: state.link.address, recipient: to, amount: state.held };
  const tx = into === 'private' ? await ctx.sdk.buildTransferTransaction(base) : await ctx.sdk.buildWithdrawalTransaction(base);
  return submit(ctx, tx, { extra: [state.link.signer] });
}

/** Lamports as SOL text, without rounding away what is there: 0.05, 1.234567891. */
export function solText(lamports: bigint): string {
  const sign = lamports < 0n ? '-' : '';
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

/** SOL text a person typed («0,05», «.5», «1») as lamports; null when it is not an amount. */
export function lamportsOf(text: string): bigint | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d*(\.\d{0,9})?$/.test(clean) || clean === '' || clean === '.') return null;
  const [whole, frac = ''] = clean.split('.');
  const value = BigInt(whole || '0') * 1_000_000_000n + BigInt(frac.padEnd(9, '0') || '0');
  return value > 0n ? value : null;
}
