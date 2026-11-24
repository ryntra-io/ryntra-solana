'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { privateNetwork } from '@/lib/privacy/network';
import { Switch, cx } from '@/terminal/ui';
import { PRIVATE_INVOICE_WORDS } from './words';
import p from './private-invoices.module.css';

export type InvoiceMode = 'open' | 'private';

/** The choice is remembered in this browser — a convenience only: it holds no secret and nothing of an invoice. */
const KEY = 'ryntra.money.invoices.mode';

function remembered(): InvoiceMode {
  try {
    return window.localStorage.getItem(KEY) === 'private' ? 'private' : 'open';
  } catch {
    return 'open';
  }
}

/**
 * «Invoices» open or private. Only with the private balance open (`NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`):
 * without it the switch is not drawn and the mode is always open — «Invoices» as it was.
 * Until then this one stands in the page's head.
 */
export function useInvoiceMode(): Readonly<{ shown: boolean; mode: InvoiceMode; set: (mode: InvoiceMode) => void }> {
  const shown = privateNetwork() !== null;
  const [mode, setMode] = useState<InvoiceMode>('open');
  // Read after the first paint: the server draws «Open», the browser then takes the person's own choice.
  useEffect(() => {
    if (shown) setMode(remembered());
  }, [shown]);
  const set = useCallback((next: InvoiceMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* the choice holds for this visit only */
    }
  }, []);
  return { shown, mode: shown ? mode : 'open', set };
}

/**
 * «Open ⇄ Private»: the kit's switch between its two words, the word in force lit. On a desk it stands in the page's
 * head; a phone's head has no room for it (the kit hides the head's mark there), so `phone` stands it in its own row
 * above the panel — shown on a phone only.
 */
export function ModeSwitch({ mode, onChange, phone = false }: { mode: InvoiceMode; onChange: (mode: InvoiceMode) => void; phone?: boolean }) {
  const w = useWords(PRIVATE_INVOICE_WORDS);
  const on = mode === 'private';
  return (
    <div className={cx(p.mode, phone && p.modePhone)} data-invoice-mode={mode} data-invoice-mode-at={phone ? 'phone' : 'head'}>
      <button type="button" className={cx(p.modeWord, !on && p.modeOn)} onClick={() => onChange('open')} aria-pressed={!on}>
        {w.open}
      </button>
      <Switch on={on} onChange={(next) => onChange(next ? 'private' : 'open')} label={w.mode} />
      <button type="button" className={cx(p.modeWord, on && p.modePrivate)} onClick={() => onChange('private')} aria-pressed={on}>
        {w.private}
      </button>
    </div>
  );
}
