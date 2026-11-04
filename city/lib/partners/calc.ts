import { OFFER, receivedPer1000, type MixId, type Offer } from './facts.ts';

/**
 * The referrer's calculator (CITY-126): what twelve months of brought people could pay, on the operator's terms
 * (decision 93, `lib/decks/partner-terms.ts`). A model, not a promise — the person's own guesses in, the terms and the
 * fee policy's rates through it:
 *
 * - the first cohort is the audience × the share who trades; every later month a new cohort of `GROWTH` of that first
 *   one joins (word of mouth), and every cohort keeps `retention` of its traders from one month to the next;
 * - each active person trades `volume` a month; Ryntra's fee on it is the mix's, less the person's discount — what
 *   Ryntra receives (`receivedPer1000`);
 * - the partner's share is the first share for each person's first days (90 days: their first three months), then the
 *   share after, for good — one level, no ranks;
 * - the discount is what the people the partner brought kept.
 *
 * Pure: numbers in, numbers out.
 */

export const MONTHS = 12;
/** A later month's new cohort, as a share of the first. The model's own guess, said behind «i». */
export const GROWTH = 0.15;
const DAYS_A_MONTH = 30;

export type CalcInput = Readonly<{
  /** People who see the partner's link. */
  audience: number;
  /** The partner's own guess of who of them trades, per cent. */
  sharePct: number;
  /** What an active person trades a month, dollars. */
  volumeUsd: number;
  mix: MixId;
  /** People who keep trading from one month to the next, per cent. */
  retentionPct: number;
}>;

export type CalcMonth = Readonly<{
  month: number;
  /** People trading this month. */
  active: number;
  /** Ryntra's received fee on their trades this month. */
  received: number;
  /** What the partner earns this month. */
  partner: number;
  /** What the brought people kept this month by their discount. */
  saved: number;
  /** True while the first cohort is still in its first days: the month is paid at the first share. */
  first: boolean;
}>;

export type CalcResult = Readonly<{
  months: readonly CalcMonth[];
  month12: number;
  year: number;
  saved: number;
  /** Ryntra's received fee per active person a month. */
  perPerson: number;
  perThousand: number;
}>;

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);

export const DEFAULT_INPUT: CalcInput = { audience: 10_000, sharePct: 2, volumeUsd: 2_000, mix: 'mixed', retentionPct: 70 };

export function calculate(input: CalcInput, offer: Offer | null = OFFER): CalcResult {
  const audience = clamp(input.audience, 0, 100_000_000);
  const share = clamp(input.sharePct, 0, 100) / 100;
  const volume = clamp(input.volumeUsd, 0, 100_000_000);
  const keep = clamp(input.retentionPct, 0, 100) / 100;
  const perThousand = receivedPer1000(input.mix, offer);
  const perPerson = (volume / 1_000) * perThousand;
  const discount = offer ? offer.discountPercent / 100 : 0;
  // What a person kept a month: the discount's part of the full fee, of which Ryntra received the rest.
  const keptPerPerson = discount > 0 && discount < 1 ? (perPerson / (1 - discount)) * discount : 0;
  const firstShare = offer ? offer.firstPercent / 100 : 0;
  const afterShare = offer ? offer.afterPercent / 100 : 0;
  const firstMonths = offer ? Math.max(1, Math.round(offer.firstDays / DAYS_A_MONTH)) : 0;

  const first = audience * share;
  const sizes = Array.from({ length: MONTHS }, (_, i) => (i === 0 ? first : first * GROWTH));

  const months: CalcMonth[] = [];
  for (let m = 1; m <= MONTHS; m += 1) {
    let active = 0;
    let received = 0;
    let partner = 0;
    let saved = 0;
    for (let c = 1; c <= m; c += 1) {
      const age = m - c + 1;
      const people = sizes[c - 1]! * keep ** (age - 1);
      if (people <= 0) continue;
      active += people;
      received += people * perPerson;
      saved += people * keptPerPerson;
      partner += people * perPerson * (age <= firstMonths ? firstShare : afterShare);
    }
    months.push({ month: m, active, received, partner, saved, first: m <= firstMonths });
  }
  return {
    months,
    month12: months[MONTHS - 1]!.partner,
    year: months.reduce((sum, month) => sum + month.partner, 0),
    saved: months.reduce((sum, month) => sum + month.saved, 0),
    perPerson,
    perThousand,
  };
}

/** A slider that moves on a log scale: 0…1 to `min`…`max`, rounded to two significant figures. */
export function logValue(t: number, min: number, max: number): number {
  const raw = Math.exp(Math.log(min) + clamp(t, 0, 1) * (Math.log(max) - Math.log(min)));
  const p = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / p) * p;
}

/** The slider position of `value` on the same log scale. */
export function logPosition(value: number, min: number, max: number): number {
  return clamp((Math.log(clamp(value, min, max)) - Math.log(min)) / (Math.log(max) - Math.log(min)), 0, 1);
}

/** Dollars as the calculator prints them, the English way (the window passes them through `digits`): `$0`, `$1,240`, `$12.4K`, `$1.2M`. */
export function usdShort(value: number): string {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (v >= 1_000_000) return `$${trim(v / 1_000_000)}M`;
  if (v >= 100_000) return `$${Math.round(v / 1_000)}K`;
  if (v >= 10_000) return `$${trim(v / 1_000)}K`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

const trim = (n: number) => String(Number(n.toFixed(1)));

/** A count as the inputs print it: `850`, `10K`, `1.2M`. */
export function countShort(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(Math.round(value));
}
