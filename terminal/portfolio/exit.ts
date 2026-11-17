import { create } from 'zustand';
import { citySigner } from '../../city/lib/app-bridge/route.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import type { ExitTarget } from './all-view.ts';
import { DOOR_SHUT, doorOf, maybeSent, outcomeOf, reviewBody, reviewFresh, reviewOf, type ExitDoor, type ExitMode, type ExitOutcome, type ExitReview } from './exit-view.ts';

/** The engine's answer for a door that is shut on this deployment. */
const CLOSED = 'CAPABILITY_UNAVAILABLE';

/**
 * «Exit everything» and «Collect fees» on the Portfolio: whether the engine's door is open here, the panel in front —
 * its mode, the coin to leave into, what the person switched off — the package the engine built for that, and where its
 * one approval stands. The engine picks the steps, simulates, builds and sends (`/api/v1/portfolio/exit/**`); the
 * wallet signs the whole package at once; nothing here moves money of its own.
 */

/** `empty` — the engine built nothing for this choice: not asked again until the choice moves. */
export type ExitPhase = 'idle' | 'building' | 'ready' | 'empty' | 'signing' | 'sending' | 'done' | 'failed';

/** The panel in front: an exit, or only the collecting of fees. */
export type ExitAsk = Readonly<{ mode: ExitMode }>;

type Store = {
  owner: string | null;
  door: ExitDoor;
  ask: ExitAsk | null;
  target: ExitTarget;
  /** The positions the person switched off. */
  off: readonly string[];
  /** A panel opened from one row: the only positions that are on; null — everything an exit can take is. */
  only: readonly string[] | null;
  /** The package built at the last press differs from the one that stood on screen: it is shown, not signed. */
  changed: boolean;
  /** The engine refused the signed package and sent nothing. */
  refused: boolean;
  /** The positions the last build was asked for, in one string: a build for another choice is dropped. */
  asked: string;
  review: ExitReview | null;
  /** When the review arrived, by this browser's own clock. */
  reviewAt: number;
  phase: ExitPhase;
  /** The wallet declined the last package: said in one line until the next press. */
  declined: boolean;
  outcome: ExitOutcome | null;
  /** How many times an exit landed here: the screen reads the portfolio again for each. */
  landed: number;
};

const INITIAL = { owner: null, door: DOOR_SHUT, ask: null, target: 'SOL', off: [], only: null, changed: false, refused: false, asked: '', review: null, reviewAt: 0, phase: 'idle', declined: false, outcome: null, landed: 0 } as const satisfies Store;

export const useExit = create<Store>(() => ({ ...INITIAL }));

const busy = (phase: ExitPhase) => phase === 'signing' || phase === 'sending';

type Got = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; code: string }>;

async function getJson(url: string, init?: RequestInit): Promise<Got> {
  try {
    const answer = await fetch(url, { cache: 'no-store', ...init, headers: { accept: 'application/json', 'X-Ryntra-API': '1', ...(init?.body ? { 'content-type': 'application/json' } : {}) } });
    const body = (await answer.json().catch(() => null)) as unknown;
    if (!answer.ok) return { ok: false, code: (body as { error?: { code?: string } } | null)?.error?.code ?? `HTTP_${answer.status}` };
    return { ok: true, value: body };
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
}

/** The wallet whose positions the actions are about: a switch drops everything of the last one, and asks the door. */
export function followExit(owner: string | null): void {
  const now = useExit.getState();
  if (now.owner === owner || busy(now.phase)) return;
  useExit.setState({ ...INITIAL, owner, landed: now.landed });
  if (owner) void readDoor(owner);
}

/** A door's read that fell is asked again this often, this many times: one lost answer does not shut the door for the visit. */
const DOOR_AGAIN_MS = 15_000;
const DOOR_TRIES = 3;

async function readDoor(owner: string, tries = DOOR_TRIES): Promise<void> {
  // The engine's overview: it builds nothing, and says whether the door is open here.
  const answer = await getJson(`/api/v1/portfolio/exit?${new URLSearchParams({ owner, mode: 'exit', target: 'SOL' })}`);
  if (useExit.getState().owner !== owner) return;
  useExit.setState({ door: answer.ok ? doorOf(answer.value) : DOOR_SHUT });
  // Only a read that fell — not the engine's own «closed here» (404) — is asked again.
  if (!answer.ok && tries > 1 && !/^HTTP_4|CAPABILITY_UNAVAILABLE/.test(answer.code)) setTimeout(() => void (useExit.getState().owner === owner && readDoor(owner, tries - 1)), DOOR_AGAIN_MS);
}

/** A panel opens: for everything, or — opened from one row — for that row alone (`only`). */
export function openExit(mode: ExitMode, only: string | null = null): void {
  if (busy(useExit.getState().phase)) return;
  useExit.setState({ ask: { mode }, off: [], only: only ? [only] : null, changed: false, refused: false, asked: '', review: null, phase: 'idle', declined: false, outcome: null });
}

export function setExitTarget(target: ExitTarget): void {
  const now = useExit.getState();
  if (busy(now.phase) || now.target === target) return;
  useExit.setState({ target, review: null, phase: 'idle', declined: false, changed: false, refused: false });
}

/** One switch of the panel: the built package is dropped and built again for the new choice. */
export function setExitIncluded(id: string, on: boolean): void {
  const now = useExit.getState();
  if (busy(now.phase)) return;
  const off = now.off.filter((other) => other !== id);
  if (!on) off.push(id);
  // In a panel opened from one row, a switch turned on adds its line to the ones that are on.
  const only = now.only && on && !now.only.includes(id) ? [...now.only, id] : now.only;
  useExit.setState({ off, only, review: null, phase: 'idle', declined: false, changed: false, refused: false });
}

let builds = 0;

/** What a build is asked for, in one string: the mode, the coin to leave into, the positions. */
export function askedOf(mode: ExitMode, target: ExitTarget, ids: readonly string[]): string {
  return `${mode}:${target}:${ids.join(',')}`;
}

/**
 * Whether a package built again says what stood on screen: it brings as much — within half a per cent, the price's own
 * move in the seconds between — and leaves no more out. Nothing stood there — it is shown first.
 */
function sameDeal(shown: ExitReview | null, next: ExitReview): boolean {
  if (!shown) return false;
  const holds = (was: string, now: string) => Number(now) >= Number(was) * 0.995;
  return holds(shown.summary.lamports, next.summary.lamports) && holds(shown.summary.usdcRaw, next.summary.usdcRaw) && next.summary.left.length <= shown.summary.left.length && next.summary.others <= shown.summary.others;
}

/** The panel opens or the choice moves: the package is built for it, while the person reads. */
export async function buildExit(ids: readonly string[]): Promise<ExitReview | null> {
  const { owner, ask, target, phase } = useExit.getState();
  if (!owner || !ask || busy(phase)) return null;
  const asked = askedOf(ask.mode, target, ids);
  if (!ids.length) {
    useExit.setState({ phase: 'empty', review: null, asked });
    return null;
  }
  const mine = ++builds;
  useExit.setState({ phase: 'building', review: null, asked });
  const answer = await getJson('/api/v1/portfolio/exit/review', { method: 'POST', body: JSON.stringify(reviewBody(owner, ask.mode, target, ids)) });
  const after = useExit.getState();
  // Only the latest build speaks: an older one that comes back late changes nothing.
  if (mine !== builds || after.phase !== 'building' || after.owner !== owner || after.asked !== asked) return null;
  const review = answer.ok ? reviewOf(answer.value) : null;
  if (!review) {
    const nothing = !answer.ok && answer.code === 'PORTFOLIO_EXIT_NOTHING_TO_DO';
    // A door that shut while the panel stood open: the screen stops offering it.
    if (!answer.ok && answer.code === CLOSED) useExit.setState({ door: DOOR_SHUT });
    useExit.setState({ phase: nothing ? 'empty' : 'failed', review: null });
    return null;
  }
  useExit.setState({ phase: 'ready', review, reviewAt: Date.now() });
  return review;
}

/**
 * The one action: the built package — built again if its bytes are near their end — signed by the wallet at once, then
 * handed to the engine, which sends each transaction once. A wallet that declines leaves everything as it was.
 */
export async function runExit(ids: readonly string[]): Promise<void> {
  const connection = useWallet.getState().connection;
  const state = useExit.getState();
  if (!connection || connection.address !== state.owner || busy(state.phase)) return;
  // The package on screen is signed only if it was built for the choice that stands now: a position that came or went
  // since is built in first, and shown.
  const shown = state.review && state.ask && state.asked === askedOf(state.ask.mode, state.target, ids) ? state.review : null;
  const review = shown && reviewFresh(state.reviewAt, Date.now(), shown.signableMs) ? shown : await buildExit(ids);
  if (!review) return;
  // A package built again at the press is signed only when it says what stood on screen: one that brings less, or
  // leaves more out, is shown first — the next press signs it.
  if (review !== shown && !sameDeal(shown, review)) {
    // Said in one line only when figures that stood on screen moved; a first package simply appears.
    useExit.setState({ declined: false, refused: false, changed: shown !== null || state.review !== null });
    return;
  }
  useExit.setState({ phase: 'signing', declined: false, changed: false, refused: false });
  const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [...review.transactions], chain: 'solana:mainnet' });
  if (!signed.ok) {
    // Nothing moved. The package is built again while the person reads, so the next press signs figures that stand on screen.
    useExit.setState({ phase: 'idle', review: null, declined: true });
    return;
  }
  useExit.setState({ phase: 'sending', declined: false });
  const answer = await getJson('/api/v1/portfolio/exit/submit', { method: 'POST', body: JSON.stringify({ ticket: review.ticket, signed: signed.signedWireBase64 }) });
  if (!answer.ok) {
    if (answer.code === CLOSED) useExit.setState({ door: DOOR_SHUT });
    // The signed package left this browser: an answer lost on the way says nothing of what was sent. The screen says
    // so, and reads the wallet again.
    if (maybeSent(answer.code)) {
      useExit.setState((st) => ({ phase: 'done', outcome: 'unsure', review, landed: st.landed + 1 }));
      useWallet.getState().refreshHoldings([1_500, 7_000]);
    } else {
      // The engine's own refusal: nothing was sent. The package is built again for the next press.
      useExit.setState({ phase: 'idle', review: null, refused: true });
    }
    return;
  }
  // An answer whose body did not read says nothing of what the relay did: the package was handed over.
  const named = typeof answer.value === 'object' && answer.value !== null && Array.isArray((answer.value as { results?: unknown }).results);
  useExit.setState((st) => ({ phase: 'done', outcome: named ? outcomeOf(answer.value) : 'unsure', review, landed: st.landed + 1 }));
  useWallet.getState().refreshHoldings([1_500, 7_000]);
}

/** The panel closed: a result is forgotten, an exit under way is not touched. */
export function settleExit(): void {
  const now = useExit.getState();
  if (busy(now.phase)) return;
  useExit.setState({ ask: null, off: [], only: null, changed: false, refused: false, asked: '', review: null, phase: 'idle', declined: false, outcome: null });
}

export function exitBusy(): boolean {
  return busy(useExit.getState().phase);
}
