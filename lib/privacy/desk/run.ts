/**
 * A swap at the private desk, the person's side. Nothing here keeps a key: the keys are the private
 * balance's (`../flows.ts`), the signature is the person's wallet; the desk is reached through a `DeskLink`.
 *
 * In order, and nothing signed before the last check:
 * 1. A firm quote for exactly this amount, checked against the ask (`checkQuote`).
 * 2. The rules before money (`passGate`): paying the desk's address is a private send — a flagged wallet may only go back
 *    to itself, a flagged desk address is refused, a check that did not answer holds the swap.
 * 3. The quote is taken within its firm window; then the person's own leg is built and proved in this browser — a
 *    private transfer of exactly `inRaw` to the desk's one-time address, the fee paid by the person.
 * 4. The desk joins its leg to it and signs its part. The joint transaction is checked against the person's own leg
 *    (`checkJoint`): their leg byte for byte, one transfer of the desk's beside it, nothing else, the desk's signature
 *    true; and what the desk's leg pays the person (`paid`) at least the quote.
 * 5. The wallet signs once; sent, confirmed, the private balance read again.
 *
 * **What is not there yet (the open question to Helius).** The person can check every byte of the joint transaction
 * except one fact: that the desk's leg pays *them* the quoted coin and amount — the outputs are encrypted to their
 * viewing key, and the SDK decrypts outputs only from the ring's indexer, not from a transaction not yet sent. Until it
 * can (`PAID_READER`), the browser never offers the desk (`way.ts`, `CHECK`): the Swap goes the route's way. The devnet
 * probe, where both sides are its own, checks it after landing by both balances (`probe: true`).
 */

import { passGate, submit, sync, type Book, type Ctx, type Held, type Landed, type PrivateSigner } from '../flows.ts';
import { PRIVATE_CHAIN } from '../network.ts';
import { checkJoint, fromBase64, readMessage, toBase64, buildLeg, type Built, type JointCode, type Message } from './joint.ts';
import type { DeskLink } from './link.ts';
import { canFill, checkQuote, type Ask, type Quote, type QuoteProblem } from './quote.ts';

/** What the desk's leg pays the person, read from the joint transaction with the person's own viewing key; null — nothing to them. */
export type PaidReader = (joint: Message, quote: Quote) => Promise<Readonly<{ mint: string; amount: bigint }> | null>;

/** The reader of the desk's leg for its recipient — none until the ring's SDK can decrypt a transfer's outputs before it is sent. */
export const PAID_READER: PaidReader | null = null;

/** The stages the Swap's button names while a desk swap runs. */
export type DeskStage = 'quoting' | 'proving' | 'joining' | 'signing' | 'reading';

/**
 * - `DESK_UNCHECKED` — this build cannot check the desk's leg before the wallet signs: nothing is asked of the desk;
 * - `DESK_QUOTE` — the quote is not the one asked for (its `QuoteProblem` in the message);
 * - `DESK_EXPIRED` — the price was not taken, or the legs not joined, in time: nothing moved;
 * - `DESK_JOINT` — the joint transaction failed a check (its `JointCode`), or the desk's signature is not true;
 * - `DESK_SHORT` — the desk's leg pays less than quoted, another coin, or not to the person.
 */
export type DeskErrorCode = 'DESK_UNCHECKED' | 'DESK_QUOTE' | 'DESK_EXPIRED' | 'DESK_JOINT' | 'DESK_SHORT';

export class DeskError extends Error {
  readonly code: DeskErrorCode;
  constructor(code: DeskErrorCode, message?: QuoteProblem | JointCode | string) {
    super(message ?? code);
    this.code = code;
  }
}

/** Can this build check a joint transaction before the wallet signs it? */
export function deskAbilities(sdk: Ctx['sdk'], paid: PaidReader | null = PAID_READER): Readonly<{ canCheck: boolean }> {
  const decoders = typeof sdk?.getTransactionDecoder === 'function' && typeof sdk?.getCompiledTransactionMessageDecoder === 'function' && typeof sdk?.verifySignature === 'function';
  return { canCheck: decoders && paid !== null };
}

export type DeskRun = Readonly<{
  ctx: Ctx;
  book: Book;
  wallet: PrivateSigner;
  link: DeskLink;
  ask: Ask;
  /** Defaults to `PAID_READER`. */
  paid?: PaidReader | null;
  /** The devnet probe only: both sides are its own; the desk's leg is checked after landing by both balances. */
  probe?: boolean;
  now?: () => number;
  on?: (stage: DeskStage) => void;
}>;

export type DeskDone = Readonly<{ quote: Quote; landed: Landed; held: readonly Held[] }>;

/** Is the desk's signature on the joint transaction true for its message? */
export async function deskSigned(sdk: Ctx['sdk'], joint: Built, desk: string): Promise<boolean> {
  const signature = joint.signatures[desk];
  if (!signature || signature.every((b) => b === 0)) return false;
  try {
    return Boolean(await sdk.verifySignature(await sdk.getPublicKeyFromAddress(desk), signature, joint.messageBytes));
  } catch {
    return false;
  }
}

export async function swapAtDesk(run: DeskRun): Promise<DeskDone> {
  const { ctx, book, ask, link } = run;
  const { sdk } = ctx;
  const now = run.now ?? Date.now;
  const on = run.on ?? (() => undefined);
  const paid = run.paid === undefined ? PAID_READER : run.paid;
  if (!paid && !run.probe) throw new DeskError('DESK_UNCHECKED');

  on('quoting');
  const quote = await link.quote(ask);
  const problem = checkQuote(quote, ask, PRIVATE_CHAIN, now());
  if (problem) throw new DeskError(problem === 'EXPIRED' ? 'DESK_EXPIRED' : 'DESK_QUOTE', problem);
  await passGate(ctx, { kind: 'send', owner: ask.owner, to: quote.desk });
  const taken = await link.take(quote.id);
  if (taken.id !== quote.id || taken.desk !== quote.desk || taken.outRaw !== quote.outRaw || taken.inRaw !== quote.inRaw) throw new DeskError('DESK_QUOTE', 'ASK');

  on('proving');
  const mine = (await buildLeg(ctx, { book, to: quote.desk, mint: ask.inMint, amount: ask.inRaw, feePayer: ask.owner })) as Built;
  if (!canFill(taken, now())) throw new DeskError('DESK_EXPIRED');

  on('joining');
  const wire = fromBase64(await link.fill(quote.id, toBase64(new Uint8Array(sdk.getTransactionEncoder().encode(mine)))));
  const joint = sdk.getTransactionDecoder().decode(wire) as Built;
  const jointMessage = readMessage(sdk, joint);
  const code = checkJoint({ joint: jointMessage, mine: readMessage(sdk, mine), owner: ask.owner, desk: quote.desk, bytes: wire.length });
  if (code) throw new DeskError('DESK_JOINT', code);
  if (!(await deskSigned(sdk, joint, quote.desk))) throw new DeskError('DESK_JOINT', 'UNSIGNED');
  if (paid) {
    const got = await paid(jointMessage, quote);
    if (!got || got.mint !== quote.outMint || got.amount < quote.outRaw) throw new DeskError('DESK_SHORT');
  }

  on('signing');
  const landed = await submit(ctx, joint, { wallet: run.wallet });
  on('reading');
  const held = await sync(ctx, book, landed.slot);
  return { quote, landed, held };
}
