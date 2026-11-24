/**
 * The private desk itself, the side that quotes and pays — in place, as a `DeskLink`. Today only the devnet
 * probe runs it (`scripts/privacy/desk-probe.mjs`), with one-time keys it makes in memory and never prints or writes.
 * A
 * service in front of it would answer `link.ts`'s three calls with these three functions.
 *
 * - `quote` — the middle price for the pair, a free one-time address that holds enough, a firm quote (`quote.ts`);
 *   the address is held until the firm window ends.
 * - `take` — in time: the hold runs to `fillUntil`, and the desk starts proving its own leg at once (desk → person,
 *   exactly `outRaw`, the person paying the fee), so the person waits for one proof, not two.
 * - `fill` — the person's leg is checked (`checkLeg`: one private transfer, signed and paid by the person alone), both
 *   legs are joined into one transaction with a fresh lifetime, the desk's address signs its part, and the address is
 *   marked used: it is swept back into the desk's ring and never quoted again.
 *
 * The desk checks the person's leg as far as bytes go. That it pays the desk `inRaw` of `inMint` is encrypted to the
 * desk's address like the person's side is to them (`run.ts`, the open question); the probe confirms it after landing.
 */

import type { Book, Ctx, KitSigner } from '../flows.ts';
import { buildLeg, checkLeg, joinLegs, readMessage, fromBase64, toBase64, type Built } from './joint.ts';
import { DeskRefused, type DeskLink } from './link.ts';
import { canFill, makeQuote, outFor, type Mid, type Pair, type Quote, type Terms } from './quote.ts';
import { holdSlot, pickSlot, releaseSlot, slotOf, spendSlot, type Slot } from './slots.ts';

/** A one-time address's key, as whoever runs the desk holds it: in memory only. */
export type SlotKey = Readonly<{ address: string; signer: KitSigner; book: Book }>;

export type DeskInput = Readonly<{
  ctx: Ctx;
  chain: string;
  terms: Terms;
  pairs: readonly Pair[];
  /** The middle price for a pair now; null — none to quote on. */
  mid: (pair: Pair) => Promise<Mid | null>;
  keys: readonly SlotKey[];
  slots: readonly Slot[];
  now?: () => number;
  id?: () => string;
}>;

type Open = { quote: Quote; taken: boolean; leg: Promise<Built> | null };

export type Desk = DeskLink & Readonly<{ slots: () => readonly Slot[]; quoteOf: (id: string) => Quote | null }>;

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export function openDesk(input: DeskInput): Desk {
  const { ctx, terms } = input;
  const now = input.now ?? Date.now;
  const nextId = input.id ?? randomId;
  let slots = input.slots;
  const open = new Map<string, Open>();
  const keyOf = (address: string) => {
    const key = input.keys.find((k) => k.address === address);
    if (!key) throw new DeskRefused('NO_KEY');
    return key;
  };
  const known = (id: string) => {
    const entry = open.get(id);
    if (!entry) throw new DeskRefused('NO_QUOTE');
    return entry;
  };

  return {
    slots: () => slots,
    quoteOf: (id) => open.get(id)?.quote ?? null,

    quote: async (ask) => {
      const at = now();
      const mid = await input.mid(ask);
      const want = mid ? outFor(ask.inRaw, mid, terms.spreadBps) : 0n;
      const slot = want > 0n ? pickSlot(slots, ask.outMint, want, at) : null;
      const made = makeQuote({ ask, pairs: input.pairs, terms, mid, slot: slot ? { address: slot.address, holds: slot.holds[ask.outMint] ?? 0n } : null, id: nextId(), chain: input.chain, now: at });
      if (!made.ok) throw new DeskRefused(made.code);
      slots = holdSlot(slots, made.quote.desk, made.quote.id, made.quote.firmUntil);
      open.set(made.quote.id, { quote: made.quote, taken: false, leg: null });
      return made.quote;
    },

    take: async (id) => {
      const entry = known(id);
      const { quote } = entry;
      if (now() > quote.firmUntil || slotOf(slots, id)?.state !== 'held') {
        slots = releaseSlot(slots, id);
        open.delete(id);
        throw new DeskRefused('EXPIRED');
      }
      if (!entry.taken) {
        entry.taken = true;
        slots = holdSlot(slots, quote.desk, id, quote.fillUntil);
        entry.leg = buildLeg(ctx, { book: keyOf(quote.desk).book, to: quote.owner, mint: quote.outMint, amount: quote.outRaw, feePayer: quote.owner }) as Promise<Built>;
        // A failed proof is said at `fill`; it is never left unheard.
        entry.leg.catch(() => undefined);
      }
      return quote;
    },

    fill: async (id, leg) => {
      const entry = known(id);
      const { quote } = entry;
      if (!entry.taken || !entry.leg || !canFill(quote, now())) {
        slots = releaseSlot(slots, id);
        open.delete(id);
        throw new DeskRefused('EXPIRED');
      }
      const { sdk } = ctx;
      const mine = sdk.getTransactionDecoder().decode(fromBase64(leg)) as Built;
      const code = checkLeg(readMessage(sdk, mine), quote.owner, quote.desk);
      if (code) throw new DeskRefused(code);
      const theirs = await entry.leg;
      const { value: lifetime } = await ctx.client.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      const joint = joinLegs(sdk, { mine, theirs, feePayer: quote.owner, lifetime });
      const signed = (await sdk.partiallySignTransactionWithSigners([keyOf(quote.desk).signer], joint)) as Built;
      slots = spendSlot(slots, id);
      open.delete(id);
      return toBase64(new Uint8Array(sdk.getTransactionEncoder().encode(signed)));
    },
  };
}
