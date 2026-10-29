import { roundLine, sanitizeCondition, type BeaconCondition, type BeaconKind, type MovePeriod, type TowerRead } from '../../../lib/world/beacons/rules.ts';

/**
 * The beacon editor's field: what a person types for a line, read as a number. Dollars may carry `$`, commas and a
 * K, M or B; a move may carry `%` and a minus of either kind.
 */

const SUFFIX: Readonly<Record<string, number>> = { k: 1e3, m: 1e6, b: 1e9 };

export function parseLine(text: string): number | null {
  const clean = text.trim().replace(/[$,\s%]/g, '').replace(/[−–]/g, '-').toLowerCase();
  const match = /^(-?\d*\.?\d+)([kmb])?$/.exec(clean);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] ? SUFFIX[match[2]]! : 1);
  return Number.isFinite(value) ? value : null;
}

/** A line as the field shows it: plain digits, no grouping, no exponent. */
export function lineText(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1e-6 || value === 0) return String(Number(value.toPrecision(6)));
  return value.toFixed(12).replace(/0+$/, '');
}

/** What the tower reads now for one kind of condition. */
export function readFor(kind: BeaconKind, period: MovePeriod, tower: TowerRead): number {
  if (kind === 'price') return tower.price;
  if (kind === 'liquidity') return tower.liquidity;
  return period === '5m' ? tower.change5m : period === '1h' ? tower.change1h : tower.change24h;
}

/** A sensible line when a person switches kind: a little past where the tower stands, in the direction chosen. */
export function suggestLine(kind: BeaconKind, op: 'above' | 'below', period: MovePeriod, tower: TowerRead): number {
  if (kind === 'move') return op === 'above' ? 5 : -5;
  const now = readFor(kind, period, tower);
  return roundLine(now * (op === 'above' ? 1.05 : 0.95)) || 1;
}

/** The condition the fields make, or null while the line does not read. */
export function conditionOf(kind: BeaconKind, op: 'above' | 'below', period: MovePeriod, text: string): BeaconCondition | null {
  const value = parseLine(text);
  if (value === null) return null;
  return sanitizeCondition(kind === 'move' ? { kind, op, period, value } : { kind, op, value });
}
