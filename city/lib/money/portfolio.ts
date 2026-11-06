import { scaleRawAmount } from '../../../lib/solana/amounts.ts';
import { LST_BY_MINT } from '../earn/lst.ts';
import { NATIVE_ID, valueOf, type MoneyAsset } from './assets.ts';

/**
 * The whole portfolio as one picture: every place a wallet's money sits, in dollars, with the one action that takes it out.
 *
 * Nothing here prices or reads anything: each figure is the engine's — the wallet's coins at the catalogue's price,
 * Jupiter Lend's own worth of a position, a pool position's value at the venue's prices, the agent's vault on chain,
 * Phoenix's collateral. A place that was not read is not zero: it is `unknown`, left out of the total, and the window
 * says so behind «Details». The same money is never counted twice: an LST is a wallet coin and counts as savings, a
 * pool position held by an agent's vault belongs to the agent, and the autopilot's savings and pool parts are already
 * the person's own Lend and pool positions.
 */

export type PlaceKind = 'wallet' | 'savings' | 'pools' | 'agents' | 'orders' | 'phoenix';
export const PLACE_ORDER: readonly PlaceKind[] = ['wallet', 'savings', 'pools', 'agents', 'orders', 'phoenix'];

/** How a place was read: `ready` with figures, `loading`, `failed`, or `off` where the deployment does not serve it. */
export type ReadState = 'ready' | 'loading' | 'failed' | 'off';

export type Action =
  | Readonly<{ kind: 'trade'; mint: string }>
  | Readonly<{ kind: 'lendWithdraw'; asset: 'USDC' | 'SOL' }>
  | Readonly<{ kind: 'pier'; address: string }>
  | Readonly<{ kind: 'care'; key: string }>
  | Readonly<{ kind: 'agentStop' }>
  | Readonly<{ kind: 'cancelOrder'; key: string; venue: string; order: string }>
  | Readonly<{ kind: 'cancelPoolOrder'; order: string }>
  | Readonly<{ kind: 'phoenix' }>;

export type Row = Readonly<{
  id: string;
  /** The coin's mint where the row is one coin — for its icon. */
  mint: string | null;
  title: string;
  /** One short line under the title: an amount, a range, a state. */
  line: string;
  usd: number | null;
  /** A gain to show beside the value (fees to take, interest earned, an agent's result), USD; null without one. */
  gainUsd: number | null;
  /** The day's move of this row in per cent, where the catalogue carries it. */
  dayPct: number | null;
  tone: 'on' | 'off' | null;
  action: Action | null;
  /** A second action on the same row: a pool's «Exit» beside «Fees». */
  second: Action | null;
}>;

export type Place = Readonly<{
  kind: PlaceKind;
  state: ReadState;
  rows: readonly Row[];
  /** The rows that have a value, added; null when none has. */
  usd: number | null;
  /** Rows held without a dollar figure: listed, never added. */
  unpriced: number;
}>;

export type PortfolioView = Readonly<{
  places: readonly Place[];
  totalUsd: number | null;
  /** The day's move of what moved today, USD and per cent of the day's start; null where no row carries a move. */
  dayUsd: number | null;
  dayPct: number | null;
  /** Places that hold money but were not read: the total may be short by them. */
  unread: readonly PlaceKind[];
  /** Places still being read: the total may grow by them. */
  reading: readonly PlaceKind[];
  /** One segment per place with a value, its share of the total, in the order of `PLACE_ORDER`. */
  bar: readonly Readonly<{ kind: PlaceKind; usd: number; share: number }>[];
}>;

export type LendInput = Readonly<{ asset: 'USDC' | 'SOL'; mint: string; decimals: number; worthRaw: bigint | null; earnedRaw: bigint | null }>;

export type PierInput = Readonly<{
  address: string;
  name: string;
  inRange: boolean;
  lower: number | null;
  upper: number | null;
  valueUsd: number | null;
  unclaimedUsd: number | null;
  lockedBps: number;
}>;

/** A pier the agent looks after; `usd` — the engine's worth of it (CITY-207), null — not priced. */
export type CareInput = Readonly<{ key: string; pool: string; name: string | null; inRange: boolean; usd?: number | null; unclaimedUsd?: number | null }>;

export type AgentInput = Readonly<{
  /** The vault's SOL on chain, lamports; null when it was not read. */
  vaultLamports: bigint | null;
  /** On the network this city signs for: a devnet vault is shown, never added to anyone's money. */
  mainnet: boolean;
  working: boolean;
  /** The agent's whole mandate after fees, lamports (CITY-197); null without it. */
  netLamports: bigint | null;
  trades: number | null;
  symbol: string | null;
}>;

export type OrderInput = Readonly<{
  key: string;
  venue: string;
  order: string;
  /** `Buy BONK`, `Sell JUP` — already in the language on screen. */
  title: string;
  inputMint: string;
  /** What is still in the order, input units. */
  leftRaw: bigint;
  decimals: number | null;
  canCancel: boolean;
  /** A pool limit order (CITY-97), cancelled through the pool card. */
  pool: boolean;
}>;

export type PortfolioInput = Readonly<{
  assets: readonly MoneyAsset[];
  walletState: ReadState;
  lend: Readonly<{ state: ReadState; rows: readonly LendInput[] }>;
  piers: Readonly<{ state: ReadState; rows: readonly PierInput[] }>;
  care: Readonly<{ state: ReadState; rows: readonly CareInput[] }>;
  agent: Readonly<{ state: ReadState; row: AgentInput | null }>;
  orders: Readonly<{ state: ReadState; rows: readonly OrderInput[] }>;
  phoenix: Readonly<{ state: ReadState; usd: number | null }>;
  /** Words for the lines, so this file stays free of the dictionary. */
  words: PortfolioWords;
}>;

export type PortfolioWords = Readonly<{
  inRange: string;
  outOfRange: string;
  locked: string;
  caring: string;
  working: string;
  stopped: string;
  test: string;
  trades: (n: number) => string;
  agent: string;
  phoenix: string;
  phoenixLine: string;
  earned: string;
}>;

const units = (raw: bigint, decimals: number): number => Number(scaleRawAmount(raw.toString(), decimals).replace(/,/g, ''));

/** A short amount for a line: 1,240 · 12.4 · 0.0042. For the eye only. */
export function shortUnits(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (value >= 1_000) return Math.round(value).toLocaleString('en-US');
  if (value >= 1) return Number(value.toFixed(2)).toLocaleString('en-US');
  return Number(value.toPrecision(2)).toString();
}

function priceOf(assets: readonly MoneyAsset[], mint: string | null): number | null {
  const asset = mint === null ? assets.find((a) => a.id === NATIVE_ID) : assets.find((a) => a.mint === mint || (a.native && mint === 'So11111111111111111111111111111111111111112'));
  return asset?.usdPrice ?? null;
}

function rangeText(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) return '';
  return `${shortUnits(lower)} – ${shortUnits(upper)}`;
}

function place(kind: PlaceKind, state: ReadState, rows: readonly Row[]): Place {
  const valued = rows.filter((row) => row.usd !== null);
  return {
    kind,
    state,
    rows,
    usd: valued.length ? valued.reduce((sum, row) => sum + (row.usd as number), 0) : null,
    unpriced: rows.length - valued.length,
  };
}

/** The portfolio, from what each engine read answered. */
export function portfolioView(input: PortfolioInput): PortfolioView {
  const { assets, words } = input;
  const solUsd = priceOf(assets, null);

  /* The wallet: every coin but the LSTs, which are savings. Most valuable first, SOL always on top. */
  const coins = assets.filter((asset) => !(asset.mint && LST_BY_MINT.has(asset.mint)));
  const walletRows: Row[] = coins
    .map((asset) => ({ asset, usd: valueOf(asset) }))
    .sort((a, b) => (a.asset.native !== b.asset.native ? (a.asset.native ? -1 : 1) : (b.usd ?? -1) - (a.usd ?? -1)))
    .map(({ asset, usd }) => ({
      id: `coin:${asset.id}`,
      mint: asset.mint,
      title: asset.symbol,
      line: `${shortUnits(units(BigInt(asset.amountRaw), asset.decimals))} ${asset.symbol}`,
      usd,
      gainUsd: null,
      dayPct: asset.dayChangePct ?? null,
      tone: null,
      action: asset.mint || asset.native ? { kind: 'trade', mint: asset.mint ?? 'So11111111111111111111111111111111111111112' } : null,
      second: null,
    }));

  /* Savings: Jupiter Lend positions and the LSTs the wallet holds. */
  const lendRows: Row[] = input.lend.rows.map((row) => {
    const price = priceOf(assets, row.asset === 'SOL' ? null : row.mint);
    const worth = row.worthRaw === null ? null : units(row.worthRaw, row.decimals);
    const earned = row.earnedRaw === null ? null : units(row.earnedRaw, row.decimals);
    return {
      id: `lend:${row.asset}`,
      mint: row.mint,
      title: `${row.asset} · Jupiter Lend`,
      line: worth === null ? '' : `${shortUnits(worth)} ${row.asset}`,
      usd: worth !== null && price !== null ? worth * price : null,
      gainUsd: earned !== null && price !== null && earned > 0 ? earned * price : null,
      dayPct: null,
      tone: null,
      action: { kind: 'lendWithdraw', asset: row.asset },
      second: null,
    };
  });
  const lstRows: Row[] = assets
    .filter((asset) => asset.mint && LST_BY_MINT.has(asset.mint))
    .map((asset) => ({
      id: `lst:${asset.mint}`,
      mint: asset.mint,
      title: asset.symbol,
      line: `${shortUnits(units(BigInt(asset.amountRaw), asset.decimals))} ${asset.symbol}`,
      usd: valueOf(asset),
      gainUsd: null,
      dayPct: asset.dayChangePct ?? null,
      tone: null,
      action: { kind: 'trade', mint: asset.mint as string },
      second: null,
    }));
  const savingsState: ReadState = input.lend.state === 'off' ? (input.walletState === 'ready' ? 'ready' : input.walletState) : input.lend.state;

  /* Pools: the person's own positions, then the ones an agent looks after from its vault. */
  const pierRows: Row[] = input.piers.rows.map((row) => ({
    id: `pier:${row.address}`,
    mint: null,
    title: row.name,
    line: [row.inRange ? words.inRange : words.outOfRange, rangeText(row.lower, row.upper), row.lockedBps > 0 ? words.locked : ''].filter(Boolean).join(' · '),
    usd: row.valueUsd,
    gainUsd: row.unclaimedUsd !== null && row.unclaimedUsd > 0 ? row.unclaimedUsd : null,
    dayPct: null,
    tone: row.inRange ? 'on' : 'off',
    action: { kind: 'pier', address: row.address },
    second: null,
  }));
  const careRows: Row[] = input.care.rows.map((row) => ({
    id: `care:${row.key}`,
    mint: null,
    title: row.name ?? `${row.pool.slice(0, 4)}…${row.pool.slice(-4)}`,
    line: `${words.caring} · ${row.inRange ? words.inRange : words.outOfRange}`,
    usd: typeof row.usd === 'number' && Number.isFinite(row.usd) ? row.usd : null,
    gainUsd: typeof row.unclaimedUsd === 'number' && row.unclaimedUsd > 0 ? row.unclaimedUsd : null,
    dayPct: null,
    tone: row.inRange ? 'on' : 'off',
    action: { kind: 'care', key: row.key },
    second: null,
  }));
  /* The person's own positions decide the place's state; the cared ones only add rows. */
  const poolsState: ReadState = input.piers.state === 'off' ? input.care.state : input.piers.state;

  /* Agents: the budget vault. Its SOL counts only on mainnet. */
  const agent = input.agent.row;
  const agentRows: Row[] = agent
    ? [{
        id: 'agent:mandate',
        mint: null,
        title: agent.symbol ? `${words.agent} · ${agent.symbol}` : words.agent,
        line: [agent.working ? words.working : words.stopped, agent.trades !== null ? words.trades(agent.trades) : '', agent.mainnet ? '' : words.test].filter(Boolean).join(' · '),
        usd: agent.mainnet && agent.vaultLamports !== null && solUsd !== null ? units(agent.vaultLamports, 9) * solUsd : null,
        gainUsd: agent.mainnet && agent.netLamports !== null && solUsd !== null ? units(agent.netLamports, 9) * solUsd : null,
        dayPct: null,
        tone: agent.working ? 'on' : 'off',
        action: { kind: 'agentStop' },
        second: null,
      }]
    : [];

  /* Orders: what is still inside each one, at the input coin's price. */
  const orderRows: Row[] = input.orders.rows.map((row) => {
    const amount = row.decimals === null ? null : units(row.leftRaw, row.decimals);
    const price = priceOf(assets, row.inputMint);
    const symbol = assets.find((a) => a.mint === row.inputMint)?.symbol ?? (row.inputMint === 'So11111111111111111111111111111111111111112' ? 'SOL' : '');
    return {
      id: `order:${row.key}`,
      mint: row.inputMint,
      title: row.title,
      line: amount === null ? '' : `${shortUnits(amount)} ${symbol}`.trim(),
      usd: amount !== null && price !== null ? amount * price : null,
      gainUsd: null,
      dayPct: null,
      tone: null,
      action: row.canCancel ? (row.pool ? { kind: 'cancelPoolOrder', order: row.order } : { kind: 'cancelOrder', key: row.key, venue: row.venue, order: row.order }) : null,
      second: null,
    };
  });

  const phoenixRows: Row[] = input.phoenix.state === 'ready' && input.phoenix.usd !== null
    ? [{ id: 'phoenix', mint: null, title: words.phoenix, line: words.phoenixLine, usd: input.phoenix.usd, gainUsd: null, dayPct: null, tone: null, action: { kind: 'phoenix' }, second: null }]
    : [];

  const places: Place[] = [
    place('wallet', input.walletState, walletRows),
    place('savings', savingsState, [...lendRows, ...lstRows]),
    place('pools', poolsState, [...pierRows, ...careRows]),
    place('agents', input.agent.state, agentRows),
    place('orders', input.orders.state, orderRows),
    place('phoenix', input.phoenix.state, phoenixRows),
  ];

  const valued = places.filter((p) => p.usd !== null);
  const totalUsd = valued.length ? valued.reduce((sum, p) => sum + (p.usd as number), 0) : null;

  /* The day's move of what carries one: value now less value at the day's start. */
  let dayUsd: number | null = null;
  let startUsd = 0;
  for (const p of places) {
    for (const row of p.rows) {
      if (row.usd === null || row.dayPct === null || !Number.isFinite(row.dayPct) || row.dayPct <= -100) continue;
      const start = row.usd / (1 + row.dayPct / 100);
      dayUsd = (dayUsd ?? 0) + (row.usd - start);
      startUsd += start;
    }
  }
  const dayPct = dayUsd !== null && startUsd > 0 ? (dayUsd / startUsd) * 100 : null;

  const unread = places.filter((p) => p.state === 'failed').map((p) => p.kind);
  const reading = places.filter((p) => p.state === 'loading' && p.rows.length === 0).map((p) => p.kind);
  const bar = totalUsd !== null && totalUsd > 0
    ? valued.filter((p) => (p.usd as number) > 0).map((p) => ({ kind: p.kind, usd: p.usd as number, share: (p.usd as number) / totalUsd }))
    : [];
  return { places, totalUsd, dayUsd, dayPct, unread, reading, bar };
}
