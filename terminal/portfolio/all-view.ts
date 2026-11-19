import { NATIVE_SOL_MINT, USDC_MINT, unitsOf, type ExitReason, type PortfolioAnswer, type PortfolioPosition, type PortfolioProtocol } from '../../lib/portfolio/model.ts';

/**
 * «Everything in Solana» on the Portfolio — its rules, without React: the engine's one answer (`GET /api/v1/portfolio`)
 * laid out as the screen's groups, the total with its parts, what is dust, which coin is better left alone, what each
 * of the three actions offers, and what an exit can and cannot take in one step.
 *
 * Nothing here prices, routes or signs: every figure is the engine's own, put into groups and added — the same money
 * never twice.
 *
 * Pure: the tests hold them as they are written.
 */

export type Position = PortfolioPosition;
export type Answer = Pick<PortfolioAnswer, 'owner' | 'at' | 'solUsd' | 'totals' | 'positions' | 'sources'>;

/* ── the address a person pastes ──────────────────────────────────────── */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A wallet's address out of what a person pasted — the bare address, or one inside a link; null — not an address. */
export function addressOf(typed: string): string | null {
  const clean = typed.trim();
  if (BASE58.test(clean)) return clean;
  // An explorer's or a wallet's link: the address is one of its path's parts.
  const parts = clean.split(/[/?#&=\s]+/).filter((part) => BASE58.test(part));
  return parts.length === 1 ? parts[0]! : null;
}

/** An address for the eye: its first and last four. */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/* ── the groups ───────────────────────────────────────────────────────── */

export type GroupId = 'pools' | 'staking' | 'lending' | 'other' | 'coins' | 'dust';

/** The order the screen lists them in: what works first, the wallet's coins after, the dust last. */
export const GROUPS: readonly GroupId[] = ['pools', 'staking', 'lending', 'other', 'coins', 'dust'];

/** A coin worth up to this is dust — the same line the wallet's clean draws (`lib/wallet-clean`). */
export const DUST_USD = 5;

/** The coin a wallet row is about: its one token's mint; null for a row that only says «not read». */
export function mintOf(position: Position): string | null {
  return position.tokens[0]?.mint ?? null;
}

const isNativeSol = (position: Position): boolean => position.id === 'wallet:sol';

/**
 * Which group a position stands in. Another platform's row the engine only sees through a third party is «other»,
 * whatever its kind. A coin is dust when it is worth up to {@link DUST_USD} — never SOL itself or USDC — or has no
 * price and the wallet's clean lists it as litter; a coin whose price simply did not read stays a coin.
 */
export function groupOf(position: Position, litter: ReadonlySet<string> = new Set()): GroupId {
  if (position.origin === 'projection' || position.kind === 'other') return 'other';
  if (position.kind === 'pool') return 'pools';
  if (position.kind === 'lst' || position.kind === 'stake') return 'staking';
  if (position.kind === 'deposit' || position.kind === 'borrow') return 'lending';
  if (position.state === 'unread') return 'coins';
  const mint = mintOf(position);
  if (isNativeSol(position) || mint === USDC_MINT || mint === null) return 'coins';
  const usd = position.value.usd;
  if (usd === null) return litter.has(mint) ? 'dust' : 'coins';
  return usd <= DUST_USD ? 'dust' : 'coins';
}

export type Row = Readonly<{
  id: string;
  group: GroupId;
  position: Position;
  /** A coin's symbol, a pool's pair; null — the screen names it by its protocol. */
  name: string | null;
  /** The coins to draw: what is held, supplied or borrowed — two at most. */
  coins: readonly Readonly<{ mint: string; symbol: string | null }>[];
  usd: number | null;
  sol: number | null;
  /** Fees and rewards still to collect, or a deposit's interest, dollars. */
  earnedUsd: number | null;
  /** A single coin's amount, in whole coins — for the eye only. */
  units: number | null;
  /** A single coin's price, from its worth and its amount. */
  price: number | null;
  /**
   * The worth was counted on the screen from the market's price of a coin the engine left unpriced (a pool's side) —
   * never set on a row the engine priced.
   */
  marketPriced?: boolean;
}>;

const PRINCIPAL = new Set(['held', 'supplied', 'borrowed']);

function rowOf(position: Position, group: GroupId): Row {
  const principal = position.tokens.filter((token) => PRINCIPAL.has(token.role));
  const single = principal.length === 1 ? principal[0]! : null;
  const units = single && single.amountRaw !== null && single.decimals !== null ? unitsOf(single.amountRaw, single.decimals) : null;
  const usd = position.value.usd;
  return {
    id: position.id,
    group,
    position,
    name: position.label,
    coins: principal.slice(0, 2).map((token) => ({ mint: token.mint, symbol: token.symbol })),
    usd,
    sol: position.value.sol,
    earnedUsd: position.earned?.usd ?? null,
    units,
    price: units !== null && units > 0 && usd !== null ? Math.abs(usd) / units : null,
  };
}

export type Group = Readonly<{
  id: GroupId;
  rows: readonly Row[];
  /** The group's dollars: what was priced, borrows subtracted; null — nothing in it has a price. */
  usd: number | null;
  /** How many rows are positions — a row that only says «not read» is not one. */
  count: number;
}>;

/** The answer as the screen's groups, in the screen's order; a group with nothing in it is not there at all. */
export function groupsOf(answer: Pick<Answer, 'positions'>, litter: ReadonlySet<string> = new Set()): Group[] {
  const byGroup = new Map<GroupId, Row[]>();
  for (const position of answer.positions) {
    const group = groupOf(position, litter);
    const rows = byGroup.get(group) ?? [];
    rows.push(rowOf(position, group));
    byGroup.set(group, rows);
  }
  return GROUPS.flatMap((id) => {
    const rows = byGroup.get(id);
    if (!rows?.length) return [];
    const priced = rows.filter((row) => row.usd !== null && row.position.state !== 'unread');
    return [{ id, rows, usd: priced.length ? priced.reduce((sum, row) => sum + (row.usd as number), 0) : null, count: rows.filter((row) => row.position.state !== 'unread').length }];
  });
}

/* ── the market beside the engine ─────────────────────────────────────── */

/** What the market says of a coin (`/api/v1/market/depth`, the list of named mints): its name, logo, price and day. */
export type MarketFact = Readonly<{ symbol: string | null; name: string | null; icon: string | null; price: number | null; dayPct: number | null }>;

const groupSum = (rows: readonly Row[]): number | null => {
  const priced = rows.filter((row) => row.usd !== null && row.position.state !== 'unread');
  return priced.length ? priced.reduce((sum, row) => sum + (row.usd as number), 0) : null;
};

/**
 * The groups with what the market adds where the engine is silent: a coin without a symbol gets the market's, a pool
 * with no name is named by its coins, and a position the engine could not price — one of its coins has no engine
 * price — is priced at the market's price of that coin, but only when every coin it holds has a price. The coins and the
 * dust stay the engine's own: a coin it did not price is listed «No price».
 */
export function withMarket(groups: readonly Group[], fact: (mint: string) => MarketFact | null): Group[] {
  return groups.map((group) => {
    const works = group.id === 'pools' || group.id === 'staking' || group.id === 'lending';
    let changed = false;
    const rows = group.rows.map((row): Row => {
      if (row.position.state === 'unread') return row;
      const coins = row.coins.map((coin) => (coin.symbol ? coin : { ...coin, symbol: fact(coin.mint)?.symbol ?? null }));
      // A name the engine made without one of the coins (an older engine took a fee's coin for the missing side) is
      // made again from the coins themselves.
      const sideUnnamed = row.coins.some((coin) => !coin.symbol);
      const paired = works && coins.length > 1 && coins.every((coin) => coin.symbol) ? coins.map((coin) => coin.symbol).join('–') : null;
      const named = sideUnnamed && paired ? paired : (row.name ?? paired);
      let usd = row.usd;
      let marketPriced = row.marketPriced;
      if (works && usd === null) {
        const principal = row.position.tokens.filter((token) => PRINCIPAL.has(token.role));
        let sum = 0;
        let all = principal.length > 0;
        for (const token of principal) {
          if (token.usd !== null) {
            sum += token.role === 'borrowed' ? -Math.abs(token.usd) : token.usd;
            continue;
          }
          const price = fact(token.mint)?.price ?? null;
          if (price === null || !(price > 0) || token.amountRaw === null || token.decimals === null) {
            all = false;
            break;
          }
          const worth = unitsOf(token.amountRaw, token.decimals) * price;
          sum += token.role === 'borrowed' ? -worth : worth;
        }
        if (all) {
          // Its fees and rewards too, as the engine counts a pool it priced — each where it has a price.
          for (const token of row.position.tokens) {
            if (token.role !== 'fee' && token.role !== 'reward') continue;
            const price = token.usd === null ? (fact(token.mint)?.price ?? null) : null;
            if (token.usd !== null) sum += token.usd;
            else if (price !== null && price > 0 && token.amountRaw !== null && token.decimals !== null) sum += unitsOf(token.amountRaw, token.decimals) * price;
          }
          usd = sum;
          marketPriced = true;
        }
      }
      const same = usd === row.usd && named === row.name && coins.every((coin, i) => coin === row.coins[i]);
      if (same) return row;
      changed = true;
      return { ...row, coins, name: named, usd, marketPriced };
    });
    return changed ? { ...group, rows, usd: groupSum(rows) } : group;
  });
}

/* ── the total and its parts ──────────────────────────────────────────── */

export type PartId = 'coins' | 'dust' | 'pools' | 'staking' | 'lending' | 'agents';
/** The legend's parts, each the sum its group shows: the dust stands apart from the coins, as its group does. */
export const PARTS: readonly PartId[] = ['pools', 'staking', 'lending', 'coins', 'dust', 'agents'];

export type Summary = Readonly<{
  /** Everything counted, dollars: the engine's own sum, and what the agents hold beside it. */
  usd: number;
  sol: number | null;
  /** The total is the whole of it ({@link wholeOf}); otherwise it is what has answered so far. */
  complete: boolean;
  /** One per part with something in it, in the screen's order. */
  parts: readonly Readonly<{ id: PartId; usd: number }>[];
  /** One segment per part with money, its share of what is drawn. */
  bar: readonly Readonly<{ id: PartId; share: number }>[];
  /** Everything answered and nothing is held. */
  empty: boolean;
  /** A source did not answer now: reading again may bring it — the only time the screen offers «Read again». */
  unread: boolean;
}>;

/**
 * «Total»: the engine's sum — and the agents' budgets, which stand outside the wallet, and a position the screen priced
 * at the market where the engine could not ({@link withMarket}) — with its parts, each the sum its group shows; lending
 * is deposits less borrows. A part with nothing in it is left out.
 */
export function summaryOf(answer: Answer, groups: readonly Group[], agentsUsd: number | null = null): Summary {
  const of = (id: GroupId): number => groups.find((group) => group.id === id)?.usd ?? 0;
  const agents = agentsUsd !== null && agentsUsd > 0 ? agentsUsd : 0;
  const sums: Readonly<Record<PartId, number>> = { pools: of('pools'), staking: of('staking'), lending: of('lending'), coins: of('coins'), dust: of('dust'), agents };
  const parts = PARTS.filter((id) => Math.abs(sums[id]) >= 0.005).map((id) => ({ id, usd: sums[id] }));
  const drawn = parts.filter((part) => part.usd > 0);
  const whole = drawn.reduce((sum, part) => sum + part.usd, 0);
  const marketed = groups.flatMap((group) => group.rows).reduce((sum, row) => sum + (row.marketPriced && row.usd !== null ? row.usd : 0), 0);
  const usd = answer.totals.usd + agents + marketed;
  const held = answer.positions.some((position) => position.state !== 'unread');
  const complete = wholeOf(answer, groups);
  return {
    usd,
    sol: answer.solUsd !== null && answer.solUsd > 0 ? usd / answer.solUsd : null,
    complete,
    parts,
    bar: whole > 0 ? drawn.map((part) => ({ id: part.id, share: part.usd / whole })) : [],
    empty: complete && !held && agents === 0,
    unread: partial(answer),
  };
}

export type DayMove = Readonly<{ usd: number; pct: number | null }>;

/**
 * The day's move of the coins the market moved today: each coin's worth now less its worth at the day's start. Counts
 * the wallet's coins and everything staked — a staked coin, and a stake, which is SOL; a pool, a deposit and another
 * platform's row are not counted. Null when none of them carries a move.
 */
export function dayMove(rows: readonly Row[], change: (mint: string) => number | null): DayMove | null {
  let usd: number | null = null;
  let start = 0;
  for (const row of rows) {
    if (row.group !== 'coins' && row.group !== 'dust' && row.group !== 'staking') continue;
    const mint = mintOf(row.position);
    const pct = mint ? change(mint) : null;
    if (row.usd === null || pct === null || !Number.isFinite(pct) || pct <= -100) continue;
    const before = row.usd / (1 + pct / 100);
    usd = (usd ?? 0) + (row.usd - before);
    start += before;
  }
  if (usd === null) return null;
  return { usd, pct: start > 0 ? (usd / start) * 100 : null };
}

/* ── what a row says of itself ────────────────────────────────────────── */

/** The protocol's own name, as people know it. Not translated: a name. */
export const PROTOCOL_NAME: Readonly<Record<PortfolioProtocol, string | null>> = {
  wallet: null,
  'native-stake': null,
  'meteora-dlmm': 'Meteora DLMM',
  'meteora-dlmm-pro': 'Meteora DLMM Pro',
  'meteora-damm-v2': 'Meteora DAMM v2',
  'jupiter-lend': 'Jupiter Lend',
  kamino: 'Kamino',
  other: null,
};

/** A platform's id as a third party writes it («orca-whirlpools») as a name: «Orca Whirlpools». */
export function platformName(platform: string | null): string | null {
  const clean = platform?.trim();
  if (!clean) return null;
  return clean
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Where a staking row stands: a staked coin, a stake at work, one on its way out, one free to take. */
export type StakeState = 'coin' | 'active' | 'cooling' | 'free' | 'held';

export function stakeState(position: Position): StakeState {
  if (position.kind === 'lst') return 'coin';
  const { how, reason } = position.exit;
  if (reason === 'STAKE_COOLING') return 'cooling';
  if (reason === 'STAKE_LOCKUP' || reason === 'NOT_WITHDRAWER') return 'held';
  if (how === 'stake-withdraw') return 'free';
  return 'active';
}

/**
 * A loan against its deposit: what is borrowed as a share of what is supplied on the same account, per cent. Null where
 * the two do not stand on one account, or a side has no price.
 */
export function loanShare(row: Row, rows: readonly Row[]): number | null {
  const account = row.position.refs.position;
  if (!account || row.position.kind !== 'borrow' || row.usd === null) return null;
  const supplied = rows.filter((other) => other.position.kind === 'deposit' && other.position.refs.position === account && other.usd !== null).reduce((sum, other) => sum + (other.usd as number), 0);
  return supplied > 0 ? (Math.abs(row.usd) / supplied) * 100 : null;
}

/* ── the three actions ────────────────────────────────────────────────── */

/** The pool positions with something to collect, and what that is in dollars. */
export function collectable(groups: readonly Group[]): Readonly<{ rows: readonly Row[]; usd: number }> {
  const rows = (groups.find((group) => group.id === 'pools')?.rows ?? []).filter((row) => {
    const { how, reason } = row.position.exit;
    // A pool the engine has no step for — not read, closed here, no route — has nothing it can collect.
    const reachable = how === 'pool-withdraw' && (reason === null || reason === 'LOCKED' || reason === 'LIQUIDITY');
    return row.position.state !== 'unread' && reachable && (row.earnedUsd ?? 0) > 0;
  });
  return { rows, usd: rows.reduce((sum, row) => sum + (row.earnedUsd as number), 0) };
}

/** How an exit takes a position: all of it now, a part now, a first step now and the rest later — or not at all. */
export type ExitCan = 'now' | 'part' | 'later' | 'no';

export type ExitLine = Readonly<{
  id: string;
  row: Row;
  can: ExitCan;
  /** What stops one step, or takes only a part; null — nothing does. */
  reason: ExitReason | null;
  /** The share one step takes out now, per cent. */
  partPct: number;
  untilEpoch: number | null;
  untilTime: string | null;
}>;

const NEVER: ReadonlySet<ExitReason> = new Set(['NOT_READ', 'PROJECTION', 'NO_ROUTE', 'DEBT', 'REPAY', 'STAKE_COOLING', 'STAKE_LOCKUP', 'NOT_WITHDRAWER', 'CLOSED_HERE']);

/**
 * What «Exit everything» is about: everything that works — pools, staking, deposits and loans — each with how an exit
 * takes it. The wallet's own coins are not here: they are sold on their ticket, and the dust is the clean's.
 */
export function exitLines(groups: readonly Group[]): ExitLine[] {
  return groups
    .filter((group) => group.id === 'pools' || group.id === 'staking' || group.id === 'lending')
    .flatMap((group) => group.rows)
    .filter((row) => row.position.state !== 'unread')
    .map((row): ExitLine => {
      const exit = row.position.exit;
      const partPct = Math.round(exit.partBps / 100);
      let can: ExitCan;
      if (exit.oneStep) can = 'now';
      else if (exit.how === 'none' || (exit.reason !== null && NEVER.has(exit.reason))) can = 'no';
      else if (exit.reason === 'STAKE_ACTIVE') can = 'later';
      else can = partPct > 0 ? 'part' : 'no';
      return { id: row.id, row, can, reason: exit.reason, partPct, untilEpoch: exit.untilEpoch, untilTime: exit.untilTime };
    });
}

/** Whether an exit may take a line at all. */
export const exitable = (line: Pick<ExitLine, 'can'>): boolean => line.can !== 'no';

/** The person's choice over the exit: the lines switched off. Everything an exit can take is on until then. */
export type ExitChoice = readonly string[];

/**
 * The lines in the package. `only` null — the panel is about everything: every line an exit can take is on until
 * switched off. `only` given — the panel was opened from a row: just the lines named are on, so a position that
 * appears with a later read of the wallet is never switched on by itself.
 */
export function exitPicked(lines: readonly ExitLine[], off: ExitChoice, only: readonly string[] | null = null): ExitLine[] {
  return lines.filter((line) => exitable(line) && !off.includes(line.id) && (only === null || only.includes(line.id)));
}

/** The pools with fees to collect, as the lines of the «Collect fees» panel: each is taken whole. */
export function collectLines(groups: readonly Group[]): ExitLine[] {
  return collectable(groups).rows.map((row) => ({ id: row.id, row, can: 'now' as const, reason: null, partPct: 100, untilEpoch: null, untilTime: null }));
}

/** The coin an exit leaves into, in the engine's own words: `SPLIT` is half SOL, half USDC. */
export type ExitTarget = 'SOL' | 'USDC' | 'SPLIT';
export const EXIT_TARGETS: readonly ExitTarget[] = ['SOL', 'USDC', 'SPLIT'];

export type Receive = Readonly<{ sol: number | null; usdc: number | null }>;

/**
 * What the picked lines bring now in the coin the person chose, before the engine built anything: their worth at the
 * prices read now, the part one step takes — an estimate, said with «≈». Null — nothing picked has a price.
 */
export function exitEstimate(picked: readonly ExitLine[], target: ExitTarget, solUsd: number | null): Receive | null {
  const priced = picked.filter((line) => line.row.usd !== null);
  if (!priced.length) return null;
  // A locked part comes at its share; a stake that only starts to leave brings nothing now.
  const usd = priced.reduce((sum, line) => sum + (line.row.usd as number) * (line.can === 'part' ? line.partPct / 100 : line.can === 'later' ? 0 : 1), 0);
  const sol = solUsd !== null && solUsd > 0 ? usd / solUsd : null;
  if (target === 'USDC') return { sol: null, usdc: usd };
  if (target === 'SOL') return sol === null ? null : { sol, usdc: null };
  return sol === null ? null : { sol: sol / 2, usdc: usd / 2 };
}

export type ActionId = 'collect' | 'exit' | 'clean';
export type Primary = ActionId | 'connect' | 'topUp';

/**
 * The screen's one amber action — the one that gives this person the most now. A wallet that is only looked at: to
 * connect it. Its own: the bigger of the fees to collect and what a clean gives back; with neither, to top up. An exit
 * is never pressed on anyone: it turns amber only on its own panel.
 */
export function primaryOf(input: Readonly<{ own: boolean; collectUsd: number | null; cleanUsd: number | null }>): Primary {
  if (!input.own) return 'connect';
  const collect = input.collectUsd !== null && input.collectUsd >= 0.01 ? input.collectUsd : null;
  const clean = input.cleanUsd !== null && input.cleanUsd > 0 ? input.cleanUsd : null;
  if (collect === null && clean === null) return 'topUp';
  if (collect !== null && clean !== null) return collect >= clean ? 'collect' : 'clean';
  return collect !== null ? 'collect' : 'clean';
}

/* ── a source that did not answer ─────────────────────────────────────── */

/**
 * Whether the total is the whole of it: every source the engine reads answered now, SOL has a price, and everything
 * that works — pools, staking, deposits and loans — is priced. A coin nobody prices is listed as it is, «No price»: it
 * does not make the whole wallet's total «so far».
 */
export function wholeOf(answer: Pick<Answer, 'sources' | 'solUsd'>, groups: readonly Group[]): boolean {
  if (partial(answer) || answer.solUsd === null) return false;
  return groups.filter((group) => group.id === 'pools' || group.id === 'staking' || group.id === 'lending').every((group) => group.rows.every((row) => row.usd !== null));
}

/** Whether anything shown is older than now, or missing: the screen then offers to read again. */
export function partial(answer: Pick<Answer, 'sources'>): boolean {
  return answer.sources.some((source) => source.source !== 'jupiter-portfolio' && (source.state === 'stale' || source.state === 'unread'));
}

export { NATIVE_SOL_MINT, USDC_MINT };
