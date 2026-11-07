import type { LaunchBuildRequest, LaunchBuildResponse, LaunchMetadataResponse, LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import type { FeeShare } from '../../../lib/core/launch/fee-shares.ts';
import { MAX_SIGNABLE_WINDOW_MS, MIN_WALLET_WINDOW_MS } from '../../../lib/solana/blockhash-life.ts';
import type { Answer, LaunchEngine, Network } from './engine.ts';
import { cityLaunchOpen } from './gate.ts';
import { sameShares } from './share.ts';

/**
 * The launch made ready before the press (CITY-143, `docs/research/ryntra-launch-2026-10-29/SPEC.md` «Створення»):
 * the picture and the words go to the engine's store in the background while the creator types, and once a wallet is
 * there the engine builds the launch once, so the sheet's cost line says what Solana simulated before anything is
 * signed. Nothing here signs or sends: the same `/api/v1/launch` routes every client calls, only earlier.
 *
 * - The store is asked once per set of fields (`fieldsKey`); a refusal that would repeat (the picture, a borrowed name)
 *   is said on the form at once, any other is asked again at the press.
 * - The build is asked once per launch (fields, wallet, preset, network) and only where the city may launch. Its bytes
 *   are handed to the flow only while a wallet may still be opened on them (`freshPrebuilt`); past that the flow builds
 *   them fresh, so bytes never age on the review.
 * - The background is bounded (`BACKGROUND_STORES`), so a creator who keeps changing the name does not spend the
 *   engine's hourly allowance; the press always stores what it launches.
 */

export type PrepFields = Readonly<{ name: string; symbol: string; picture: Readonly<{ base64: string }> }>;

/** Background stores a page asks for at most until a launch lands; every later store waits for a press. */
export const BACKGROUND_STORES = 4;

/** Above the least window a wallet is opened on (`MIN_WALLET_WINDOW_MS`): room for the press to reach the wallet. */
export const PREBUILT_SLACK_MS = 3_000;

/** The engine's refusals of the fields themselves: the same fields are refused the same way again. */
export const FIELDS_REFUSED: ReadonlySet<string> = new Set(['LAUNCH_IMAGE_REFUSED', 'LAUNCH_IMAGE_INVALID', 'LAUNCH_NAME_BORROWED', 'VALIDATION_ERROR']);

/** FNV-1a of the picture's text: a picture changed by one byte is another picture. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

/** The three fields as one key: the same name, ticker and picture are stored once. */
export function fieldsKey(fields: PrepFields): string {
  return `${fields.name}\u0000${fields.symbol}\u0000${fingerprint(fields.picture.base64)}`;
}

/**
 * What the city's launch asks the engine to build: the launch — no first purchase, no lock —, and, when the review
 * showed it, the creator's fees shared (CITY-212: the creator first, keeping the rest; `share.ts`).
 */
export function launchRequest(creator: string, preset: LaunchPresetView['id'], metadataUri: string, shares: readonly FeeShare[] | null = null): LaunchBuildRequest {
  return { creator, preset, metadataUri, firstBuyRaw: '0', lock: null, ...(shares?.length ? { feeShares: [...shares] } : {}) };
}

function sameRequest(a: LaunchBuildRequest, b: LaunchBuildRequest): boolean {
  return a.creator === b.creator && a.preset === b.preset && a.metadataUri === b.metadataUri && a.firstBuyRaw === b.firstBuyRaw && a.lock === b.lock && sameShares(a.feeShares, b.feeShares);
}

/** A build made ahead of the press: what was asked, the engine's answer, and when it arrived on this device. */
export type Prebuilt = Readonly<{ request: LaunchBuildRequest; network: Network; built: LaunchBuildResponse; receivedAt: number }>;

/**
 * The prebuilt bytes, for exactly this launch, with what is left of their window as their window — or null when they
 * are another launch's or too little of their life is left to open a wallet on.
 */
export function freshPrebuilt(prebuilt: Prebuilt | null, request: LaunchBuildRequest, network: Network, now: number): LaunchBuildResponse | null {
  if (!prebuilt || prebuilt.network !== network || !sameRequest(prebuilt.request, request)) return null;
  const given = prebuilt.built.signableMs;
  const window = typeof given === 'number' && Number.isFinite(given) ? given : MAX_SIGNABLE_WINDOW_MS;
  const left = window - (now - prebuilt.receivedAt);
  if (!Number.isFinite(left) || left < MIN_WALLET_WINDOW_MS + PREBUILT_SLACK_MS) return null;
  return { ...prebuilt.built, signableMs: left };
}

/**
 * Bytes the review showed nothing of — another network, a lock, a sharing of fees nobody asked for, or no sharing where
 * the review showed one — are never this launch. Whether the sharing's own bytes are the shares shown is read by
 * `split-check.ts` before the wallet opens.
 */
export function asReviewed(built: LaunchBuildResponse, network: Network, shared: boolean): boolean {
  if (built.network !== network || built.lockUnsignedWireBase64 !== null) return false;
  return shared ? Boolean(built.splitUnsignedWireBase64) && Boolean(built.feeVault) : !built.splitUnsignedWireBase64;
}

/** The launch alone: no lock and no sharing. */
export function onlyTheLaunch(built: LaunchBuildResponse, network: Network): boolean {
  return asReviewed(built, network, false);
}

export type PrepState = Readonly<{
  /** The fields last handed to the store and its answer; the answer is null while it is on its way. */
  stored: Readonly<{ key: string; answer: Answer<LaunchMetadataResponse> | null }> | null;
  /** The engine's simulated cost of a launch from this sheet, lamports: the last build's, kept as the next one's «≈». */
  costLamports: string | null;
}>;

export type Prep = Readonly<{
  /** Hands the fields to the store, or returns the answer on its way for the same fields; null — the background is spent. */
  store: (fields: PrepFields, options?: Readonly<{ background?: boolean }>) => Promise<Answer<LaunchMetadataResponse>> | null;
  /** Builds the launch once for its simulated cost, where the city may launch and the fields are stored. */
  simulate: (args: Readonly<{ fields: PrepFields; creator: string; preset: LaunchPresetView; network: Network; ownerWord?: boolean; switchOpen?: boolean; shares?: readonly FeeShare[] | null }>) => Promise<void>;
  /** The prebuilt bytes of exactly this launch, handed over once. */
  take: (request: LaunchBuildRequest, network: Network) => Prebuilt | null;
  /** After a launch: nothing kept for the next but the cost. */
  reset: () => void;
  state: () => PrepState;
}>;

export function createPrep(args: Readonly<{ engine: () => LaunchEngine; now?: () => number; onChange?: (state: PrepState) => void }>): Prep {
  const now = args.now ?? Date.now;
  let stored: { key: string; promise: Promise<Answer<LaunchMetadataResponse>>; answer: Answer<LaunchMetadataResponse> | null } | null = null;
  let prebuilt: Prebuilt | null = null;
  let building: string | null = null;
  const simulated = new Set<string>();
  let cost: string | null = null;
  let background = 0;

  const state = (): PrepState => ({ stored: stored ? { key: stored.key, answer: stored.answer } : null, costLamports: cost });
  const emit = () => args.onChange?.(state());

  const store: Prep['store'] = (fields, options = {}) => {
    const key = fieldsKey(fields);
    if (stored?.key === key) {
      const answer = stored.answer;
      /* A refusal the engine might not repeat — busy, offline, too many tries — is asked again at a press, never in the background. */
      const retry = answer !== null && !answer.ok && !FIELDS_REFUSED.has(answer.code) && !options.background;
      if (!retry) return stored.promise;
    }
    if (options.background) {
      if (background >= BACKGROUND_STORES) return null;
      background += 1;
    }
    const promise = args.engine().metadata({ name: fields.name, symbol: fields.symbol, description: '', website: '', x: '', telegram: '', imageBase64: fields.picture.base64 });
    const entry: { key: string; promise: Promise<Answer<LaunchMetadataResponse>>; answer: Answer<LaunchMetadataResponse> | null } = { key, promise, answer: null };
    stored = entry;
    emit();
    void promise.then((answer) => {
      entry.answer = answer;
      if (stored === entry) emit();
    });
    return promise;
  };

  const simulate: Prep['simulate'] = async ({ fields, creator, preset, network, ownerWord, switchOpen, shares = null }) => {
    if (!cityLaunchOpen(network, ownerWord, switchOpen)) return;
    const entry = stored;
    if (!entry || entry.key !== fieldsKey(fields) || !entry.answer?.ok) return;
    const request = launchRequest(creator, preset.id, entry.answer.data.metadataUri, shares);
    const key = `${network}|${request.creator}|${request.preset}|${request.metadataUri}|${(request.feeShares ?? []).map((share) => `${share.address}:${share.bps}`).join(',')}`;
    if (simulated.has(key) || building === key) return;
    building = key;
    const answer = await args.engine().build(request);
    if (building === key) building = null;
    /* A refusal is said by the launch itself at the press; the cost line keeps what it knew. */
    if (!answer.ok || !asReviewed(answer.data, network, Boolean(request.feeShares?.length))) return;
    simulated.add(key);
    prebuilt = { request, network, built: answer.data, receivedAt: now() };
    cost = answer.data.creatorCostLamports;
    emit();
  };

  const take: Prep['take'] = (request, network) => {
    if (!prebuilt || prebuilt.network !== network || !sameRequest(prebuilt.request, request)) return null;
    const handed = prebuilt;
    prebuilt = null;
    return handed;
  };

  const reset: Prep['reset'] = () => {
    stored = null;
    prebuilt = null;
    building = null;
    simulated.clear();
    background = 0;
    emit();
  };

  return { store, simulate, take, reset, state };
}
