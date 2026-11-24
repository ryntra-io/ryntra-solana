/**
 * «Payouts» for the screen: the list the person brings, what the ring knows about its recipients and the private
 * balance's parts, the payout under way, and the person's own record. Every rule is pure and lives beside this file
 * (`list.ts`, `check.ts`, `plan.ts`, `fee.ts`, `../ledger/ledger.ts`); every step on the ring is `run.ts`; links are the
 * private balance's own (`usePrivate().makeLink`) — no new mechanism.
 *
 * The private balance itself — on or off, its keys, its sum — is `usePrivate`'s; this store reads the same sealed keys
 * to follow the balance's parts with a book of its own (until `usePrivate` hands its book out), and asks
 * `usePrivate` to read again after a payout, so the Portfolio shows the new sum.
 *
 * Money safety, as in `usePrivate`:
 * - a step that landed is written to the record at once, with its signature; a failed read after it changes nothing;
 * - a step whose answer was lost after the wallet signed is «not known», never «not paid»: «Repeat» offers only lines
 *   that surely did not go, so nobody is paid twice;
 * - one payout at a time; a second press does nothing while one runs.
 */

import { create } from 'zustand';
import { keyCopyFile } from '../codes.ts';
import { PrivateError, openBook, ownKeys, sync, type Book, type Ctx, type WalletKeys } from '../flows.ts';
import { PRIVATE_NET, privateNetwork } from '../network.ts';
import { loadPrivate } from '../sdk.client.ts';
import { usePrivate } from '../usePrivate.ts';
import { heldKeys, keysId, unseal, type StoredKeys } from '../vault.client.ts';
import { walletSigner } from '../wallet.client.ts';
import { paidCount, recordId, settle, type LedgerLine, type PayoutRecord } from '../ledger/ledger.ts';
import { copyLine, readLedger, restoreFrom, writePayout } from '../ledger/store.client.ts';
import { unitsText, type CheckedRow, type NoPrivateWay } from './check.ts';
import type { FeeRule } from './fee.ts';
import type { PayCoin } from './list.ts';
import { SIGNATURES, type Plan, type PlanStep } from './plan.ts';
import { abilities, merge, mergeIsOn, partsOf, payOpen, readRegistered, transfer, turnMergeOn, type Abilities, type Stage, type StepCtx } from './run.ts';

const NETWORK = PRIVATE_NET;

/** How a payout ended: all paid; stopped (the wallet said no, or a step did not go — nothing of it moved); not known. */
export type PayEnd = 'done' | 'stopped' | 'unknown';

export type PayRun = Readonly<{ record: PayoutRecord; step: number; steps: number; signed: number; signatures: number; stage: Stage }>;

export type PayResult = Readonly<{
  record: PayoutRecord;
  end: PayEnd;
  /** Why it stopped: the wallet did not sign, or the step did not go. */
  why: 'refused' | 'failed' | null;
  /** Links made in this payout, by the record's line, to hand to their people. */
  links: readonly Readonly<{ line: number; url: string }>[];
}>;

type State = Readonly<{
  wallet: string | null;
  owner: string | null;
  /** The list as the person wrote or pasted it. */
  text: string;
  way: NoPrivateWay;
  registered: ReadonlyMap<string, boolean>;
  /** The private balance's spendable parts in SOL; null until read. */
  parts: readonly bigint[] | null;
  mergeOn: boolean;
  can: Abilities | null;
  reading: boolean;
  readFailed: boolean;
  ledger: readonly PayoutRecord[];
  run: PayRun | null;
  result: PayResult | null;
}>;

type Actions = Readonly<{
  follow: (wallet: string | null, owner: string | null) => void;
  setText: (text: string) => void;
  /** Adds lines under the list. */
  add: (text: string) => void;
  /** Takes one line of the list out. */
  drop: (line: number) => void;
  setWay: (way: NoPrivateWay) => void;
  /** Reads the recipients not read yet, and the balance's parts — again when `fresh` (the balance moved). */
  prepare: (addresses: readonly string[], fresh?: boolean) => Promise<void>;
  pay: (input: Readonly<{ rows: readonly CheckedRow[]; plan: Plan; coin: PayCoin; fee: FeeRule }>) => Promise<void>;
  /** Back to an empty list after a payout; `text` — start from these lines instead. */
  again: (text?: string) => void;
  /** The key copy with the payout record in it, for the file the person saves; null when there are no keys here. */
  keyCopyFile: (title: string) => Promise<string | null>;
  restore: (text: string) => Promise<number | null>;
}>;

let ctx: Ctx | null = null;
let book: Book | null = null;
/** Reads under way; «checking» shows until the last one ends. */
let reads = 0;

async function bookFor(c: Ctx, owner: string): Promise<Book | null> {
  // Keys the wallet gave in this tab come first (the private balance checked them against the ring's record); older
  // sealed keys only when there are none.
  const fromWallet = heldKeys<WalletKeys>(NETWORK, owner);
  if (fromWallet) {
    if (book && book.owner === owner && book.keys === fromWallet) return book;
    book = openBook(c, owner, fromWallet);
    return book;
  }
  if (book && book.owner === owner) return book;
  const stored = await unseal<StoredKeys>(keysId(NETWORK, owner));
  if (!stored) return null;
  book = openBook(c, owner, ownKeys(c, owner, { viewing: Uint8Array.from(stored.viewing), nullifier: Uint8Array.from(stored.nullifier) }));
  return book;
}

/** The record's lines, in the order the rows stand; `index` finds a row's line. */
function linesOf(rows: readonly CheckedRow[], coin: PayCoin): { lines: LedgerLine[]; index: Map<string, number> } {
  const index = new Map<string, number>();
  const lines: LedgerLine[] = [];
  for (const row of rows) {
    if (!row.address || row.units === null || !row.route) continue;
    index.set(row.id, lines.length);
    lines.push({ name: row.name, to: row.address, amount: unitsText(row.units, coin.decimals), coin: coin.symbol, note: row.note, how: row.route, state: 'waiting', signature: null, link: null });
  }
  return { lines, index };
}

/** Which lines a step pays. */
function stepLines(step: PlanStep, plan: Plan, index: ReadonlyMap<string, number>): Set<number> {
  const ids = step.kind === 'transfer' ? plan.batches[step.batch].payments.map((p) => p.id) : step.kind === 'open' || step.kind === 'link' ? [step.payment.id] : [];
  return new Set(ids.map((id) => index.get(id)).filter((i): i is number => i !== undefined));
}

export const usePayouts = create<State & Actions>((set, get) => {
  async function reloadLedger(owner: string): Promise<void> {
    try {
      const ledger = await readLedger(NETWORK, owner);
      if (get().owner === owner) set({ ledger });
    } catch {
      /* the record is the browser's; an unreadable store shows no history */
    }
  }

  async function readParts(owner: string): Promise<void> {
    ctx ??= await loadPrivate();
    const b = await bookFor(ctx, owner);
    if (!b) return set({ parts: null });
    await sync(ctx, b);
    const mergeOn = await mergeIsOn(ctx, owner);
    // Another wallet came meanwhile: these parts are not its.
    if (get().owner !== owner) return;
    set({ parts: partsOf(b, String(ctx.sdk.SOL_MINT)), mergeOn, can: abilities(ctx) });
  }

  return {
    wallet: null,
    owner: null,
    text: '',
    way: 'link',
    registered: new Map(),
    parts: null,
    mergeOn: false,
    can: null,
    reading: false,
    readFailed: false,
    ledger: [],
    run: null,
    result: null,

    follow: (wallet, owner) => {
      if (!privateNetwork()) return;
      if (wallet === get().wallet && owner === get().owner) return;
      book = null;
      set({ wallet, owner, registered: new Map(), parts: null, can: null, readFailed: false, ledger: [], result: null });
      if (owner) void reloadLedger(owner);
    },

    setText: (text) => set({ text }),
    add: (text) => {
      const now = get().text.replace(/\s+$/, '');
      set({ text: now ? `${now}\n${text.replace(/^\s+/, '')}` : text });
    },
    drop: (line) => set({ text: get().text.split(/\r?\n/).filter((_, i) => i !== line - 1).join('\n') }),
    setWay: (way) => set({ way }),

    prepare: async (addresses, fresh = false) => {
      const owner = get().owner;
      if (!owner || get().run) return;
      // What the ring says of an address is a fact, whichever read asked first: every answer for this wallet is kept.
      reads += 1;
      set({ reading: true, readFailed: false });
      try {
        ctx ??= await loadPrivate();
        const unknown = addresses.filter((a) => !get().registered.has(a));
        if (unknown.length) {
          const read = await readRegistered(ctx, unknown);
          if (get().owner !== owner) return;
          set({ registered: new Map([...get().registered, ...read]) });
        }
        if (fresh || get().parts === null) await readParts(owner);
      } catch {
        if (get().owner === owner) set({ readFailed: true });
      } finally {
        reads -= 1;
        if (reads === 0) set({ reading: false });
      }
    },

    pay: async ({ rows, plan, coin, fee }) => {
      const { wallet, owner } = get();
      if (!wallet || !owner || get().run || !plan.steps.length || plan.short > 0n || plan.stuck) return;
      ctx ??= await loadPrivate();
      const b = await bookFor(ctx, owner);
      if (!b) return;
      const { lines, index } = linesOf(rows, coin);
      const at = Date.now();
      let record: PayoutRecord = { v: 1, id: recordId(at, crypto.getRandomValues(new Uint32Array(1))[0]), at, network: NETWORK, coin: coin.symbol, fee: unitsText(plan.fee, coin.decimals), lines };
      const links: { line: number; url: string }[] = [];
      let stage: Stage = 'proving';
      let signed = 0;
      let done = 0;
      const show = () => set({ run: { record, step: Math.min(done + 1, plan.steps.length), steps: plan.steps.length, signed, signatures: plan.signatures, stage } });
      const save = async () => {
        await writePayout(NETWORK, owner, record).catch(() => undefined);
        set({ ledger: [record, ...get().ledger.filter((r) => r.id !== record.id)] });
      };
      await save();
      show();
      const step: StepCtx = {
        ctx,
        book: b,
        wallet: walletSigner(wallet, owner),
        mint: String(ctx.sdk.SOL_MINT),
        on: (next) => {
          stage = next;
          show();
        },
      };

      let end: PayEnd = 'done';
      let why: PayResult['why'] = null;
      let unsure = new Set<number>();
      for (const s of plan.steps) {
        const ids = stepLines(s, plan, index);
        stage = s.kind === 'link' ? 'signing' : 'proving';
        show();
        try {
          if (s.kind === 'mergeOn') await turnMergeOn(step);
          else if (s.kind === 'merge') await merge(step);
          else if (s.kind === 'transfer') {
            const landed = await transfer(step, plan.batches[s.batch], fee.to);
            record = settle(record, ids, 'paid', landed.signature);
          } else if (s.kind === 'open') {
            const landed = await payOpen(step, s.payment);
            record = settle(record, ids, 'paid', landed.signature);
          } else {
            // A link is the private balance's own: it reads its balance after our spends first.
            const priv = usePrivate.getState();
            await priv.refresh();
            const url = await usePrivate.getState().makeLink(s.payment.units);
            if (!url) {
              const code = usePrivate.getState().failure?.code;
              throw new PrivateError(code === 'WALLET_REFUSED' ? 'WALLET_REFUSED' : 'SEND_FAILED', code ?? 'link');
            }
            const made = usePrivate.getState().links.find((l) => l.url === url);
            const i = [...ids][0];
            if (i !== undefined) links.push({ line: i, url });
            record = settle(record, ids, 'paid', null, made?.address ?? null);
            // The link's steps spent from the private balance: this book reads them before the next spend.
            await sync(ctx, b).catch(() => undefined);
          }
          signed += SIGNATURES[s.kind];
          done += 1;
          await save();
          show();
        } catch (error) {
          const code = error instanceof PrivateError ? error.code : null;
          // Before the wallet signed — or the wallet said no — nothing of this step moved. After it signed, not known.
          const sure = code === 'WALLET_REFUSED' || code === 'WALLET_CHANGED_MESSAGE' || stage === 'proving';
          end = sure ? 'stopped' : 'unknown';
          why = code === 'WALLET_REFUSED' ? 'refused' : sure ? 'failed' : null;
          if (sure) record = settle(record, ids, 'failed', null);
          else unsure = ids;
          break;
        }
      }
      // Lines no step reached are surely not paid; only the lines of a step whose answer was lost stay «not known».
      record = { ...record, lines: record.lines.map((l, i) => (l.state === 'waiting' && !unsure.has(i) ? { ...l, state: 'failed' } : l)) };
      if (end === 'done' && paidCount(record) !== record.lines.length) end = 'stopped';
      await save();
      set({ run: null, result: { record, end, why, links } });
      // The balance moved: its parts and the Portfolio's sum are read again.
      void readParts(owner).catch(() => undefined);
      void usePrivate.getState().refresh();
    },

    again: (text = '') => set({ result: null, text }),

    keyCopyFile: async (title) => {
      const owner = get().owner;
      if (!owner) return null;
      const copy = await usePrivate.getState().keyCopy();
      if (!copy) return null;
      const line = await copyLine(NETWORK, owner);
      return keyCopyFile(copy.code, title, [...copy.links, ...(line ? [line] : [])]);
    },

    restore: async (text) => {
      const owner = get().owner;
      if (!owner) return null;
      const added = await restoreFrom(text, NETWORK, owner);
      await reloadLedger(owner);
      return added;
    },
  };
});
