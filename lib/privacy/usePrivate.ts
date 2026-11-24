/**
 * The private balance of the connected wallet, for the screens: where it stands, what it holds, and the things a person
 * does with it — turn it on, open it, hide, return, send privately (to a wallet, or as a link), take a link back. Every
 * step is `flows.ts`; the rules of keys and states are `check.ts`; the wallet signs through `wallet.client.ts`.
 *
 * Keys come from the wallet only. The ring's registry holds one record per address and its nullifier key never
 * changes, so an address is registered only with keys its own wallet gives — the signature over the key request, which
 * the same wallet gives again on any device. The signature becomes keys at once and is zeroed; the keys live in this
 * tab's memory (`vault.client.ts`), never in storage, a log or analytics. A reload asks the wallet once more.
 * - Turn on: the wallet signs the key request twice — both answers must be the same, or keys made from it would differ
 *   next time — then the registry is read, and only an address with no record is registered.
 * - Open: one signature; the keys must match the registry's record. Other keys (another app, such as Solflare Private
 *   Mode, or older keys) — nothing is written, and the screen says so.
 * - Older test keys, sealed in this browser before this rule, still open their balance and still give their
 *   key copy, so test money is not lost; no address is registered with keys of the browser's own any more.
 *
 * Two rules keep money safe when the network answers badly:
 * - «landed» and «read» are apart. A step whose transaction landed is done, with its signature on screen, even when the
 *   balance cannot be read right after it (`NOT_READ`); nothing is sent a second time because a read failed.
 * - a step shows where it is (`stage`): the key request, preparing (the private proof may take up to 20 seconds), the
 *   wallet's signature, sending, reading — never a frozen button.
 */

import { create } from 'zustand';
import {
  keysFromAnswer,
  keysRequest,
  phaseOf,
  publicOf,
  recordVerdict,
  sameBytes,
  type KeysAnswer,
  type KeysCannot,
  type KeysFromWhere,
  type PhaseFacts,
  type PrivatePhase,
  type RecordKeys,
} from './check.ts';
import { decodeKeyCopy, decodeLinkSecret, encodeKeyCopy, encodeLinkSecret, linkFragmentsIn } from './codes.ts';
import {
  PrivateError,
  canReceive,
  enable,
  giveBack,
  hide,
  makeLink,
  openBook,
  ownKeys,
  readLink,
  sdkCodes,
  send,
  sync,
  takeLink,
  type Book,
  type Ctx,
  type Held,
  type Landed,
  type OwnSecrets,
  type WalletKeys,
} from './flows.ts';
import { PRIVATE_NET, privateNetwork } from './network.ts';
import { loadPrivate, proveForRelay } from './sdk.client.ts';
import { copiedId, dropKeys, forget, heldKeys, holdKeys, ids, keysId, linkId, seal, unseal, type StoredKeys, type StoredLink } from './vault.client.ts';
import { signMessageBytes, walletFeatures, walletSigner, watchedSigner } from './wallet.client.ts';

export type { PrivatePhase } from './check.ts';

export type PrivateBusy = 'on' | 'open' | 'hide' | 'return' | 'send' | 'link' | 'take' | 'restore' | null;

/**
 * Where a running step is, for the screen's one waiting line: the key request and its repeat, preparing (the private
 * proof — up to 20 seconds), the wallet's signature, sending and waiting for the network, reading the balance.
 */
export type PrivateStage = 'keys' | 'again' | 'prepare' | 'sign' | 'send' | 'read';

export type PrivateLink = Readonly<{ address: string; lamports: bigint; at: number; url: string }>;

export type PrivateFailure = Readonly<{ code: string; detail: string }>;

type State = Readonly<{
  wallet: string | null;
  owner: string | null;
  phase: PrivatePhase;
  /** Where the open balance's keys come from: the wallet (memory only) or older sealed keys. */
  keys: KeysFromWhere | null;
  /** Why this wallet does not give the keys, when it does not. */
  cannot: KeysCannot | null;
  held: readonly Held[] | null;
  busy: PrivateBusy;
  stage: PrivateStage | null;
  /** When the stage began (ms), for the seconds on the waiting line. */
  since: number | null;
  failure: PrivateFailure | null;
  last: Readonly<{ action: Exclude<PrivateBusy, null>; signature: string }> | null;
  /** Links made and funded, not yet taken back by this browser. */
  links: readonly PrivateLink[];
  /** Older keys only: the key copy is not saved since the keys or the links last changed. */
  copyDue: boolean;
}>;

type Actions = Readonly<{
  follow: (wallet: string | null, owner: string | null) => void;
  refresh: () => Promise<void>;
  /** Not registered: the keys from the wallet (two signatures of the key request), then the registration. */
  turnOn: () => Promise<void>;
  /** Registered: the keys from the wallet (one signature), checked against the registry. */
  unlock: () => Promise<void>;
  restore: (text: string) => Promise<boolean>;
  /** Older keys only: the key copy and the links nobody has taken yet, for the file the person saves. */
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

const NETWORK = PRIVATE_NET;

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

/** The wallet did not sign the key request: nothing was written. */
function refused(error: unknown): Error {
  const failure = new Error(error instanceof Error ? error.message : String(error)) as Error & { code: string };
  failure.code = 'KEYS_REFUSED';
  return failure;
}

function linkUrl(fragment: string): string {
  return `${window.location.origin}/private/claim#${fragment}`;
}

const secretsOf = (stored: StoredKeys): OwnSecrets => ({ viewing: Uint8Array.from(stored.viewing), nullifier: Uint8Array.from(stored.nullifier) });

/** The registry's record for this address, from the ring's indexer; null — not registered. */
async function readRecord(context: Ctx, owner: string): Promise<RecordKeys | null> {
  const { records } = await context.client.getUserRecords([owner]);
  return (records[0] as RecordKeys | null | undefined) ?? null;
}

/** One signature of the key request; 'no-sign' — the wallet has no message signing; a refusal is thrown. */
async function askKeys(wallet: string, owner: string, request: Uint8Array): Promise<KeysAnswer | 'no-sign'> {
  let answer: KeysAnswer | null;
  try {
    answer = await signMessageBytes(wallet, owner, request);
  } catch (error) {
    throw refused(error);
  }
  return answer ?? 'no-sign';
}

const destroy = (keys: WalletKeys | null) => (keys as { destroy?: () => void } | null)?.destroy?.();

type Facts = Omit<PhaseFacts, 'open' | 'owner'>;
const NO_FACTS: Facts = { record: 'reading', inTab: null, sealed: null, cannot: null };

export const usePrivate = create<State & Actions>((set, get) => {
  let facts: Facts = NO_FACTS;

  /** The block's state from what is known (`check.ts`), set in one move. */
  function settle(patch: Partial<Facts>): void {
    facts = { ...facts, ...patch };
    const { phase, keys } = phaseOf({ open: Boolean(privateNetwork()), owner: get().owner, ...facts });
    set({ phase, keys, cannot: facts.cannot });
  }

  const stage = (next: PrivateStage | null) => set({ stage: next, since: next ? Date.now() : null });

  /**
   * Before a step the person starts: where the relay serves a proven wallet only, the wallet proves itself to
   * Ryntra once — one signed message, never a transaction, nothing asked when the proof is already here. Devnet asks
   * nothing. False — not proven, and the screen says so; reading the balance on its own never asks the wallet.
   */
  async function proven(): Promise<boolean> {
    const { wallet, owner } = get();
    const answer = await proveForRelay(wallet && owner ? { wallet, address: owner } : null);
    if (answer === 'ok') return true;
    set({ failure: { code: answer === 'declined' ? 'WALLET_REFUSED' : 'RELAY_SESSION', detail: 'wallet proof' } });
    return false;
  }

  /** The wallet as the steps' signer, telling the waiting line when it is asked and when it answered. */
  const signer = () => {
    const { wallet, owner } = get();
    if (!wallet || !owner) throw new PrivateError('WALLET_REFUSED', 'no wallet');
    return watchedSigner(walletSigner(wallet, owner), (moment) => stage(moment === 'asked' ? 'sign' : 'send'));
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
    if (get().keys !== 'copy') return;
    await seal(copiedId(NETWORK, owner), false);
    set({ copyDue: true });
  }

  /** Reads the balance after a step; a failed read never undoes the step. */
  async function reread(slot?: bigint): Promise<void> {
    if (!ctx || !book) return;
    stage('read');
    try {
      set({ held: await sync(ctx, book, slot) });
    } catch {
      set({ failure: NOT_READ });
    }
  }

  /**
   * Reads where this address stands before anything is asked of the wallet: the registry's record, then the keys this
   * tab holds from the wallet, then older sealed keys — whichever matches the record opens the balance.
   */
  async function open(owner: string): Promise<void> {
    const mine = ++ticket;
    const wallet = get().wallet;
    const noSign = wallet && !walletFeatures(wallet).signMessage ? ('no-sign' as const) : null;
    set({ held: null, failure: null });
    settle({ record: 'reading', inTab: null, sealed: null, cannot: facts.cannot ?? noSign });
    try {
      ctx = await loadPrivate();
      const record = await readRecord(ctx, owner);
      if (mine !== ticket) return;
      let keys: WalletKeys | null = null;
      let inTab: Facts['inTab'] = null;
      let sealed: Facts['sealed'] = null;
      if (record) {
        const fromWallet = heldKeys<WalletKeys>(NETWORK, owner);
        if (fromWallet) {
          inTab = recordVerdict(record, publicOf(fromWallet));
          if (inTab === 'mine') keys = fromWallet;
          else dropKeys();
        }
        const stored = keys ? null : await unseal<StoredKeys>(keysId(NETWORK, owner));
        if (stored) {
          const older = ownKeys(ctx, owner, secretsOf(stored));
          sealed = recordVerdict(record, publicOf(older));
          if (sealed === 'mine') keys = older;
          else destroy(older);
        }
      }
      if (keys) {
        book = openBook(ctx, owner, keys);
        const held = await sync(ctx, book);
        if (mine !== ticket) return;
        set({ held, copyDue: sealed === 'mine' ? await copyDue(owner) : false });
      }
      const links = await readLinks(owner);
      if (mine !== ticket) return;
      set({ links });
      settle({ record: record ? 'some' : 'none', inTab, sealed });
    } catch (error) {
      if (mine !== ticket) return;
      set({ failure: failureOf(error) });
      settle({ record: 'failed' });
    }
  }

  /** The wallet cannot give the keys: nothing is written, the screen says so once. */
  function cannot(why: KeysCannot): void {
    settle({ cannot: why });
  }

  /**
   * The keys from the wallet for an address not yet registered: the key request signed twice, both answers the same byte
   * for byte — a wallet that signs it differently would give other keys on the next device. Null — the wallet cannot
   * (said on the screen); a refusal is thrown. Both signatures are zeroed here.
   */
  async function keysTwice(context: Ctx, wallet: string, owner: string): Promise<WalletKeys | null> {
    const request = keysRequest(context.sdk, owner);
    stage('keys');
    const first = await askKeys(wallet, owner, request);
    if (first === 'no-sign') {
      cannot('no-sign');
      return null;
    }
    const got = keysFromAnswer(context.sdk, context.client.proofService, owner, request, first);
    if (!got.ok) {
      first.signature.fill(0);
      cannot(got.why);
      return null;
    }
    stage('again');
    let second: KeysAnswer | 'no-sign';
    try {
      second = await askKeys(wallet, owner, request);
    } catch (error) {
      first.signature.fill(0);
      destroy(got.keys);
      throw error;
    }
    const repeatable = second !== 'no-sign' && sameBytes(first.signature, second.signature) === 'yes';
    first.signature.fill(0);
    if (second !== 'no-sign') second.signature.fill(0);
    if (repeatable) return got.keys;
    destroy(got.keys);
    cannot(second === 'no-sign' ? 'no-sign' : 'differs');
    return null;
  }

  /** Runs one step: busy from the first moment, the signature kept once it landed, the balance read apart. */
  async function step(busy: Exclude<PrivateBusy, null>, act: () => Promise<Landed | null>): Promise<boolean> {
    if (get().busy) return false;
    set({ busy, failure: null });
    stage('prepare');
    if (!(await proven())) {
      set({ busy: null });
      stage(null);
      return false;
    }
    let landed: Landed | null;
    try {
      landed = await act();
    } catch (error) {
      set({ failure: failureOf(error), busy: null });
      stage(null);
      return false;
    }
    if (landed) set({ last: { action: busy, signature: landed.signature } });
    await reread(landed?.slot);
    set({ busy: null });
    stage(null);
    return true;
  }

  return {
    wallet: null,
    owner: null,
    phase: privateNetwork() ? 'none' : 'shut',
    keys: null,
    cannot: null,
    held: null,
    busy: null,
    stage: null,
    since: null,
    failure: null,
    last: null,
    links: [],
    copyDue: false,

    follow: (wallet, owner) => {
      if (!privateNetwork()) return;
      if (wallet === get().wallet && owner === get().owner) return;
      ticket += 1;
      book = null;
      // Keys from one wallet never outlive it in this tab.
      if (owner !== get().owner) dropKeys();
      facts = NO_FACTS;
      set({ wallet, owner, held: null, failure: null, last: null, links: [], copyDue: false, busy: null, stage: null, since: null });
      settle({});
      if (owner) void open(owner);
    },

    refresh: async () => {
      const owner = get().owner;
      // «Try again» is the person's tap: where the relay asks for a proven wallet, it is proved first.
      if (owner && (await proven())) await open(owner);
    },

    turnOn: async () => {
      const { wallet, owner } = get();
      if (!wallet || !owner || get().busy) return;
      set({ busy: 'on', failure: null });
      let keys: WalletKeys | null = null;
      try {
        if (!(await proven())) return;
        ctx ??= await loadPrivate();
        // Keys this tab already holds passed both signatures a moment ago (the registration was refused or failed).
        keys = heldKeys<WalletKeys>(NETWORK, owner);
        if (!keys) keys = await keysTwice(ctx, wallet, owner);
        if (!keys) return;
        if (get().owner !== owner) return;
        // The registry first: an address turned on elsewhere in the meantime is never written over.
        const verdict = recordVerdict(await readRecord(ctx, owner), publicOf(keys));
        if (get().owner !== owner) return;
        if (verdict === 'other') return settle({ record: 'some', inTab: 'other' });
        holdKeys(NETWORK, owner, keys);
        let landed: Landed | null = null;
        if (verdict === 'none') {
          stage('prepare');
          landed = await enable(ctx, signer(), keys);
        }
        book = openBook(ctx, owner, keys);
        set({ held: [], copyDue: false, last: landed ? { action: 'on', signature: landed.signature } : null });
        settle({ record: 'some', inTab: 'mine', sealed: null });
        await reread(landed?.slot);
      } catch (error) {
        // The chain holds other keys for this address: nothing was written; the keys go.
        if (error instanceof PrivateError && error.code === 'KEYS_ELSEWHERE') {
          dropKeys();
          settle({ record: 'some', inTab: 'other' });
        } else set({ failure: failureOf(error) });
      } finally {
        if (keys && owner && heldKeys(NETWORK, owner) !== keys) destroy(keys);
        set({ busy: null });
        stage(null);
      }
    },

    unlock: async () => {
      const { wallet, owner } = get();
      if (!wallet || !owner || get().busy) return;
      set({ busy: 'open', failure: null });
      let keys: WalletKeys | null = null;
      try {
        if (!(await proven())) return;
        ctx ??= await loadPrivate();
        const request = keysRequest(ctx.sdk, owner);
        stage('keys');
        const answer = await askKeys(wallet, owner, request);
        if (answer === 'no-sign') return cannot('no-sign');
        const got = keysFromAnswer(ctx.sdk, ctx.client.proofService, owner, request, answer);
        answer.signature.fill(0);
        if (!got.ok) return cannot(got.why);
        keys = got.keys;
        stage('read');
        const record = await readRecord(ctx, owner);
        if (get().owner !== owner) return;
        const verdict = recordVerdict(record, publicOf(keys));
        if (verdict === 'other') return settle({ record: 'some', inTab: 'other' });
        if (verdict === 'none') return settle({ record: 'none' });
        // The keys match: held in this tab, and the balance read as on any visit — a read that fails asks «Try again»,
        // which reads again with these keys and never asks the wallet twice.
        holdKeys(NETWORK, owner, keys);
        await open(owner);
      } catch (error) {
        set({ failure: failureOf(error) });
      } finally {
        if (keys && owner && heldKeys(NETWORK, owner) !== keys) destroy(keys);
        set({ busy: null });
        stage(null);
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
        if (!(await proven())) return false;
        ctx ??= await loadPrivate();
        const keys = ownKeys(ctx, owner, copy);
        if (recordVerdict(await readRecord(ctx, owner), publicOf(keys)) !== 'mine') throw new PrivateError('KEYS_ELSEWHERE', 'not these keys');
        // An older key copy, opened in another browser: kept here as it was kept there, so test money is not lost.
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
        set({ held: [], copyDue: false, links: await readLinks(owner) });
        settle({ record: 'some', sealed: 'mine' });
        await reread();
        return true;
      } catch (error) {
        set({ failure: failureOf(error) });
        return false;
      } finally {
        set({ busy: null });
        stage(null);
      }
    },

    keyCopy: async () => {
      const owner = get().owner;
      if (!owner || get().keys !== 'copy') return null;
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
