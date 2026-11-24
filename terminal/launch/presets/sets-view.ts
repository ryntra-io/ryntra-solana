import type { LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import { setChanges, termsKey, type CurveSet, type SetField, type SetTerms } from '../../../lib/launch/presets-market/set.ts';
import type { CityPresetId } from '../../../city/lib/launch/gate.ts';

/**
 * «Start from a set» on the Launch form, as plain rules: which of the market's sets this form can launch, which
 * one it stands on now, and what a set changes from the launch the form opens with. The form's own presets are the
 * limit — a set never takes it anywhere the form could not go by itself, so nothing about the launch changes.
 */

/** The presets the form may take, each as the engine serves it here; null — not served, or not the form's to take. */
export type Reachable = Readonly<Partial<Record<CityPresetId, LaunchPresetView | null>>>;

/** How many sets the form offers at once. */
export const SETS_SHOWN = 6;

/** A served preset's five numbers, as a set carries them; null for a preset the form does not launch on. */
export function termsOfView(view: Pick<LaunchPresetView, 'id' | 'startMarketCapUsd' | 'graduationMarketCapUsd' | 'sniperFee' | 'creatorTradingFeePct'> | null): SetTerms | null {
  if (!view || (view.id !== 'classic' && view.id !== 'protected')) return null;
  return {
    curve: view.id,
    startMarketCapUsd: view.startMarketCapUsd,
    graduationMarketCapUsd: view.graduationMarketCapUsd,
    sniperFee: { startBps: view.sniperFee.startBps, endBps: view.sniperFee.endBps, seconds: view.sniperFee.seconds },
    creatorTradingFeePct: view.creatorTradingFeePct,
  };
}

/** The form's preset a set takes it to — the preset served here with exactly the set's numbers; null — not here. */
export function presetOfSet(set: Pick<CurveSet, 'terms'>, reachable: Reachable): CityPresetId | null {
  const curve = set.terms.curve;
  if (curve !== 'classic' && curve !== 'protected') return null;
  const served = termsOfView(reachable[curve] ?? null);
  return served && termsKey(served) === termsKey(set.terms) ? curve : null;
}

/** The sets this form can start from, in the market's order (the most used first), at most `max`. */
export function setsHere(sets: readonly CurveSet[], reachable: Reachable, max: number = SETS_SHOWN): readonly CurveSet[] {
  return sets.filter((set) => presetOfSet(set, reachable) !== null).slice(0, Math.max(0, max));
}

/**
 * Which presets the form may take: both of the city's where its shield switch is offered, else only the one it stands
 * on — exactly the choices the form itself gives.
 */
export function reachableOf(served: Readonly<Record<CityPresetId, LaunchPresetView | null>>, current: LaunchPresetView | null, switchable: boolean): Reachable {
  if (switchable) return served;
  if (current && (current.id === 'classic' || current.id === 'protected')) return { [current.id]: current };
  return {};
}

/** The set the form stands on: the one applied, while the form's numbers are still the set's. */
export function appliedHere<T extends Pick<CurveSet, 'terms'>>(applied: T | null, current: LaunchPresetView | null): T | null {
  const now = termsOfView(current);
  return applied && now && termsKey(now) === termsKey(applied.terms) ? applied : null;
}

export type Figures = Readonly<{ usd: (value: number) => string; pct: (bps: number) => string; span: (seconds: number) => string }>;

/** What the first buyers pay under a set: where the fee starts and how long it falls — «50% · 10 min». */
export function sniperText(terms: SetTerms, f: Figures): string {
  return `${f.pct(terms.sniperFee.startBps)} · ${f.span(terms.sniperFee.seconds)}`;
}

/** One number of a set as the form says it. */
export function fieldText(field: SetField, terms: SetTerms, f: Figures): string {
  if (field === 'start') return f.usd(terms.startMarketCapUsd);
  if (field === 'graduation') return f.usd(terms.graduationMarketCapUsd);
  if (field === 'sniper') return sniperText(terms, f);
  return f.pct(terms.creatorTradingFeePct * 100);
}

export type ChangeRow = Readonly<{ field: SetField; from: string; to: string }>;

/** What a set changes from the launch the form opens with, each number from and to; empty — the same launch. */
export function changeRows(terms: SetTerms, base: SetTerms | null, f: Figures): readonly ChangeRow[] {
  if (!base) return [];
  return setChanges(terms, base).map((field) => ({ field, from: fieldText(field, base, f), to: fieldText(field, terms, f) }));
}

/** A set's name in the person's language: Ryntra's own in both, a creator's as it was saved. */
export const setName = (set: Pick<CurveSet, 'name' | 'names'>, lang: 'en' | 'uk'): string => set.names?.[lang] ?? set.name;
