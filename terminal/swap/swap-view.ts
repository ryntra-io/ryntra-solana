import type { SolanaWalletAction } from '../../lib/solana/action-ledger.ts';
import { exactDecimal } from '../../lib/solana/amounts.ts';
import { formatUnits } from '../../city/lib/trade/format.ts';
import { SWAP_SOL_RESERVE_LAMPORTS } from '../../city/lib/trade/size.ts';
import { SOL, USDC, isBase, type Balance, type PayAsset, type Side } from '../../city/lib/trade/tiles.ts';
import { MAIN_TICKERS } from '../coin/staples.ts';
import { foldZeros } from '../ui/figures.ts';

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

/**
 * A price for the eye, the English way (the screen writes it in its language): 72.22, 0.002917, 65,017.26 — and a tiny
 * one with its run of zeros folded as the chart writes it, 0.0₇3194 (QA 19.11: «1 Bonk = 0,00000003194 SOL»).
 */
export function priceFigure(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  // Below one: four significant digits.
  const places = Math.min(14, -Math.floor(Math.log10(value)) + 3);
  return foldZeros(value.toFixed(places).replace(/0+$/, '').replace(/\.$/, ''));
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
 * What a new subject coin carries over from the ticket it replaces (a `subject` pick): the coin on the other field, as
 * the screen showed it — its key for the card's `setPay` (SOL and USDC by symbol, any other coin by mint, with the
 * coin itself for `pickCoin`) — and the typed amount when it stands in that other field.
 *
 * `counter` is the coin the screen showed, not the card's stored choice: on SOL's ticket the card keeps «SOL» and
 * shows USDC, the first coin SOL allows (`payAssetFor`), and on the next coin that stored «SOL» would come true —
 * 25 USDC turned into 25 SOL when «You get» changed (release check 19.11). A coin picked for «You get» while buying
 * leaves «You pay» as it was, coin and amount; a coin picked for «You pay» while selling starts its own amount, the
 * coin it is sold into stays. Never the same digits in another coin.
 */
export type Carry = Readonly<{ pay: string; other: PayAsset | null; amount: string | null }>;

export function subjectCarry(input: Readonly<{ field: Field; typed: string; counter: PayAsset }>): Carry {
  const { field, typed, counter } = input;
  const base = isBase(counter);
  const amount = field === 'get' && /^\d*\.?\d+$/.test(typed) && Number(typed) > 0 ? typed : null;
  return { pay: base ? counter.symbol : counter.mint, other: base ? null : counter, amount };
}

/**
 * The coins a field offers, best first and each once — any coin on either side (decision 109: «any token for any»): SOL
 * and USDC, then for what pays the wallet's own coins before the market's, for what is got the market's before the
 * wallet's; a search narrows them by ticker or name, and a coin's full address finds it among them.
 */
export function pickList(input: Readonly<{ field: Field; held: readonly PayAsset[]; market: readonly PayAsset[]; query: string; most: number }>): PayAsset[] {
  const base = [SOL, USDC];
  const rest = input.field === 'pay' ? [...input.held, ...input.market] : [...input.market, ...input.held];
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

/**
 * A field's list with what the engine's search over every Solana coin found (Jupiter's catalogue): the list's own coins
 * first, then the found ones it does not already hold, each once, no more than `most`. A found coin without a ticker
 * is not offered: a coin is never named from a guess.
 */
export function withFound(list: readonly PayAsset[], found: readonly PayAsset[], most: number): PayAsset[] {
  const seen = new Set(list.map((asset) => asset.mint));
  const more = found.filter((asset) => {
    if (!asset.symbol || seen.has(asset.mint)) return false;
    seen.add(asset.mint);
    return true;
  });
  return [...list, ...more].slice(0, most);
}

/**
 * A field's coins before anything is typed (M15 — as Jupiter's picker does it): «Your coins» — the wallet's
 * own, the ones worth something first, by what they are worth — and «Main», the coins people trade most
 * (`terminal/coin/staples.ts`), each once. What pays lists the wallet's coins first, what is got lists «Main» first.
 * Nothing else stands here: no coin the person did not ask for — a meme of the day, a stock, a vulgar name — reaches the
 * top of the list; a search finds any coin.
 */
export function pickStart(
  input: Readonly<{ field: Field; held: readonly PayAsset[]; main: readonly PayAsset[]; worth: (asset: PayAsset) => number | null; most: number }>,
): Readonly<{ mine: PayAsset[]; main: PayAsset[]; rest: PayAsset[] }> {
  const valued = input.held.map((asset) => ({ asset, worth: input.worth(asset) }));
  // «Your coins»: what the wallet holds that is worth something, most first, no more than `most`; the rest of the
  // wallet — a coin nobody prices, an airdrop — after «Main», never above it.
  const priced = valued.filter((row) => row.worth !== null && row.worth > 0).sort((a, b) => (b.worth ?? 0) - (a.worth ?? 0)).map((row) => row.asset);
  const unpriced = valued.filter((row) => !(row.worth !== null && row.worth > 0)).map((row) => row.asset);
  const mainMints = new Set(input.main.map((asset) => asset.mint));
  if (input.field === 'pay') {
    const mine = priced.slice(0, input.most);
    const mineMints = new Set(mine.map((asset) => asset.mint));
    const main = input.main.filter((asset) => !mineMints.has(asset.mint));
    const shown = new Set([...mineMints, ...main.map((asset) => asset.mint)]);
    return { mine, main, rest: [...priced.slice(input.most), ...unpriced].filter((asset) => !shown.has(asset.mint)) };
  }
  // What is got: «Main» first and whole, the wallet's other coins after it.
  const mine = priced.filter((asset) => !mainMints.has(asset.mint)).slice(0, input.most);
  const shown = new Set([...mainMints, ...mine.map((asset) => asset.mint)]);
  return { mine, main: [...input.main], rest: [...priced, ...unpriced].filter((asset) => !shown.has(asset.mint)) };
}

/** A search worth asking the engine's catalogue: two characters at least, a ticker or an address, not more than 64. */
export function searchable(query: string): boolean {
  const text = query.trim().replace(/^\$/, '');
  return text.length >= 2 && text.length <= 64;
}

/* ── the dollars beside a figure ──────────────────────────────────────── */

/**
 * What an amount is worth in dollars at the market's price, for the line under a field's figure: a dollar coin is a
 * dollar, any other coin is the market's price for it; null when the amount or the price is not known — then no line.
 */
export function usdWorth(amount: number | null, price: number | null | undefined, dollar = false): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const each = dollar ? 1 : price;
  if (each === null || each === undefined || !Number.isFinite(each) || each <= 0) return null;
  return amount * each;
}

/** A raw amount as a plain number, for the dollars beside it only; null when it cannot be read. */
export function unitsOf(raw: string | null | undefined, decimals: number | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d{1,40}$/.test(raw) || decimals === null || decimals === undefined || decimals < 0) return null;
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? value : null;
}

/* ── the flip and the reasons ─────────────────────────────────────────── */

/** The significant digits the flip carries over: an amount a person reads, not the venue's last unit. */
const FLIP_DIGITS = 6;

/**
 * The amount the flip writes in «You pay»: what «You get» showed — the same value, now paid — to six
 * significant digits, rounded down, never cutting whole units. Null when no figure stood: the field then keeps its text.
 */
export function flipText(raw: string | null | undefined, decimals: number | null | undefined): string | null {
  if (typeof raw !== 'string' || !/^\d{1,40}$/.test(raw) || decimals === null || decimals === undefined || decimals < 0) return null;
  const amount = BigInt(raw);
  if (amount === 0n) return null;
  const length = amount.toString().length;
  const cut = Math.max(0, Math.min(decimals, length - FLIP_DIGITS));
  const unit = 10n ** BigInt(cut);
  return exactDecimal(((amount / unit) * unit).toString(), decimals);
}

/**
 * The wallet holds no SOL at all for the network's fee: a swap of any other coin cannot land, and the
 * swap's one button says so before any press. A wallet not read yet is not short.
 */
export function feeShort(sol: Balance | null | undefined, inputMint: string): boolean {
  return inputMint !== SOL.mint && sol !== null && sol !== undefined && /^\d+$/.test(sol.spendableRaw) && BigInt(sol.spendableRaw) === 0n;
}

/** SOL below what a swap may need beside its amount — the fee, the priority, a new account's rent. */
export function solThin(sol: Balance | null | undefined): boolean {
  return sol !== null && sol !== undefined && /^\d+$/.test(sol.spendableRaw) && BigInt(sol.spendableRaw) < SWAP_SOL_RESERVE_LAMPORTS;
}

/** What a refused press means in the person's terms, when the wallet tells more than the engine's code. */
export type Reason = 'needSol' | 'frozen' | 'notBuilt';

/**
 * A refusal said truly. The engine's sentence guesses from its code alone: «the wallet does not cover
 * the amount plus its fee» where the wallet holds 65 SOL, «the transaction that came back was not the one reviewed»
 * where Jupiter only offered to pay the fee for a wallet without SOL. With the wallet's own read beside the code:
 * - a fee payer that is not the wallet — the venue's offer to a wallet with no SOL — is SOL short for the fee;
 * - a swap that could not be built or simulated is the coin's frozen account when one of its two is frozen, SOL short
 *   when SOL is thin, else simply not built this time — never the wallet's fault when its balance covers it.
 * Null: the engine's own sentence stands.
 */
export function reasonOf(input: Readonly<{ code: string | null | undefined; solThin: boolean; frozen: boolean }>): Reason | null {
  // Exact codes only: a refusal of Ryntra's own checks (the bytes changed, an effect not proven) keeps its own sentence.
  const code = input.code ?? '';
  if (code === 'TRANSACTION_FEE_PAYER_MISMATCH') return 'needSol';
  if (code !== 'ORDER_BUILD_FAILED' && code !== 'SIMULATION_FAILED') return null;
  if (input.frozen) return 'frozen';
  if (input.solThin) return 'needSol';
  return code === 'ORDER_BUILD_FAILED' ? 'notBuilt' : null;
}

/**
 * A price that did not come because Jupiter has no route for the pair: the engine's `QUOTE_NO_ROUTE`, or an
 * exact order's `ORDER_NO_ROUTE`. Said calmly in the screen's own line — the pair is not a danger, it is just not
 * carried now — never the venue's sentence and never a refusal's red.
 */
export function noRouteOf(code: string | null | undefined): boolean {
  return /^(QUOTE_|ORDER_)?NO_ROUTE$/.test(code ?? '');
}

/* ── a pair from the address ──────────────────────────────────────────── */

/** «Main»'s coins by their tickers in an address (SOL, USDC, USDT, JUP, BONK …); any other coin by its mint. */
const BY_TICKER: Readonly<Record<string, string>> = MAIN_TICKERS;

/** A coin named in an address — a ticker of «Main», or a mint's shape — or null. */
export function mintOfParam(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const ticker = BY_TICKER[text.toLowerCase().replace(/^\$/, '')];
  if (ticker) return ticker;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text) ? text : null;
}

/**
 * The swap a link names: `/swap?from=USDC&to=<mint>` — the card's own model of a subject coin on a side
 * and the counter coin that pays or is paid. The coin beyond SOL and USDC is the subject; between SOL and USDC, SOL.
 * Bought when it is what comes, sold when it is what goes. Null when the link names no pair this card can stand on.
 */
export function pairOfLink(from: string | null, to: string | null): Readonly<{ subject: string; side: Side; counter: string | null }> | null {
  const a = mintOfParam(from);
  const b = mintOfParam(to);
  // A coin named that is not one: the link names no pair this card can stand on — never a pair it did not name.
  if ((from && !a) || (to && !b)) return null;
  if (a && b && a === b) return null;
  const base = (mint: string | null) => mint === SOL.mint || mint === USDC.mint;
  if (b && (!base(b) || (base(a) && b === SOL.mint) || !a)) return { subject: b, side: 'buy', counter: a };
  if (a) return { subject: a, side: 'sell', counter: b };
  return null;
}

/**
 * The amount a link names (`&amount=1.5` — the swap Ryntra's MCP prepares for another AI): always of the coin
 * that goes, `from`. The card takes it where its own model puts that amount — a sale's amount of the coin itself, a
 * buy's amount of SOL or USDC that pays. A buy paid in another coin starts again in that coin once it is picked, so the
 * person types it there. The person's digits, more than zero; null for anything else.
 */
export function amountOfLink(value: string | null, pair: Readonly<{ side: Side; counter: string | null }>): string | null {
  const text = value?.trim().replace(',', '.') ?? '';
  if (!/^\d{1,12}(\.\d{1,9})?$/.test(text) || Number(text) <= 0) return null;
  if (pair.side === 'buy' && pair.counter !== SOL.mint && pair.counter !== USDC.mint) return null;
  return text.replace(/^0+(?=\d)/, '');
}

export { BRIDGE_PATH, leaveOf, type Leave } from './leave.ts';

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
