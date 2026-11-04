'use client';

import { useId, useState, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { InfoGlyph } from './glyphs';
import { SETTINGS } from './words';
import s from './settings.module.css';

/** A section's head: its name, and «i» that opens its one paragraph of details — read, then closed. */
export function Head({ id: headId, title, info }: { id: string; title: string; info?: string | readonly string[] }) {
  const w = useWords(SETTINGS);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className={s.head}>
        <h3 className={s.title} id={headId}>
          {title}
        </h3>
        {info ? (
          <button type="button" className={`${s.info} ${open ? s.infoOn : ''}`} aria-label={w.details} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            <InfoGlyph />
          </button>
        ) : null}
      </div>
      {info && open ? (
        typeof info === 'string' ? (
          <p className={s.details} id={id}>
            {info}
          </p>
        ) : (
          <div id={id}>
            {info.map((paragraph) => (
              <p key={paragraph} className={s.details}>
                {paragraph}
              </p>
            ))}
          </div>
        )
      ) : null}
    </>
  );
}

/** One line: its name on the left, what it does on the right. */
export function Row({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel} id={id}>
        {label}
      </span>
      <span className={s.rowControl}>{children}</span>
    </div>
  );
}

export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className={s.switch} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <span className={s.knob} />
    </button>
  );
}

export type Choice<T extends string> = Readonly<{ id: T; label: string; disabled?: boolean; icon?: ReactNode }>;

/** One of a few, side by side. */
export function Segment<T extends string>({ value, choices, label, onChange }: { value: T; choices: readonly Choice<T>[]; label: string; onChange: (id: T) => void }) {
  return (
    <div className={s.segment} role="radiogroup" aria-label={label} style={{ ['--n' as string]: choices.length }}>
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          role="radio"
          aria-checked={value === choice.id}
          className={value === choice.id ? s.segmentOn : ''}
          disabled={choice.disabled}
          onClick={() => value !== choice.id && onChange(choice.id)}
        >
          {choice.icon}
          <span>{choice.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A quiet group label over a few rows. */
export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={s.group}>
      {label ? <div className={s.groupLabel}>{label}</div> : null}
      {children}
    </div>
  );
}
