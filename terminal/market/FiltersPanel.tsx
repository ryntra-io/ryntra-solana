'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import type { DepthCoin, DepthWindow } from '@/lib/market-depth/model';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Icon, Quiet, Segment, SwitchRow } from '@/terminal/ui';
import { AGES, DEFAULT_FILTERS, VENUES, depthRows, readSum, sumField, type AgeBound, type Filters, type Range, type Sort, type Venue } from './depth-view';
import { DEPTH } from './depth-words';
import d from './depth.module.css';

type W = (typeof DEPTH)['en'];

const AGE_WORD: Readonly<Record<AgeBound, keyof W>> = { any: 'ageAny', '1h': 'age1h', '24h': 'age1d', '7d': 'age7d' };
const VENUE_WORD: Readonly<Record<Venue, string | null>> = { all: null, ryntra: 'Ryntra', pump: 'pump', 'meteora-dbc': 'Meteora', launchlab: 'LaunchLab' };

/** A sum's field: what is typed stays as typed; a sum that does not read marks the field and holds the panel's «Show». */
function SumField({ prefix, value, onChange, placeholder, label }: { prefix: string; value: string; onChange: (text: string) => void; placeholder: string; label: string }) {
  const bad = readSum(value) === undefined;
  return (
    <label className={d.field} data-bad={bad ? '' : undefined}>
      <span className={d.fieldWord}>{prefix}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode="decimal" autoComplete="off" aria-label={label} aria-invalid={bad || undefined} />
    </label>
  );
}

type Draft = { liqMin: string; liqMax: string; capMin: string; capMax: string; volume: string; holders: string; age: AgeBound; venue: Venue; hideRisky: boolean; verified: boolean };

const draftOf = (f: Filters): Draft => ({
  liqMin: sumField(f.liquidity.min),
  liqMax: sumField(f.liquidity.max),
  capMin: sumField(f.mcap.min),
  capMax: sumField(f.mcap.max),
  volume: sumField(f.volume),
  holders: f.holders === null ? '' : String(f.holders),
  age: f.age,
  venue: f.venue,
  hideRisky: f.hideRisky,
  verified: f.verified,
});

/** The filters a draft says, or null while a field does not read. */
function filtersOf(draft: Draft): Filters | null {
  const sums = [draft.liqMin, draft.liqMax, draft.capMin, draft.capMax, draft.volume, draft.holders].map(readSum);
  if (sums.some((sum) => sum === undefined)) return null;
  const [liqMin, liqMax, capMin, capMax, volume, holders] = sums as (number | null)[];
  if ((liqMin !== null && liqMax !== null && liqMin > liqMax) || (capMin !== null && capMax !== null && capMin > capMax)) return null;
  const range = (min: number | null, max: number | null): Range => ({ min, max });
  return { liquidity: range(liqMin!, liqMax!), mcap: range(capMin!, capMax!), volume: volume!, holders: holders!, age: draft.age, venue: draft.venue, hideRisky: draft.hideRisky, verified: draft.verified };
}

/**
 * «Filters» (decision 109, macket `Filters.dc.html`): liquidity and market cap from — to, volume and holders
 * from, the coin's age, where it was launched, «Hide risky» (on by default) and «Verified only» (off). The panel edits
 * a draft; «Show N coins» counts the list on screen with it and applies it; «Reset» goes back to the defaults.
 */
export function FiltersPanel({
  filters,
  coins,
  win,
  sort,
  now,
  ryntra,
  onApply,
  onClose,
}: {
  filters: Filters;
  coins: readonly DepthCoin[];
  /** The window the table reads its moves and volume over. */
  win: DepthWindow;
  sort: Sort;
  now: number;
  ryntra: ReadonlySet<string>;
  onApply: (filters: Filters) => void;
  onClose: () => void;
}) {
  const w = useWords(DEPTH);
  const narrow = useNarrow();
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  const set = (patch: Partial<Draft>) => setDraft((was) => ({ ...was, ...patch }));
  const next = filtersOf(draft);
  const count = useMemo(() => (next ? depthRows(coins, { filters: next, window: win, sort, query: '', now, ryntra }).length : null), [next, coins, win, sort, now, ryntra]);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onClose = () => close.current();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target) || target?.closest?.('[data-filters-open]')) return;
      onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', outside);
    };
  }, []);

  return (
    <div ref={box} className={d.filters} data-sheet={narrow ? '' : undefined} role="dialog" aria-modal={narrow || undefined} aria-label={w.filters}>
      <div className={d.filtersHead}>
        <b>{w.filters}</b>
        <button type="button" className={d.popClose} aria-label={w.close} onClick={onClose}>
          <Icon name="close" size="s" />
        </button>
      </div>
      <div className={d.filtersBody}>
        <div className={d.group}>
          <span className={d.groupWord}>{w.liquidity}</span>
          <div className={d.pair}>
            <SumField prefix={w.from} value={draft.liqMin} onChange={(liqMin) => set({ liqMin })} placeholder={w.anyF} label={`${w.liquidity} ${w.from}`} />
            <SumField prefix={w.to} value={draft.liqMax} onChange={(liqMax) => set({ liqMax })} placeholder={w.anyF} label={`${w.liquidity} ${w.to}`} />
          </div>
        </div>
        <div className={d.group}>
          <span className={d.groupWord}>{w.mcapFull}</span>
          <div className={d.pair}>
            <SumField prefix={w.from} value={draft.capMin} onChange={(capMin) => set({ capMin })} placeholder={w.anyF} label={`${w.mcapFull} ${w.from}`} />
            <SumField prefix={w.to} value={draft.capMax} onChange={(capMax) => set({ capMax })} placeholder={w.anyF} label={`${w.mcapFull} ${w.to}`} />
          </div>
        </div>
        <div className={d.group}>
          <span className={d.groupWord}>{w.volumeHolders}</span>
          <div className={d.pair}>
            <SumField prefix={w.volumeFrom} value={draft.volume} onChange={(volume) => set({ volume })} placeholder={w.anyF} label={w.volumeFrom} />
            <SumField prefix={w.holdersFrom} value={draft.holders} onChange={(holders) => set({ holders })} placeholder="0" label={w.holdersFrom} />
          </div>
        </div>
        <div className={d.group}>
          <span className={d.groupWord}>{w.ageCoin}</span>
          <Segment className={d.ageSeg} label={w.ageCoin} value={draft.age} onChange={(age) => set({ age })} items={AGES.map((id) => ({ id, label: w[AGE_WORD[id]] as string }))} />
        </div>
        <div className={d.group}>
          <span className={d.groupWord}>{w.where}</span>
          <div className={d.venues} role="radiogroup" aria-label={w.where}>
            {VENUES.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={draft.venue === id} className={d.venue} onClick={() => set({ venue: id })}>
                {VENUE_WORD[id] ?? w.venueAll}
              </button>
            ))}
          </div>
        </div>
        <div className={d.switches}>
          <SwitchRow label={w.hideRisky} on={draft.hideRisky} onChange={(hideRisky) => set({ hideRisky })} />
          <SwitchRow label={w.verifiedOnly} on={draft.verified} onChange={(verified) => set({ verified })} />
        </div>
      </div>
      <div className={d.filtersFoot}>
        <Quiet onClick={() => setDraft(draftOf(DEFAULT_FILTERS))}>{w.reset}</Quiet>
        <button type="button" className={d.showBtn} disabled={!next} onClick={() => next && onApply(next)}>
          {count === null ? w.filters : w.showCoins(count)}
        </button>
      </div>
    </div>
  );
}
