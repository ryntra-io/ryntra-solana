'use client';

import type { ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLaunch } from '@/city/lib/launch/district';
import { PAYOUTS } from '@/city/lib/partners/facts';
import { PARTNER_TERMS } from '@/city/lib/partners/terms';
import { usePartners } from '@/city/lib/partners/store';
import s from './partners.module.css';
import { PARTNERS } from './words';

/** The partner window's small shared pieces: the stills, «i», the status pill, the demo mark, the slider. */

export function artOf(name: string): { src: string; srcSet: string } {
  const wide = name === 'scouts' ? 1440 : 1600;
  return { src: `/city/art/${name}-800.webp`, srcSet: `/city/art/${name}-800.webp 800w, /city/art/${name}-${wide}.webp ${wide}w` };
}

/** The fixed mark over demo figures: it never scrolls away. */
export function Demo({ text }: { text: string }) {
  return (
    <div className={s.demo} aria-label={text}>
      <span className={s.display}>{text}</span>
    </div>
  );
}

/** «i»: one quiet button, the details open under it and close again. */
export function Info({ open, label, onToggle, className }: { open: boolean; label: string; onToggle: () => void; className?: string }) {
  return (
    <button type="button" className={`${s.info} ${open ? s.infoOn : ''} ${className ?? ''}`} aria-label={label} aria-expanded={open} onClick={onToggle}>
      i
    </button>
  );
}

/** Where payouts stand: counted from today and paid weekly in USDC once the weekly pass runs (CITY-128). */
export function Status({ open = PAYOUTS === 'open', weekly = false }: { open?: boolean; weekly?: boolean }) {
  const w = useWords(PARTNERS);
  return (
    <span className={`${s.pill} ${open || weekly ? s.pillLive : s.pillCounted}`}>
      <span className={s.pulse} aria-hidden="true" />
      {weekly ? w.weekly(PARTNER_TERMS.payoutAsset ?? 'USDC') : open ? w.open : w.counting}
    </span>
  );
}

/** Where each still keeps its towers, when the frame crops it. */
const FOCUS: Readonly<Record<string, string>> = { scouts: '50% 80%', 'exchange-invite': '50% 40%' };

export function Still({ name, children, tall }: { name: string; children?: ReactNode; tall?: boolean }) {
  const art = artOf(name);
  return (
    <div className={`${s.hero} ${tall ? s.heroTall : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={name} className={s.art} src={art.src} srcSet={art.srcSet} sizes="(min-width: 900px) 560px, 100vw" alt="" decoding="async" style={FOCUS[name] ? { objectPosition: FOCUS[name] } : undefined} />
      <div className={s.heroBody}>{children}</div>
    </div>
  );
}

const STEPS = 1000;

export function Slider({ label, value, position, onChange }: { label: string; value: string; position: number; onChange: (t: number) => void }) {
  const at = Math.round(Math.min(1, Math.max(0, position)) * STEPS);
  return (
    <label className={s.field}>
      <span className={s.fieldHead}>
        <span className={s.fieldLabel}>{label}</span>
        <b className={s.fieldValue}>{value}</b>
      </span>
      <input
        type="range"
        className={s.range}
        min={0}
        max={STEPS}
        step={1}
        value={at}
        style={{ ['--at' as string]: `${(at / STEPS) * 100}%` }}
        onChange={(event) => onChange(Number(event.target.value) / STEPS)}
      />
    </label>
  );
}

/** «Запустити монету» from the creator's tab: the Launch docks' own sheet, over the city. */
export function openLaunchSheet(): void {
  usePartners.getState().close();
  useLaunch.getState().openSheet();
}

