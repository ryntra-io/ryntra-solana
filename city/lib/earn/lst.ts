/**
 * The SOL Saver's three liquid-staking tokens (CITY-94) and the arithmetic that keeps every figure in SOL: what one
 * token is worth in SOL, what a balance is worth, and the yield of the last epoch as a year's rate. Pure: the page,
 * the server's feed and the tests import it alike. Nothing here invents a figure — a rate that was not read is null,
 * and a null is hidden on the screen, never drawn as a zero.
 */

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export type LstId = 'jupsol' | 'inf' | 'jitosol';

export type Lst = Readonly<{
  id: LstId;
  symbol: string;
  mint: string;
  decimals: number;
  /** Whose staking it is, as the token's own maker names it. */
  maker: string;
  /**
   * Where its worth in SOL is read: an SPL stake pool account on chain (its total lamports over its token supply, and
   * the same two figures from the epoch before), or Sanctum's public figures for Infinity, which is a pool of LSTs
   * rather than a stake pool.
   */
  source: Readonly<{ kind: 'stake-pool'; pool: string }> | Readonly<{ kind: 'sanctum' }>;
}>;

export const LSTS: readonly Lst[] = [
  { id: 'jupsol', symbol: 'JupSOL', mint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', decimals: 9, maker: 'Jupiter', source: { kind: 'stake-pool', pool: '8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr' } },
  { id: 'inf', symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', decimals: 9, maker: 'Sanctum', source: { kind: 'sanctum' } },
  { id: 'jitosol', symbol: 'JitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9, maker: 'Jito', source: { kind: 'stake-pool', pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb' } },
];

export const LST_BY_MINT: ReadonlyMap<string, Lst> = new Map(LSTS.map((lst) => [lst.mint, lst]));

export function lstOf(id: string): Lst | null {
  return LSTS.find((lst) => lst.id === id) ?? null;
}

/**
 * What a token is worth in SOL, as two whole numbers so no float rounds it: `lamports` for every `supply` base units.
 * A stake pool states it as its total lamports over its token supply; Sanctum as the lamports one whole token is
 * worth (`supply` = 10^decimals).
 */
export type SolRate = Readonly<{ lamports: string; supply: string }>;

const DIGITS = /^\d{1,30}$/;

export function rateOf(lamports: bigint | string, supply: bigint | string): SolRate | null {
  const l = typeof lamports === 'bigint' ? lamports : DIGITS.test(lamports) ? BigInt(lamports) : -1n;
  const s = typeof supply === 'bigint' ? supply : DIGITS.test(supply) ? BigInt(supply) : -1n;
  if (l <= 0n || s <= 0n) return null;
  return { lamports: l.toString(), supply: s.toString() };
}

/** A balance of the token in lamports of SOL, rounded down; null for a malformed balance or no rate. */
export function lamportsOf(raw: bigint | string, rate: SolRate | null): bigint | null {
  if (!rate) return null;
  const amount = typeof raw === 'bigint' ? raw : DIGITS.test(raw) ? BigInt(raw) : null;
  if (amount === null || amount < 0n) return null;
  return (amount * BigInt(rate.lamports)) / BigInt(rate.supply);
}

/** SOL for one whole token, for reading only (1.0821 SOL). */
export function solPerToken(rate: SolRate | null, decimals = 9): number | null {
  if (!rate) return null;
  const value = (Number(rate.lamports) / Number(rate.supply)) * 10 ** decimals / 1e9;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The epochs in a year at the slot time the network actually kept lately. Null without a measured slot time. */
export function epochsPerYear(slotsPerEpoch: number, slotMs: number | null): number | null {
  if (!Number.isFinite(slotsPerEpoch) || slotsPerEpoch <= 0 || slotMs === null || !Number.isFinite(slotMs) || slotMs < 200 || slotMs > 2_000) return null;
  return (365.25 * 24 * 3_600_000) / (slotsPerEpoch * slotMs);
}

/** The largest change in a token's worth over one epoch that is still a yield and not a broken read: 1 %. */
const MAX_EPOCH_MOVE = 0.01;

/**
 * The yield of the last epoch as a year's rate, per cent: the token's worth in SOL now against the same at the epoch
 * before, compounded over the epochs of a year. A loss (a slashing) is a negative rate, said as it is. Null when
 * either side is missing or the move is past what an epoch of staking can be.
 */
export function epochApyPercent(now: SolRate | null, before: SolRate | null, perYear: number | null): number | null {
  if (!now || !before || perYear === null) return null;
  const a = Number(now.lamports) / Number(now.supply);
  const b = Number(before.lamports) / Number(before.supply);
  if (!(a > 0) || !(b > 0)) return null;
  const move = a / b - 1;
  if (!Number.isFinite(move) || Math.abs(move) > MAX_EPOCH_MOVE) return null;
  const apy = (Math.pow(1 + move, perYear) - 1) * 100;
  return Number.isFinite(apy) ? apy : null;
}

/** Lamports as SOL text: 1.2345 SOL, small sums with their significant digits, a sign when asked. */
export function solText(lamports: bigint | null, signed = false): string {
  if (lamports === null) return '—';
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const value = Number(abs) / 1e9;
  const digits = value === 0 ? 0 : value >= 100 ? 2 : value >= 1 ? 4 : value >= 0.001 ? 5 : 7;
  const body = value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const sign = negative ? '−' : signed && abs > 0n ? '+' : '';
  return `${sign}${body}`;
}

/** A rate as the card writes it: 6.2 %. */
export function percentText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  return `${value < 0 ? '−' : ''}${abs.toFixed(abs >= 10 ? 1 : 2).replace(/\.?0+$/, '')}%`;
}
