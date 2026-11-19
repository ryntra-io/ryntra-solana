/**
 * The private balance of the connected wallet, for the screens: where it stands, what it holds, and the things a person
 * does with it — turn it on, hide, return, send privately (to a wallet, or as a link), take a link back. Every step is
 * `flows.ts`; keys live in `vault.client.ts`; the wallet signs through `wallet.client.ts`.
 *
 * Two rules keep money and keys safe when the network answers badly:
 * - «landed» and «read» are apart. A step whose transaction landed is done, with its signature on screen, even when the
 *   balance cannot be read right after it (`NOT_READ`); nothing is sent a second time because a read failed.
 * - keys already kept are never replaced. «Turn on» uses the kept keys when there are any, and forgets only keys it made
 *   itself a moment ago and the chain refused.
 */

import { create } from 'zustand';
import { decodeKeyCopy, decodeLinkSecret, encodeKeyCopy, encodeLinkSecret, linkFragmentsIn } from './codes.ts';
import {
  PrivateError,
  canReceive,
  enable,
  giveBack,
  hide,
  makeLink,
  makeSecrets,
  openBook,
  ownKeys,
  readLink,
  registrationOf,
  sdkCodes,
  send,
  sync,
  takeLink,
  type Book,
  type Ctx,
  type Held,
  type Landed,
  type OwnSecrets,
} from './flows.ts';
import { privateNetwork } from './network.ts';
import { loadPrivate } from './sdk.client.ts';
import { copiedId, forget, ids, keysId, linkId, seal, unseal, type StoredKeys, type StoredLink } from './vault.client.ts';
import { walletSigner } from './wallet.client.ts';

export type PrivatePhase =
  | 'shut' // the flag is closed
  | 'none' // no wallet of the person's own
  | 'loading'
  | 'off' // not turned on for this wallet yet
  | 'elsewhere' // turned on with keys this browser does not hold
  | 'ready'
  | 'failed';

export type PrivateBusy = 'on' | 'hide' | 'return' | 'send' | 'link' | 'take' | 'restore' | null;

export type PrivateLink = Readonly<{ address: string; lamports: bigint; at: number; url: string }>;

export type PrivateFailure = Readonly<{ code: string; detail: string }>;

type State = Readonly<{
  wallet: string | null;
  owner: string | null;
  phase: PrivatePhase;
  held: readonly Held[] | null;
  busy: PrivateBusy;
  failure: PrivateFailure | null;
  last: Readonly<{ action: Exclude<PrivateBusy, null>; signature: string }> | null;
  /** Links made and funded, not yet taken back by this browser. */
  links: readonly PrivateLink[];
  /** The key copy is not saved since the keys or the links last changed. */
  copyDue: boolean;
}>;

type Actions = Readonly<{
  follow: (wallet: string | null, owner: string | null) => void;
  refresh: () => Promise<void>;
  turnOn: () => Promise<void>;
  restore: (text: string) => Promise<boolean>;
  /** The key copy and the links nobody has taken yet, for the file the person saves. */
  keyCopy: () => Promise<Readonly<{ code: string; links: readonly string[] }> | null>;
  copySaved: () => Promise<void>;
  hide: (lamports: bigint) => Promise<boolean>;
  giveBack: (lamports: bigint) => Promise<boolean>;
  /** 'sent' — privately to a wallet with a private balance; 'link' — that wallet has none, a link is the way. */
  send: (to: string, lamports: bigint) => Promise<'sent' | 'link' | null>;
  makeLink: (lamports: bigint) => Promise<string | null>;
  takeBack: (address: string) => Promise<boolean>;
  clearFailure: () => void;
}>;

const NETWORK = 'devnet';

let ctx: Ctx | null = null;
let book: Book | null = null;
let ticket = 0;

function failureOf(error: unknown): PrivateFailure {
  if (error instanceof PrivateError) return { code: error.code, detail: error.message };
  const codes = sdkCodes(error);
  return { code: codes.at(-1) ?? 'UNKNOWN', detail: error instanceof Error ? error.message : String(error) };
}

/** The balance could not be read after a step that landed: the step is done, the figure is late. */
const NOT_READ: PrivateFailure = { code: 'NOT_READ', detail: 'landed; the balance was not read' };

function linkUrl(fragment: string): string {
  return `${window.location.origin}/private/claim#${fragment}`;
}

const secretsOf = (stored: StoredKeys): OwnSecrets => ({ viewing: Uint8Array.from(stored.viewing), nullifier: Uint8Array.from(stored.nullifier) });

export const usePrivate = create<State & Actions>((set, get) => {
  const signer = () => {
    const { wallet, owner } = get();
    if (!wallet || !owner) throw new PrivateError('WALLET_REFUSED', 'no wallet');
    return walletSigner(wallet, owner);
  };

  async function storedLinks(owner: string): Promise<readonly (StoredLink & { id: string })[]> {
    const out: (StoredLink & { id: string })[] = [];
    for (const id of await ids(`link:${NETWORK}:${owner}:`)) {
      const stored = await unseal<StoredLink>(id);
      if (stored) out.push({ ...stored, id });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Only links that carry money are listed; one left half made is finished by the next «Send as a link». */
  async function readLinks(owner: string): Promise<readonly PrivateLink[]> {
    return (await storedLinks(owner)).filter((l) => l.funded).map((l) => ({ address: l.address, lamports: BigInt(l.lamports), at: l.at, url: linkUrl(l.fragment) }));
  }

  async function copyDue(owner: string): Promise<boolean> {
    return !(await unseal<boolean>(copiedId(NETWORK, owner)));
  }

  async function copyChanged(owner: string): Promise<void> {
    await seal(copiedId(NETWORK, owner), false);
    set({ copyDue: true });
  }

  /** Reads the balance after a step; a failed read never undoes the step. */
  async function reread(slot?: bigint): Promise<void> {
    if (!ctx || !book) return;
    try {
      set({ held: await sync(ctx, book, slot) });
    } catch {
      set({ failure: NOT_READ });
    }
  }

  async function open(owner: string): Promise<void> {
    const mine = ++ticket;
    set({ phase: 'loading', held: null, failure: null });
    try {
      ctx = await loadPrivate();
      const stored = await unseal<StoredKeys>(keysId(NETWORK, owner));
      const keys = stored ? ownKeys(ctx, owner, secretsOf(stored)) : null;
      const registration = await registrationOf(ctx, owner, keys);
      if (mine !== ticket) return;
      if (registration === 'other') return set({ phase: 'elsewhere' });
      if (!keys || registration === 'none') return set({ phase: 'off', links: await readLinks(owner) });
      book = openBook(ctx, owner, keys);
      const held = await sync(ctx, book);
      if (mine !== ticket) return;
      set({ phase: 'ready', held, links: await readLinks(owner), copyDue: await copyDue(owner) });
    } catch (error) {
      if (mine === ticket) set({ phase: 'failed', failure: failureOf(error) });
    }
  }

  /** Runs one step: busy from the first moment, the signature kept once it landed, the balance read apart. */
  async function step(busy: Exclude<PrivateBusy, null>, act: () => Promise<Landed | null>): Promise<boolean> {
    if (get().busy) return false;
    set({ busy, failure: null });
    let landed: Landed | null;
    try {
      landed = await act();
    } catch (error) {
      set({ failure: failureOf(error), busy: null });
      return false;
    }
    if (landed) set({ last: { action: busy, signature: landed.signature } });
    await reread(landed?.slot);
    set({ busy: null });
    return true;
  }

  return {
    wallet: null,
    owner: null,
    phase: privateNetwork() ? 'none' : 'shut',
    held: null,
    busy: null,
    failure: null,
    last: null,
    links: [],
    copyDue: false,

    follow: (wallet, owner) => {
      if (!privateNetwork()) return;
      if (wallet === get().wallet && owner === get().owner) return;
      ticket += 1;
      book = null;
      set({ wallet, owner, phase: owner ? 'loading' : 'none', held: null, failure: null, last: null, links: [], copyDue: false });
      if (owner) void open(owner);
    },

    refresh: async () => {
      const owner = get().owner;
      if (owner) await open(owner);
    },

    turnOn: async () => {
      const owner = get().owner;
      if (!owner || get().busy) return;
      set({ busy: 'on', failure: null });
      let made = false;
      try {
        ctx ??= await loadPrivate();
        // Kept keys are used as they are; new keys are made only when none are kept, and sealed before anything is signed.
        const kept = await unseal<StoredKeys>(keysId(NETWORK, owner));
        let secrets: OwnSecrets;
        if (kept) secrets = secretsOf(kept);
        else {
          secrets = makeSecrets(ctx.sdk);
          await seal(keysId(NETWORK, owner), { viewing: [...secrets.viewing], nullifier: [...secrets.nullifier], from: 'own' } satisfies StoredKeys);
          await seal(copiedId(NETWORK, owner), false);
          made = true;
        }
        const keys = ownKeys(ctx, owner, secrets);
        const landed = await enable(ctx, signer(), keys);
        book = openBook(ctx, owner, keys);
        set({ phase: 'ready', held: [], copyDue: await copyDue(owner), last: landed ? { action: 'on', signature: landed.signature } : null });
        await reread(landed?.slot);
      } catch (error) {
        // The chain holds other keys for this wallet. Keys made a moment ago are of no use and go; kept ones stay.
        if (error instanceof PrivateError && error.code === 'KEYS_ELSEWHERE') {
          if (made) await forget(keysId(NETWORK, owner));
          set({ phase: 'elsewhere' });
        }
        set({ failure: failureOf(error) });
      } finally {
        set({ busy: null });
      }
    },

    restore: async (text) => {
      const owner = get().owner;
      if (!owner || get().busy) return false;
      set({ busy: 'restore', failure: null });
      try {
        const copy = await decodeKeyCopy(text);
        if (!copy) throw new PrivateError('KEYS_ELSEWHERE', 'not a key copy');
        if (copy.owner !== owner || copy.network !== NETWORK) throw new PrivateError('KEYS_ELSEWHERE', 'another wallet');
        ctx ??= await loadPrivate();
        const keys = ownKeys(ctx, owner, copy);
        if ((await registrationOf(ctx, owner, keys)) !== 'mine') throw new PrivateError('KEYS_ELSEWHERE', 'not these keys');
        await seal(keysId(NETWORK, owner), { viewing: [...copy.viewing], nullifier: [...copy.nullifier], from: 'own' } satisfies StoredKeys);
        await seal(copiedId(NETWORK, owner), true);
        // The links the copy carries come back as well, if they still hold money.
        for (const fragment of linkFragmentsIn(text)) {
          const seed = await decodeLinkSecret(fragment);
          if (!seed) continue;
          const state = await readLink(ctx, seed).catch(() => null);
          if (state && state.held > 0n) {
            await seal(linkId(NETWORK, owner, state.address), { seed: [...seed], lamports: state.held.toString(), at: Date.now(), address: state.address, fragment, funded: true } satisfies StoredLink);
          }
          seed.fill(0);
        }
        book = openBook(ctx, owner, keys);
        set({ phase: 'ready', held: [], copyDue: false, links: await readLinks(owner) });
        await reread();
        return true;
      } catch (error) {
        set({ failure: failureOf(error) });
        return false;
      } finally {
        set({ busy: null });
      }
    },

    keyCopy: async () => {
      const owner = get().owner;
      if (!owner) return null;
      const stored = await unseal<StoredKeys>(keysId(NETWORK, owner));
      if (!stored) return null;
      const code = await encodeKeyCopy({ network: NETWORK, owner, viewing: Uint8Array.from(stored.viewing), nullifier: Uint8Array.from(stored.nullifier) });
      const links = (await storedLinks(owner)).map((l) => linkUrl(l.fragment));
      return { code, links };
    },

    copySaved: async () => {
      const owner = get().owner;
      if (!owner) return;
      await seal(copiedId(NETWORK, owner), true);
      set({ copyDue: false });
    },

    hide: (lamports) => step('hide', () => hide(ctx!, signer(), book!, lamports)),
    giveBack: (lamports) => step('return', () => giveBack(ctx!, signer(), book!, lamports)),

    send: async (to, lamports) => {
      if (!ctx || !book) return null;
      // Busy from the first moment: the recipient is read inside the step, so a second tap changes nothing.
      let needsLink = false;
      const ok = await step('send', async () => {
        if (!(await canReceive(ctx!, to))) {
          needsLink = true;
          return null;
        }
        return send(ctx!, signer(), book!, to, lamports);
      });
      return needsLink ? 'link' : ok ? 'sent' : null;
    },

    makeLink: async (lamports) => {
      const owner = get().owner;
      if (!owner || !ctx || !book) return null;
      let url: string | null = null;
      const ok = await step('link', async () => {
        // A link left half made is finished first — its fees are paid already; a new one is made only when none waits.
        const pending = (await storedLinks(owner)).find((l) => !l.funded);
        const seed = pending ? Uint8Array.from(pending.seed) : crypto.getRandomValues(new Uint8Array(32));
        const fragment = pending?.fragment ?? (await encodeLinkSecret(seed));
        const record = (address: string, funded: boolean): StoredLink => ({ seed: [...seed], lamports: lamports.toString(), at: pending?.at ?? Date.now(), address, fragment, funded });
        const made = await makeLink(ctx!, signer(), book!, lamports, seed, async (address) => {
          await seal(linkId(NETWORK, owner, address), record(address, false));
          await copyChanged(owner);
        });
        await seal(linkId(NETWORK, owner, made.link), record(made.link, true));
        seed.fill(0);
        url = linkUrl(fragment);
        return made.steps.at(-1) ?? null;
      });
      set({ links: await readLinks(owner) });
      return ok ? url : null;
    },

    takeBack: async (address) => {
      const owner = get().owner;
      if (!owner || !ctx) return false;
      const id = linkId(NETWORK, owner, address);
      const stored = await unseal<StoredLink>(id);
      if (!stored) return false;
      let gone = false;
      const ok = await step('take', async () => {
        const state = await readLink(ctx!, Uint8Array.from(stored.seed));
        if (state.held <= 0n) {
          gone = true; // already taken by whoever had the link
          return null;
        }
        const landed = await takeLink(ctx!, state, owner, 'private');
        gone = true;
        return landed;
      });
      if (ok && gone) await forget(id);
      set({ links: await readLinks(owner) });
      return ok;
    },

    clearFailure: () => set({ failure: null }),
  };
});

