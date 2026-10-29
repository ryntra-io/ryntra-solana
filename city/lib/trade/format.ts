/**
 * How the trade card writes the engine's figures. Every figure arrives as raw units from the engine; this file only
 * places the point and shortens for the eye. A guaranteed minimum is always rounded down, so the card never promises
 * more than the chain will enforce.
 */

const SUFFIXES: readonly (readonly [bigint, string])[] = [
  [1_000_000_000n, 'B'],
  [1_000_000n, 'M'],
  [1_000n, 'K'],
];

/** Raw units as a short number: 276.9, 12.4K, 1.25M, 0.000041. `down` never rounds up. */
export function formatUnits(raw: string, decimals: number, round: 'down' | 'nearest' = 'nearest'): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) return '—';
  const value = BigInt(raw);
  if (value === 0n) return '0';
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  // Large figures carry a suffix and three significant digits; 1,000–9,999 stay whole.
  for (const [index, [size, suffix]] of SUFFIXES.entries()) {
    if (whole < (suffix === 'K' ? size * 10n : size)) continue;
    const digits = whole >= size * 100n ? 0 : whole >= size * 10n ? 1 : 2;
    const text = trim(scaled(value, unit * size, digits, round));
    // 999,999.6 rounds to 1000K: say 1M instead.
    const bigger = SUFFIXES[index - 1];
    if (bigger && Number(text) >= 1000) return trim(scaled(value, unit * bigger[0], 2, round)) + bigger[1];
    return text + suffix;
  }
  if (whole >= 1_000n) return group(scaled(value, unit, 0, round));
  if (whole >= 100n) return trim(scaled(value, unit, 1, round));
  if (whole >= 1n) return trim(scaled(value, unit, whole >= 10n ? 2 : 3, round));
  // Below one: four significant digits, never more places than the token has.
  const fraction = value.toString().padStart(decimals, '0');
  const lead = fraction.search(/[1-9]/);
  const places = Math.min(decimals, lead + 4);
  return trim(scaled(value, unit, places, round));
}

/** value / unit with `places` decimals, as a plain decimal string. */
function scaled(value: bigint, unit: bigint, places: number, round: 'down' | 'nearest'): string {
  const factor = 10n ** BigInt(places);
  const numerator = value * factor;
  let q = numerator / unit;
  if (round === 'nearest' && (numerator % unit) * 2n >= unit) q += 1n;
  const text = q.toString().padStart(places + 1, '0');
  return places ? `${text.slice(0, -places)}.${text.slice(-places)}` : text;
}

function trim(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function group(text: string): string {
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A rate in basis points as a person reads it: 100 → 1%, 50 → 0.5%, 25 → 0.25%. */
export function formatBps(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—';
  return `${Number((bps / 100).toFixed(2))}%`;
}

export type ImpactLevel = 'low' | 'notable' | 'high';

/**
 * The venue's price impact, which the engine passes on as a percent ("0.12" is 0.12 %). A move in the person's favour
 * costs nothing and reads as zero.
 */
export function formatImpact(pct: string | null | undefined): Readonly<{ text: string; level: ImpactLevel }> {
  const value = Math.abs(Number(pct));
  if (pct === null || pct === undefined || pct === '' || !Number.isFinite(value)) return { text: '—', level: 'low' };
  const level: ImpactLevel = value >= 5 ? 'high' : value >= 1 ? 'notable' : 'low';
  if (value < 0.01) return { text: '<0.01%', level };
  return { text: `${Number(value.toFixed(2))}%`, level };
}

/** The pools a route crosses, by the venue's own names, at most two named. */
export function formatRoute(hops: readonly Readonly<{ label: string }>[]): string {
  const labels = [...new Set(hops.map((hop) => hop.label.trim()).filter(Boolean))];
  if (!labels.length) return 'Jupiter';
  if (labels.length <= 2) return labels.join(' + ');
  return `${labels[0]} + ${labels.length - 1} more`;
}

/** A coin's ticker as the city writes it. */
export function ticker(symbol: string): string {
  return `$${symbol.replace(/^\$/, '')}`;
}

/** An address cut to its ends: 4EeX…PGW. */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
