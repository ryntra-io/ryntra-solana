import type { ExitTarget } from './all-view.ts';

/**
 * «Exit everything» and «Collect fees» on the Portfolio — the rules of their review, without React: what the engine's
 * overview and its built package say (`/api/v1/portfolio/exit/**`, the routes), read leniently — a field
 * the engine did not send is absent, never guessed — and what a relay's answer means. The engine picks the steps,
 * simulates, builds and sends; nothing here prices, routes or signs.
 *
 * Pure: the tests hold them as they are written.
 */

/** `exit` — out of the positions into the chosen coin; `collect` — only the fees, the positions stay. */
export type ExitMode = 'exit' | 'collect';

/** What this deployment lets a person do here. Shut until the engine says otherwise. */
export type ExitDoor = Readonly<{ canExit: boolean; canCollect: boolean }>;
export const DOOR_SHUT: ExitDoor = { canExit: false, canCollect: false };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const DIGITS = /^\d{1,40}$/;
const rawOf = (value: unknown): string => {
  const raw = text(value);
  return raw && DIGITS.test(raw) ? raw : '0';
};
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

/** What the screen asks the engine to build: the wallet, the mode, the coin to leave into (an exit only), the positions left on. */
export function reviewBody(owner: string, mode: ExitMode, target: ExitTarget, positions: readonly string[]): Readonly<{ owner: string; mode: ExitMode; target?: ExitTarget; positions: string[] }> {
  return { owner, mode, ...(mode === 'exit' ? { target } : {}), positions: [...positions] };
}

/** The door as the engine's overview states it — one switch for both actions; anything else is shut. */
export function doorOf(body: unknown): ExitDoor {
  const open = isObject(body) && body.canExit === true;
  return { canExit: open, canCollect: open };
}

/**
 * The coins the engine's overview found Jupiter carries no route for now: its `held` rows of the wallet's
 * own coins with `NO_ROUTE`. They are not offered as coins that sell; the panel names them in one line. A position a
 * protocol has no exit for (`NO_ROUTE` on a pool or a market) is not one of them — its row says so itself.
 */
export function unroutedOf(body: unknown): string[] {
  if (!isObject(body)) return [];
  return list(body.held)
    .filter((row): row is Json => isObject(row) && row.protocol === 'wallet' && row.reason === 'NO_ROUTE')
    .map((row) => text(row.id))
    .filter((id): id is string => id !== null)
    .slice(0, 300);
}

/** A position the package leaves out or only starts, and why — in the engine's own code. */
export type ExitLeft = Readonly<{ id: string; reason: string; untilEpoch: number | null }>;

export type ExitReview = Readonly<{
  mode: ExitMode;
  target: ExitTarget | null;
  ticket: string;
  /** The package the wallet signs at once, wire base64, in the order it is signed. */
  transactions: readonly string[];
  /** How long the package can still be signed, from the moment it arrived; null — the engine did not say. */
  signableMs: number | null;
  summary: Readonly<{
    /** What comes to the wallet in the coins of the target: SOL in lamports, USDC in its base units. */
    lamports: string;
    usdcRaw: string;
    /** The rent of the accounts the exit closes, lamports — it returns in SOL. */
    rentLamports: string;
    /** Ryntra's fee on the swaps, basis points — the Swap screen's own; null — no swap in it. */
    feeBps: number | null;
    /** A stake that only starts to leave, and what was picked but is not in the package. */
    left: readonly ExitLeft[];
    /** How many other coins come to the wallet and stay as they are. */
    others: number;
  }>;
}>;

function leftOf(value: unknown, fallback: string | null): ExitLeft | null {
  if (!isObject(value)) return null;
  const id = text(value.id);
  const reason = text(value.reason) ?? fallback;
  return id && reason ? { id, reason, untilEpoch: whole(value.untilEpoch) } : null;
}

/** The engine's built package; null when it carries nothing to sign or no summary to show. */
export function reviewOf(body: unknown): ExitReview | null {
  if (!isObject(body) || !isObject(body.summary)) return null;
  const ticket = text(body.ticket);
  const wires = list(body.transactions);
  const transactions = wires.filter((wire): wire is string => typeof wire === 'string' && wire.length > 0);
  if (!ticket || !transactions.length || transactions.length !== wires.length) return null;
  const summary = body.summary;
  const receive = isObject(summary.receive) ? summary.receive : {};
  const later = list(summary.later).map((entry) => leftOf(entry, 'STAKE_ACTIVE'));
  const skipped = list(summary.skipped).map((entry) => leftOf(entry, null));
  return {
    mode: body.mode === 'collect' ? 'collect' : 'exit',
    target: body.target === 'SOL' || body.target === 'USDC' || body.target === 'SPLIT' ? body.target : null,
    ticket,
    transactions,
    // Zero is an answer too: the package can no longer be signed as it is, and is built again at the press.
    signableMs: typeof body.signableMs === 'number' && Number.isFinite(body.signableMs) && body.signableMs >= 0 ? body.signableMs : null,
    summary: {
      lamports: rawOf(receive.lamports),
      usdcRaw: rawOf(receive.usdcRaw),
      rentLamports: rawOf(summary.rentLamports),
      feeBps: typeof summary.feeBps === 'number' && Number.isFinite(summary.feeBps) && summary.feeBps >= 0 ? summary.feeBps : null,
      left: [...later, ...skipped].filter((entry): entry is ExitLeft => entry !== null),
      others: list(summary.others).length,
    },
  };
}

/** Base units in whole coins, for the eye only. */
function unitsOf(raw: string, decimals: number): number {
  if (raw.length <= 15) return Number(raw) / 10 ** decimals;
  return Number(raw.slice(0, 15)) * 10 ** (raw.length - 15 - decimals);
}

/** A coin amount the English way: 12.40 · 0.3026 · 1,904.10. The screen writes it in its language. */
export function amountFigure(units: number): string {
  if (!Number.isFinite(units) || units <= 0) return '0';
  if (units >= 1) return units.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const places = Math.min(9, -Math.floor(Math.log10(units)) + 3);
  return units.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
}

/** What comes to the wallet, one figure per coin, the English way: «12.40 SOL», «1,904.10 USDC». Empty — nothing in the target's coins. */
export function receiveFigures(review: Pick<ExitReview, 'summary'>): string[] {
  const sol = unitsOf(review.summary.lamports, 9);
  const usdc = unitsOf(review.summary.usdcRaw, 6);
  return [sol > 0 ? `${amountFigure(sol)} SOL` : null, usdc > 0 ? `${amountFigure(usdc)} USDC` : null].filter((figure): figure is string => figure !== null);
}

/** The rent that comes back, SOL; null — none. */
export function rentSol(review: Pick<ExitReview, 'summary'>): number | null {
  const lamports = Number(review.summary.rentLamports);
  return lamports > 0 ? lamports / 1e9 : null;
}

/**
 * How long a review is signed as it is, by this browser's own clock: the engine says how long its bytes can be signed
 * (`signableMs`), and the wallet needs the rest of that time. Older, the package is built again at the press.
 */
export const SIGN_WITHIN_MS = 12_000;
const WALLET_NEEDS_MS = 8_000;
export function reviewFresh(reviewAt: number, now: number, signableMs: number | null = null): boolean {
  const within = signableMs === null ? SIGN_WITHIN_MS : Math.min(SIGN_WITHIN_MS, signableMs - WALLET_NEEDS_MS);
  return reviewAt > 0 && now - reviewAt < within;
}

/** `unsure` — something was sent and the chain has not said yet whether it landed: never «nothing moved». */
export type ExitOutcome = 'done' | 'part' | 'none' | 'unsure';

/**
 * A relay's answer: everything landed, some of it, or none — and `unsure` as soon as one transaction was sent without
 * an answer (`UNKNOWN`): it may have landed. An answer that names nothing is none.
 */
export function outcomeOf(body: unknown): ExitOutcome {
  const results = isObject(body) ? list(body.results) : [];
  const states = results.map((result) => (isObject(result) ? result.state : null));
  const landed = states.filter((state) => state === 'LANDED').length;
  if (results.length > 0 && landed === results.length) return 'done';
  if (states.includes('UNKNOWN')) return 'unsure';
  return landed > 0 ? 'part' : 'none';
}

/**
 * Whether a submit that came back with an error may still have sent something: the signed package left this browser,
 * and a lost answer or a server that fell says nothing of what it did. The engine's own refusals — a ticket it does not
 * take, a door that is shut — sent nothing.
 */
export function maybeSent(code: string): boolean {
  return code === 'NETWORK' || code === 'UNAVAILABLE' || /^HTTP_5\d\d$/.test(code);
}
