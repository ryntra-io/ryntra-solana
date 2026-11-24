/**
 * The recipient's private invoices, for «Money → Invoices» in its private mode: the invoices this wallet
 * made in this browser, each one's state, «waiting for …», and a new one.
 *
 * States come from two places only: the clock (waiting, expired) and the recipient's own private history (paid —
 * `status.ts`). A read that fails changes nothing: every invoice keeps the state it had, and a payment once found stays.
 * Making an invoice signs nothing and sends nothing: it reads the slot, seals the invoice here and gives the link.
 */

import { create } from 'zustand';
import { loadPrivate } from '../sdk.client.ts';
import { dropBook, invoiceSlot, readInbound, takesPrivate } from './chain.client.ts';
import { encodeInvoice, payUrl } from './code.ts';
import { makeInvoice, type NewInvoice } from './model.ts';
import { newlyPaid, settle, type Settled } from './status.ts';
import { keepInvoice, keptInvoices, markPaid, type KeptInvoice } from './store.client.ts';

/** How the private history was last read: not yet, now, fine, no keys in this browser, or it did not answer. */
export type InboundRead = 'idle' | 'reading' | 'ready' | 'nokeys' | 'failed';

export type Made = Readonly<{ ok: true; kept: KeptInvoice; url: string }> | Readonly<{ ok: false; reason: 'closed' | 'invalid' | 'failed' }>;

type State = Readonly<{
  owner: string | null;
  /** Loading what this browser keeps. */
  loaded: boolean;
  kept: readonly KeptInvoice[];
  settled: ReadonlyMap<string, Settled>;
  read: InboundRead;
  making: boolean;
}>;

type Actions = Readonly<{
  follow: (owner: string | null) => void;
  /** Reads the private history again and settles what it can. */
  check: () => Promise<void>;
  make: (form: Omit<NewInvoice, 'to'>) => Promise<Made>;
}>;

let ticket = 0;

export const usePrivateInvoices = create<State & Actions>((set, get) => {
  const resettle = (kept: readonly KeptInvoice[]) => set({ kept, settled: settle(kept, [], Date.now()) });

  async function load(owner: string): Promise<void> {
    const mine = ++ticket;
    const kept = await keptInvoices(owner).catch(() => [] as readonly KeptInvoice[]);
    if (mine !== ticket) return;
    set({ loaded: true });
    resettle(kept);
  }

  return {
    owner: null,
    loaded: false,
    kept: [],
    settled: new Map(),
    read: 'idle',
    making: false,

    follow: (owner) => {
      if (owner === get().owner) return;
      ticket += 1;
      dropBook();
      set({ owner, loaded: false, kept: [], settled: new Map(), read: 'idle', making: false });
      if (owner) void load(owner);
    },

    check: async () => {
      const owner = get().owner;
      if (!owner || get().read === 'reading') return;
      const mine = ticket;
      set({ read: 'reading' });
      try {
        const ctx = await loadPrivate();
        const inbound = await readInbound(ctx, owner);
        if (mine !== ticket) return;
        if (inbound === null) return set({ read: 'nokeys' });
        const kept = get().kept;
        const settled = settle(kept, inbound, Date.now());
        // A payment found for the first time is sealed, so the next read never moves it.
        const found = newlyPaid(kept, settled);
        for (const { id, paid } of found) await markPaid(owner, id, paid).catch(() => undefined);
        if (mine !== ticket) return;
        const byId = new Map(found.map((f) => [f.id, f.paid]));
        set({ kept: kept.map((k) => (byId.has(k.invoice.id) ? { ...k, paid: byId.get(k.invoice.id)! } : k)), settled, read: 'ready' });
      } catch {
        if (mine === ticket) set({ read: 'failed', settled: settle(get().kept, [], Date.now()) });
      }
    },

    make: async (form) => {
      const owner = get().owner;
      if (!owner || get().making) return { ok: false, reason: 'failed' };
      set({ making: true });
      const mine = ticket;
      try {
        const ctx = await loadPrivate();
        // The payment lands in the private balance: an invoice is made only for a wallet whose private balance is on.
        if (!(await takesPrivate(ctx, owner))) return { ok: false, reason: 'closed' };
        const sinceSlot = await invoiceSlot(ctx);
        const invoice = makeInvoice({ ...form, to: owner }, Date.now(), crypto.getRandomValues(new Uint8Array(8)));
        if (!invoice) return { ok: false, reason: 'invalid' };
        const fragment = await encodeInvoice(invoice);
        const kept = await keepInvoice(owner, invoice, sinceSlot, fragment);
        if (mine === ticket) resettle([...get().kept, kept]);
        return { ok: true, kept, url: payUrl(window.location.origin, fragment) };
      } catch {
        return { ok: false, reason: 'failed' };
      } finally {
        if (mine === ticket) set({ making: false });
      }
    },
  };
});

/** The link of a kept invoice, on this site. */
export function keptUrl(kept: Pick<KeptInvoice, 'fragment'>): string {
  return payUrl(window.location.origin, kept.fragment);
}
