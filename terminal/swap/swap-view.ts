import type { SolanaWalletAction } from '../../lib/solana/action-ledger.ts';
import { formatUnits } from '../../city/lib/trade/format.ts';
import { isBase, SOL, USDC, type PayAsset, type Side } from '../../city/lib/trade/tiles.ts';

/**
 * The Swap screen's own rules, without React: the rate the price on screen implies, what a coin picked from either
 * field does to the ticket, the wallet's recent swaps and transfers as rows, and which doors stand. The price, the
 * route, the fee, the order and the signature are the trade logic's (`city/lib/trade/**`); the bridge, the deposit and
 * the transfer are the money logic's (`city/lib/money/**`). These rules only decide what the screen shows over them.
 *
 * Pure: the tests hold them as they are written.
 */

/* ── the rate ─────────────────────────────────────────────────────────── */

export type Rate = Readonly<{ one: string; price: string; other: string }>;

/** A price for the eye, the English way (the screen writes it in its language): 72.22, 0.002917, 65,017.26. */
export function priceFigure(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  // Below one: four significant digits.
  const places = Math.min(12, -Math.floor(Math.log10(value)) + 3);
  return value.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * The rate the quote on screen implies: one of the coin the ticket stands on, in the other coin — «1 SOL = 72.22 USDC»
 * whether SOL is bought or sold. Read from the engine's own amounts in and out; null while either is unknown.
 */
export function rateOf(input: Readonly<{
  side: Side;
  /** The coin the ticket stands on: what is got when buying, what is given when selling. */
  subject: string;
  /** The other coin: what pays when buying, what a sale is paid in. */
  counter: string;
  inRaw: string;
  outRaw: string;
  inDecimals: number | null;
  outDecimals: number | null;
}>): Rate | null {
  const { side, inRaw, outRaw, inDecimals, outDecimals } = input;
  if (inDecimals === null || outDecimals === null || !/^\d+$/.test(inRaw) || !/^\d+$/.test(outRaw)) return null;
  const given = Number(inRaw) / 10 ** inDecimals;
  const got = Number(outRaw) / 10 ** outDecimals;
  if (!(given > 0) || !(got > 0)) return null;
  // Buying, the counter coin is given for the subject; selling, the subject is given for the counter coin.
  const price = side === 'buy' ? given / got : got / given;
  return { one: input.subject, price: priceFigure(price), other: input.counter };
}

/* ── picking a coin from either field ─────────────────────────────────── */

/** Which field's pill was tapped: what is paid, or what is got. */
export type Field = 'pay' | 'get';

/**
 * What a coin picked from a field does to the ticket, on the trade card's own model — a subject coin on a side, and
 * the counter coin it is paid with or paid in:
 * - `none`: it is already there;
 * - `flip`: it is the coin of the other field, so the two change places (the card's own side switch);
 * - `counter`: the coin that pays (buying) or is paid (selling) changes — the card's `setPay` or `pickCoin`;
 * - `subject`: the coin the ticket stands on changes, on the same side — the screen opens the card on it.
 */
export type PickPlan =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'flip' }>
  | Readonly<{ kind: 'counter'; asset: PayAsset }>
  | Readonly<{ kind: 'subject'; asset: PayAsset; side: Side }>;

export function pickPlan(input: Readonly<{ side: Side; subject: string; counter: string; field: Field; picked: PayAsset }>): PickPlan {
  const { side, subject, counter, field, picked } = input;
  // Buying: «you pay» is the counter coin and «you get» the subject; selling, the other way round.
  const subjectField: Field = side === 'buy' ? 'get' : 'pay';
  const here = field === subjectField ? subject : counter;
  const there = field === subjectField ? counter : subject;
  if (picked.mint === here) return { kind: 'none' };
  if (picked.mint === there) return { kind: 'flip' };
  return field === subjectField ? { kind: 'subject', asset: picked, side } : { kind: 'counter', asset: picked };
}

/**
 * The coins a field offers, best first and each once: SOL and USDC, then the wallet's coins with something to spend
 * (what pays), or then the market's coins (what is got); a search narrows them by ticker or name, and a coin's full
 * address finds it among them.
 */
export function pickList(input: Readonly<{ field: Field; held: readonly PayAsset[]; market: readonly PayAsset[]; query: string; most: number }>): PayAsset[] {
  const base = [SOL, USDC];
  const rest = input.field === 'pay' ? input.held : [...input.market, ...input.held];
  const seen = new Set<string>();
  const all: PayAsset[] = [];
  for (const asset of [...base, ...rest]) {
    if (seen.has(asset.mint)) continue;
    seen.add(asset.mint);
    all.push(asset);
  }
  const query = input.query.trim().toLowerCase().replace(/^\$/, '');
  if (!query) return all.slice(0, input.most);
  const exact = all.filter((asset) => asset.mint.toLowerCase() === query || asset.symbol.toLowerCase().replace(/^\$/, '') === query);
  const starts = all.filter((asset) => !exact.includes(asset) && asset.symbol.toLowerCase().replace(/^\$/, '').startsWith(query));
  const named = all.filter((asset) => !exact.includes(asset) && !starts.includes(asset) && (asset.name ?? '').toLowerCase().includes(query));
  return [...exact, ...starts, ...named].slice(0, input.most);
}

/* ── the wallet's recent swaps and transfers ──────────────────────────── */

/** How long ago, in steps the screen words: just now, minutes, hours, yesterday, days. */
export type Ago = Readonly<{ unit: 'now' | 'minutes' | 'hours' | 'yesterday' | 'days'; n: number }>;

export function agoOf(at: number, now: number): Ago {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) return { unit: 'now', n: 0 };
  if (ms < 3_600_000) return { unit: 'minutes', n: Math.floor(ms / 60_000) };
  if (ms < 86_400_000) return { unit: 'hours', n: Math.floor(ms / 3_600_000) };
  const days = Math.floor(ms / 86_400_000);
  return days < 2 ? { unit: 'yesterday', n: 1 } : { unit: 'days', n: days };
}

export type RecentKind = 'swap' | 'bridge' | 'send' | 'receive';

export type RecentRow = Readonly<{
  id: string;
  kind: RecentKind;
  /** The coin that left and the coin that came, as tickers; null where the ledger did not name it. */
  from: string | null;
  to: string | null;
  /** Their mints, for the two logos; null for a coin on another network or one the ledger did not name. */
  fromMint: string | null;
  toMint: string | null;
  /** The network a bridge went to, by its own name in lower case (`ethereum`, `base`); null for any other row. */
  network: string | null;
  /** The figure on the right: what came for a swap or a receipt, what left for a transfer or a bridge. */
  amount: string | null;
  ago: Ago;
  outcome: SolanaWalletAction['outcome'];
}>;

const LANE: Readonly<Record<SolanaWalletAction['lane'], RecentKind>> = { SWAP: 'swap', CROSS_SWAP: 'bridge', BRIDGE: 'bridge', SEND: 'send', RECEIVE: 'receive' };

type Movement = SolanaWalletAction['out'];

/** A ticker as a row writes it: no `$`, SOL for the native coin. */
function tickerOf(leg: Movement): string | null {
  if (!leg) return null;
  if (leg.symbol) return leg.symbol.replace(/^\$+/, '');
  return leg.mint === null || leg.mint === SOL.mint ? 'SOL' : null;
}

function mintOf(leg: Movement): string | null {
  if (!leg) return null;
  return leg.mint ?? SOL.mint;
}

function amountOf(leg: Movement): string | null {
  if (!leg || leg.decimals === null) return null;
  const text = formatUnits(leg.amountRaw, leg.decimals, 'down');
  return text === '—' ? null : text;
}

/**
 * The ledger's actions as the screen's rows, newest first: a swap says what left and what came and the amount that came;
 * a bridge, a transfer and a receipt say their coin and the amount that moved. Nothing is listed that the ledger did not
 * record, and an amount whose decimals the ledger did not know is not guessed.
 */
export function recentRows(actions: readonly SolanaWalletAction[], now: number, most: number): RecentRow[] {
  return [...actions]
    .filter((action) => LANE[action.lane] !== undefined && Number.isFinite(Date.parse(action.startedAt)))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, most)
    .map((action) => {
      const kind = LANE[action.lane];
      const out = action.out;
      const got = action.in;
      // A transfer or a bridge says the coin that left; a receipt the coin that came.
      const leg = kind === 'receive' ? got : kind === 'swap' ? got : out;
      return {
        id: action.actionId,
        kind,
        from: tickerOf(out),
        to: tickerOf(got),
        fromMint: mintOf(out),
        toMint: kind === 'bridge' ? null : mintOf(got),
        network: kind === 'bridge' && action.destination && action.destination !== 'SOLANA' ? action.destination.toLowerCase() : null,
        amount: amountOf(leg),
        ago: agoOf(Date.parse(action.startedAt), now),
        outcome: action.outcome,
      };
    });
}

/* ── the bridge ───────────────────────────────────────────────────────── */

/** What the bridge's one control says out of Solana, and what it does: the money window's own ladder, step by step. */
export type BridgeSay = 'connect' | 'reading' | 'unread' | 'noUsdc' | 'address' | 'short' | 'amount' | 'pricing' | 'refused' | 'preparing' | 'wallet' | 'sending' | 'paused' | 'confirm' | 'move';

export type BridgeStep = Readonly<{ say: BridgeSay; act: 'connect' | 'review' | 'confirm' | null; busy: boolean }>;

export type BridgeInput = Readonly<{
  connected: boolean;
  walletRead: 'none' | 'reading' | 'ready' | 'failed';
  /** The wallet's coins are read. */
  read: boolean;
  /** What the wallet can move of its USDC, raw; null when it holds none. */
  usdc: string | null;
  destinationOk: boolean;
  amount: 'ok' | 'over' | 'none';
  phase: 'idle' | 'quoting' | 'planning' | 'wallet' | 'sending' | 'tracking';
  /** The engine's price for exactly what is on screen. */
  quoted: boolean;
  /** The engine refused a price for exactly what is on screen: its words stand, and only a quiet «Try again» asks again. */
  refused: boolean;
  /** The engine would build the transfer: its lane is open for this network. */
  buildable: boolean;
  /** The exact transfer is built and its figures shown: the next press opens the wallet. */
  planned: boolean;
}>;

const step = (say: BridgeSay, act: BridgeStep['act'] = null, busy = false): BridgeStep => ({ say, act, busy });

/**
 * The bridge out of Solana, one step at a time, as the money window climbs it: a wallet, its USDC, the address there,
 * the amount, the engine's price; a press builds the exact transfer and shows its figures, and only a press over them
 * opens the wallet. A lane the engine keeps shut says so and offers nothing.
 */
export function bridgeStep(input: BridgeInput): BridgeStep {
  if (!input.connected) return step('connect', 'connect');
  if (input.phase === 'planning') return step('preparing', null, true);
  if (input.phase === 'wallet') return step('wallet', null, true);
  if (input.phase === 'sending') return step('sending', null, true);
  if (!input.read) return step(input.walletRead === 'failed' ? 'unread' : 'reading', null, input.walletRead !== 'failed');
  if (input.usdc === null || /^0*$/.test(input.usdc)) return step('noUsdc');
  if (!input.destinationOk) return step('address');
  if (input.amount !== 'ok') return step(input.amount === 'over' ? 'short' : 'amount');
  if (input.phase !== 'quoting' && input.refused) return step('refused');
  if (input.phase === 'quoting' || !input.quoted) return step('pricing', null, true);
  if (!input.buildable) return step('paused');
  if (input.planned) return step('confirm', 'confirm');
  return step('move', 'review');
}

/** Into Solana: connect, ask the engine for the address on that network, then the address to copy. */
export type DepositSay = 'connect' | 'move' | 'asking' | 'copy';

export function depositStep(input: Readonly<{ connected: boolean; status: 'idle' | 'loading' | 'failed'; shown: boolean }>): DepositSay {
  if (!input.connected) return 'connect';
  if (input.shown) return 'copy';
  return input.status === 'loading' ? 'asking' : 'move';
}

/* ── the doors ────────────────────────────────────────────────────────── */

export type DoorId = 'limitStop' | 'send';

/**
 * The doors under the screen, each only where its way is open: limits and stops where the engine keeps them and the
 * coin's screen is on; a transfer where money may move. Buying with a card is drawn by no door: Ryntra has no card
 * purchase to open.
 */
export function doorsShown(input: Readonly<{ limits: boolean; coinScreen: boolean; send: boolean }>): DoorId[] {
  const doors: DoorId[] = [];
  if (input.limits && input.coinScreen) doors.push('limitStop');
  if (input.send) doors.push('send');
  return doors;
}

/**
 * The coin «Limit and stop» opens: the coin of the ticket that is not a dollar — a limit on USDC would be a price of a
 * dollar in dollars. Of two coins that are neither, the one the ticket stands on.
 */
export function limitCoin(subject: PayAsset, counter: PayAsset): PayAsset {
  if (subject.mint !== USDC.mint) return subject;
  return isBase(counter) ? SOL : counter;
}
