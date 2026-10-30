import { liquidationDistancePercent, readSubaccounts, type PhoenixMarginWire } from '../../../lib/phoenix/collateral-model.ts';
import { symbolKey, unrealisedPnl, type FuturesAccount, type FuturesMarket, type FuturesOrder, type FuturesSide } from '../../../lib/phoenix/market-data.ts';
import { guardianView, type GuardianView } from '../../../lib/phoenix/risk-guardian.ts';
import { wordsNow } from '../i18n/dict.ts';
import { EXCHANGE_EXIT } from './flag.ts';
import { liveTable } from './live.ts';
import { EX_ACCOUNT, EX_HEALTH } from './words.ts';

/**
 * A wallet's Phoenix account as the Exchange shows it, every figure the engine's: the account read
 * (`/api/solana/futures/account` — Phoenix's trader state and its margin view), the position's result at the mark by
 * the engine's own `unrealisedPnl`, the liquidation price and leverage from Phoenix's margin view, and the account's
 * health on the engine's one scale (`risk-guardian.ts`). Where Phoenix sent no figure the row says so; the city never
 * fills one in.
 *
 * Ryntra trades the account's first subaccount — cross margin, the one phoenix.trade opens for the same wallet. A
 * position Phoenix holds on another subaccount (isolated margin) is shown and read, never acted on from here.
 */

/** What the account panel says, from the person's wallet to Phoenix's own word on the account. */
export type AccountKind =
  /** No wallet connected. */
  | 'connect'
  /** The first read is on its way. */
  | 'loading'
  /** Phoenix did not answer and there is no earlier read to show. */
  | 'unavailable'
  /** Phoenix has no trader account for this wallet: accounts open by invite, referral or a partner's onboarding. */
  | 'invite'
  /** Phoenix holds the account until access is granted. */
  | 'frozen'
  /** Phoenix lets the account cut and close, not open. */
  | 'reduceOnly'
  /** Phoenix lists the account as inactive. */
  | 'inactive'
  | 'active'
  /** Phoenix sent a state this release does not know: the Review is the one to say what it takes. */
  | 'unknown';

export type AccountRead = Readonly<{ status: 'idle' | 'loading' | 'ready' | 'failed'; value: FuturesAccount | null; at: number | null }>;

/**
 * The account's kind. With the Exchange in `exit` (decision 86: futures have gone to RXN) an account that could open is
 * read as closing only: from the city it cuts, closes, cancels and withdraws, and opens nothing.
 */
export function accountKind(connected: boolean, read: AccountRead, exit: boolean = EXCHANGE_EXIT): AccountKind {
  const kind = phoenixKind(connected, read);
  return exit && opensFrom(kind) ? 'reduceOnly' : kind;
}

function phoenixKind(connected: boolean, read: AccountRead): AccountKind {
  if (!connected) return 'connect';
  const account = read.value;
  if (!account) return read.status === 'failed' ? 'unavailable' : 'loading';
  switch (account.state) {
    case 'none':
    case 'uninitialized':
      return 'invite';
    case 'frozen':
      return 'frozen';
    case 'reduceOnly':
      return 'reduceOnly';
    case 'cold':
      return 'inactive';
    case 'active':
      return 'active';
    default:
      return 'unknown';
  }
}

const KINDS: readonly AccountKind[] = ['connect', 'loading', 'unavailable', 'invite', 'frozen', 'reduceOnly', 'inactive', 'active', 'unknown'];

/** One title, and at most one short line where the title alone would not be honest (the clean interface rule of 28.10). */
export const ACCOUNT_WORDS: Readonly<Record<AccountKind, Readonly<{ title: string; line: string }>>> = liveTable(KINDS, (kind) => {
  const w = wordsNow(EX_ACCOUNT);
  return { title: w[kind], line: kind === 'invite' ? w.inviteLine : '' };
});

/** Whether the account may open or add to a position from here, by Phoenix's word on it. */
export const opensFrom = (kind: AccountKind): boolean => kind === 'active' || kind === 'inactive' || kind === 'unknown';
/** Whether it may cut, close, set TP/SL and cancel: everything that takes risk away. */
export const reducesFrom = (kind: AccountKind): boolean => opensFrom(kind) || kind === 'reduceOnly';
/** Whether there is an account whose book, positions, orders and history are worth a tab: not without a wallet or an account. */
export const hasBook = (kind: AccountKind): boolean => kind !== 'connect' && kind !== 'invite' && kind !== 'frozen' && kind !== 'unavailable';

/** Whether the wallet still holds anything on Phoenix: a position, a resting order, or collateral of either kind. */
export function phoenixHolds(account: FuturesAccount | null): boolean {
  if (!account) return false;
  return account.positions.length > 0 || account.orders.length > 0 || (account.collateralUsd ?? 0) > 0 || (account.collateralSol ?? 0) > 0;
}

/** Every margin view the account read holds: the cross-margin subaccount's and each isolated one's. */
export function marginsOf(account: FuturesAccount | null): PhoenixMarginWire[] {
  if (!account) return [];
  return [...(account.margin ? [account.margin] : []), ...(account.subaccountMargins ?? [])];
}

/** How old an account read may be before its figures are called the last ones read: three of its refreshes. */
export const ACCOUNT_STALE_MS = 45_000;

/**
 * The account's health on the engine's scale: Phoenix's risk tier across the subaccounts, the least room any keeps
 * before its maintenance margin, and the actions the scale offers. Stale when the last good read is old or the
 * latest one failed — the worse word Phoenix gave still stands (`guardianView`).
 */
export function healthOf(read: AccountRead, now: number): GuardianView | null {
  const account = read.value;
  if (!account || account.state === 'none') return null;
  const margins = marginsOf(account);
  if (margins.length === 0 && account.positions.length === 0) return null;
  const stale = read.status === 'failed' || (read.at !== null && now - read.at > ACCOUNT_STALE_MS);
  const known = readSubaccounts(account);
  return guardianView({
    margins,
    stale,
    hasPositions: account.positions.some((position) => position.subaccount === 0),
    hasOrders: account.orders.some((order) => order.subaccount === 0),
    partial: account.positions.some((position) => !known.has(position.subaccount)),
  });
}

const HEALTH_STATES: readonly GuardianView['state'][] = ['healthy', 'raised', 'critical', 'stale', 'liquidation'];

export const HEALTH_WORDS: Readonly<Record<GuardianView['state'], Readonly<{ word: string; line: string }>>> = liveTable(HEALTH_STATES, (state) => {
  const w = wordsNow(EX_HEALTH);
  return { word: w[state], line: w[`${state}Line`] };
});

export type PositionRow = Readonly<{
  key: string;
  symbol: string;
  subaccount: number;
  side: FuturesSide;
  /** In the base asset; null when Phoenix sent lots of a market whose units are unknown. */
  size: number | null;
  entry: number | null;
  mark: number | null;
  /** The result at the mark, by the engine's `unrealisedPnl`; null without both prices. */
  pnlUsd: number | null;
  /** Where Phoenix liquidates it, a mark price, by Phoenix's margin view. */
  liquidationUsd: number | null;
  /** `read` — Phoenix's figure (null when it has none); `unread` — the subaccount's margin view was not read. */
  liquidation: 'read' | 'unread';
  /** How far the mark may move against it before that, per cent of the mark (the engine's own distance). */
  liquidationAwayPercent: number | null;
  leverage: number | null;
  tp: number | null;
  sl: number | null;
  /** The cross-margin subaccount: Ryntra can close it and set its TP/SL. */
  manageable: boolean;
}>;

/** The account's positions with Phoenix's figures beside each, the cross-margin ones first. */
export function positionRows(account: FuturesAccount | null, markets: readonly FuturesMarket[]): PositionRow[] {
  if (!account) return [];
  const bySymbol = new Map(markets.map((market) => [symbolKey(market.symbol), market]));
  const read = readSubaccounts(account);
  const risks = marginsOf(account).flatMap((margin) => margin.positions ?? []);
  return account.positions
    .map((position): PositionRow => {
      const mark = bySymbol.get(symbolKey(position.symbol))?.markPrice ?? null;
      const risk = risks.find((entry) => entry.subaccount === position.subaccount && symbolKey(entry.symbol) === symbolKey(position.symbol)) ?? null;
      const liquidationUsd = risk?.liquidationPriceUsd ?? null;
      return {
        key: `${position.subaccount}:${position.symbol}`,
        symbol: position.symbol,
        subaccount: position.subaccount,
        side: position.side,
        size: position.size,
        entry: position.entryPrice,
        mark,
        pnlUsd: unrealisedPnl(position, mark),
        liquidationUsd,
        liquidation: read.has(position.subaccount) ? 'read' : 'unread',
        liquidationAwayPercent: liquidationDistancePercent(position.side, mark, liquidationUsd),
        leverage: risk?.leverage ?? null,
        tp: position.tpPrice ?? null,
        sl: position.slPrice ?? null,
        manageable: position.subaccount === 0,
      };
    })
    .sort((a, b) => a.subaccount - b.subaccount || a.symbol.localeCompare(b.symbol));
}

export type OrderRow = Readonly<{
  key: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  price: number | null;
  size: number | null;
  reduceOnly: boolean;
  /** A take profit or a stop loss of a position, when Phoenix's account names which. */
  leg: 'tp' | 'sl' | null;
  stop: boolean;
  /**
   * How this one row is cancelled from here: by its sequence number (a plain resting order), by the position's
   * conditional index (a TP/SL leg — the pair placed together goes together), or not alone (a conditional row without
   * a known index, or another subaccount's): «Cancel all» of its market still takes it.
   */
  cancel: Readonly<{ kind: 'order'; sequence: string }> | Readonly<{ kind: 'conditional'; index: number }> | null;
}>;

export function orderRows(account: FuturesAccount | null): OrderRow[] {
  if (!account) return [];
  return account.orders.map((order: FuturesOrder): OrderRow => {
    const own = order.subaccount === 0;
    const leg = order.conditionalLeg ?? null;
    const cancel = !own
      ? null
      : order.conditional != null
        ? ({ kind: 'conditional', index: order.conditional } as const)
        : !order.stop && order.sequence
          ? ({ kind: 'order', sequence: order.sequence } as const)
          : null;
    return { key: order.id, symbol: order.symbol, side: order.side, type: order.type, price: order.price, size: order.size, reduceOnly: order.reduceOnly, leg, stop: order.stop, cancel };
  });
}

/** The markets with at least one of this account's orders that «Cancel all» can lift (the cross-margin subaccount). */
export function cancelAllMarkets(account: FuturesAccount | null): string[] {
  if (!account) return [];
  return [...new Set(account.orders.filter((order) => order.subaccount === 0).map((order) => order.symbol))];
}

export type Collateral = Readonly<{
  collateralUsd: number | null;
  collateralSol: number | null;
  /** Phoenix's own figures: what the account is worth with the unrealised result, what positions and orders hold, what may leave now. */
  portfolioUsd: number | null;
  heldUsd: number | null;
  withdrawableMicro: bigint | null;
  canDeposit: boolean;
  canWithdraw: boolean;
}>;

/** The account's money as Phoenix's margin view states it; the trader state's collateral where no margin was read. */
export function collateralOf(account: FuturesAccount | null): Collateral | null {
  if (!account || account.state === 'none') return null;
  const margin = account.margin ?? null;
  const withdrawable = margin?.withdrawableMicro;
  return {
    collateralUsd: margin?.collateralUsd ?? account.collateralUsd,
    collateralSol: account.collateralSol,
    portfolioUsd: margin?.portfolioUsd ?? null,
    heldUsd: margin?.initialMarginUsd ?? null,
    withdrawableMicro: typeof withdrawable === 'string' && /^\d+$/.test(withdrawable) ? BigInt(withdrawable) : null,
    canDeposit: margin?.canDeposit ?? false,
    canWithdraw: margin?.canWithdraw ?? false,
  };
}
