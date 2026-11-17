'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useId } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/** A switch: on or off, at once, nothing to confirm. Name it with `label` or stand it in a `SwitchRow`. */
export function Switch({ on, onChange, label, labelledBy, disabled = false }: { on: boolean; onChange: (on: boolean) => void; label?: string; labelledBy?: string; disabled?: boolean }) {
  return <button type="button" role="switch" className={s.switch} aria-checked={on} aria-label={label} aria-labelledby={labelledBy} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** A switch with its words beside it: the whole row is its name. */
export function SwitchRow({ label, on, onChange, disabled = false }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={s.switchRow}>
      <span id={id}>{label}</span>
      <Switch on={on} onChange={onChange} labelledBy={id} disabled={disabled} />
    </div>
  );
}

/** A slider: an amber track over its range, the keyboard's arrows step it. */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, label, valueText }: { value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; label: string; valueText?: string }) {
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={s.slider}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ ['--fill' as string]: `${fill}%` } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

/** A chip: a short state beside a name. `ok` is mint (working, filled), `warn` amber (waiting); `dot` adds a light. */
export function Chip({ tone = 'plain', dot = false, children }: { tone?: 'plain' | 'ok' | 'warn'; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx(s.chip, tone === 'ok' && s.chipOk, tone === 'warn' && s.chipWarn)}>
      {dot ? <span className={s.chipDot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
