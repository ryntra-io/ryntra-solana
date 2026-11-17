'use client';

import type { ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Icon } from '@/terminal/ui';
import { TICKET } from './words';
import s from './ticket.module.css';

/** A ticker as the terminal writes it: bare, without the `$` the trade logic writes. */
export const bare = (symbol: string): string => symbol.replace(/^\$+/, '');

/** An action's words longer than this step down a size, so they stay on one line in the ticket's width. */
export const LONG_LABEL = 16;

/** One wallet in this browser is asked straight away; several, or none, show the list. */
export function connectOrPick(showList: () => void): void {
  const { wallets, connect } = useWallet.getState();
  if (wallets.length === 1) void connect(wallets[0]!.name);
  else showList();
}

/**
 * The ticket's «i»: one quiet round control. What it explains opens inline under its line (`ExplainBox`), inside the
 * ticket — a floating panel would be cut by the panel's cut corner.
 */
export function ExplainButton({ label, open, controls, onToggle }: { label: string; open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button type="button" className={s.explain} aria-label={label} aria-expanded={open} aria-controls={open ? controls : undefined} onClick={onToggle}>
      <Icon name="info" size="s" />
    </button>
  );
}

/** What the «i» explains, read in place: opened, read, closed by the same control. */
export function ExplainBox({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} role="note" className={s.explainBox}>
      {children}
    </div>
  );
}

/** A short list of facts behind «i»: each a name and its value. */
export function Rows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <span className={s.rows}>
      {rows.map(([name, value]) => (
        <span key={name} className={s.rowsRow}>
          <span>{name}</span>
          <b>{value}</b>
        </span>
      ))}
    </span>
  );
}

/** A line to the transaction on the explorer. */
export function TxLink({ signature }: { signature: string }) {
  const w = useWords(TICKET);
  return (
    <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
      {w.transaction}
      <Icon name="arrow" size="s" />
    </a>
  );
}
