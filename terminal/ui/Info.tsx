'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import s from './ui.module.css';

/**
 * The «i»: everything a screen explains — the fee's breakdown, how a thing works, where a figure comes from — behind
 * one quiet control. Opened, read, closed: a tap anywhere else or Escape closes it. With `word` the control says what
 * it opens beside the sign («How it works»).
 */
export function Info({ label, word, children }: { label: string; word?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      wrap.current?.querySelector('button')?.focus();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <span className={s.infoWrap} ref={wrap}>
      <button type="button" className={word ? `${s.info} ${s.infoWord}` : s.info} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
        <Icon name="info" size="s" />
        {word ? <span>{word}</span> : null}
      </button>
      {open ? (
        <span id={id} role="note" className={s.infoPop}>
          {children}
        </span>
      ) : null}
    </span>
  );
}
