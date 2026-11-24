'use client';

import { useEffect, useId, useState } from 'react';

import { num, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { bandOf, type BandAction, type BandMode, type BandPart, type Shown, type Viewer } from '@/lib/privacy/exposure';
import type { RingCount } from '@/lib/privacy/ring-count';
import { Icon } from './icons';
import { Info } from './Info';
import { privateModeOpen } from './PrivacyToggle';
import { PRIVATE_KIT } from './words';
import p from './private.module.css';

type Words = (typeof PRIVATE_KIT)['en'];

const PART_WORD: Readonly<Record<BandPart, keyof Words>> = { who: 'who', to: 'to', what: 'what', amount: 'amount' };
const VIEWER_WORD: Readonly<Record<Viewer, keyof Words>> = { everyone: 'everyone', viewers: 'viewers', prover: 'prover' };

function Said({ shown, w }: { shown: Shown; w: Words }) {
  return (
    <span className={p.said} data-shown={shown}>
      <Icon name={shown === 'hidden' ? 'eyeOff' : 'eye'} size="s" />
      {shown === 'hidden' ? w.hidden : w.seen}
    </span>
  );
}

/* ── the counter ────────────────────────────────────────────────────────── */

const COUNT_KEEP_MS = 60_000;
let countKept: Readonly<{ at: number; count: RingCount | null }> | null = null;
let countFlight: Promise<RingCount | null> | null = null;

/** The ring's counter from its one door, read once a minute at most for the whole page; null when it did not answer. */
export function readPrivacyCount(): Promise<RingCount | null> {
  if (countKept && Date.now() - countKept.at < COUNT_KEEP_MS) return Promise.resolve(countKept.count);
  if (countFlight) return countFlight;
  countFlight = fetch('/api/v1/privacy/ring', { headers: { accept: 'application/json' } })
    .then(async (res) => (res.ok ? (((await res.json()) as { count?: RingCount }).count ?? null) : null))
    .catch(() => null)
    .then((count) => {
      countKept = { at: Date.now(), count };
      return count;
    })
    .finally(() => {
      countFlight = null;
    });
  return countFlight;
}

export type CountState = Readonly<{ state: 'reading' } | { state: 'read'; count: RingCount | null }>;

/** The counter as a screen holds it: reading, then the count or null. `given` holds it from outside (the kit's stand). */
export function usePrivacyCount(given?: CountState): CountState {
  const [read, setRead] = useState<CountState>(() => (countKept ? { state: 'read', count: countKept.count } : { state: 'reading' }));
  useEffect(() => {
    if (given) return;
    let live = true;
    void readPrivacyCount().then((count) => {
      if (live) setRead({ state: 'read', count });
    });
    return () => {
      live = false;
    };
  }, [given]);
  return given ?? read;
}

/**
 * What the «i» of the band says: the SOL in the ring and the private balances now, and the honest lines — the fewer
 * people, the easier to guess; in and out are seen; who computes the proof. No promise. Read when the «i» opens.
 */
export function PrivacyCount({ given }: { given?: CountState }) {
  const w = useWords(PRIVATE_KIT);
  const lang = useLang();
  const now = usePrivacyCount(given);
  const count = now.state === 'read' ? now.count : null;
  const sol = count?.lamports != null ? num(Number(count.lamports) / 1e9, { maximumFractionDigits: 2 }, lang) : null;
  return (
    <span className={p.count} data-private-count={now.state === 'reading' ? 'reading' : count ? 'read' : 'none'}>
      <span className={p.countHead}>
        <span>{w.countTitle}</span>
        <span>{w.countTest}</span>
      </span>
      {now.state === 'reading' ? <span className={p.countBone} aria-hidden="true" /> : <span className={p.countFig}>{sol ? w.countSol(sol) : w.countNone}</span>}
      <span className={p.countSub}>{count?.balances != null ? w.countPeople(count.balances) : null}</span>
      <span className={p.countLine}>{w.countHonest}</span>
      <span className={p.countLine}>{w.countEdge}</span>
      <span className={p.countLine}>{w.countProof}</span>
    </span>
  );
}

/** The «i» with the counter, for wherever a private screen wants it (the band carries one). */
export function PrivacyInfo({ given }: { given?: CountState }) {
  const w = useWords(PRIVATE_KIT);
  return (
    <Info label={w.infoLabel}>
      <PrivacyCount given={given} />
    </Info>
  );
}

/* ── the band ──────────────────────────────────────────────────────────── */

/**
 * The band «others see», before every private signature: four cells — who, to whom, what, how much — each «seen» or
 * «hidden», from `bandOf` (`lib/privacy/exposure.ts`). In the private mode a quiet «Who sees what» opens the same four
 * for each of three viewers — everyone, whoever you share a view with, the proof server — and the «i» opens the ring's
 * counter. In the public mode it says what plain Solana shows: everything. Stands in the action panel above the amber
 * button; two by two on a phone. Hidden in a build without the private mode.
 */
export function PrivacyBand({ action, mode = 'private', expanded = false, count }: { action: BandAction; mode?: BandMode; expanded?: boolean; count?: CountState }) {
  const w = useWords(PRIVATE_KIT);
  const [open, setOpen] = useState(expanded);
  const id = useId();
  if (!privateModeOpen()) return null;
  const band = bandOf(action, mode);
  const more = band.rows.length > 1;
  return (
    <section className={p.band} aria-label={w.band} data-private-band={action} data-mode={band.mode}>
      <div className={p.bandHead}>
        <span>{w.band}</span>
        <span className={p.bandGrow} />
        {more ? (
          <button type="button" className={p.more} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
            <span>{w.whoElse}</span>
            <Icon name="chevron" size="s" className={p.moreMark} />
          </button>
        ) : null}
        {more ? <PrivacyInfo given={count} /> : null}
      </div>
      <div className={p.strip}>
        {band.cells.map(({ part, shown }) => (
          <div key={part} className={p.cell}>
            <span className={p.cellName}>{w[PART_WORD[part]] as string}</span>
            <Said shown={shown} w={w} />
          </div>
        ))}
      </div>
      {more && open ? (
        <table id={id} className={p.viewers}>
          <thead>
            <tr>
              <th scope="col">
                <span className={p.unseen}>{w.whoElse}</span>
              </th>
              {band.cells.map(({ part }) => (
                <th key={part} scope="col">
                  {w[PART_WORD[part]] as string}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {band.rows.map(({ viewer, cells }) => (
              <tr key={viewer}>
                <th scope="row">{w[VIEWER_WORD[viewer]] as string}</th>
                {cells.map(({ part, shown }) => (
                  <td key={part} data-shown={shown}>
                    <Icon name={shown === 'hidden' ? 'eyeOff' : 'eye'} size="s" />
                    <span className={p.unseen}>{shown === 'hidden' ? w.hidden : w.seen}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
