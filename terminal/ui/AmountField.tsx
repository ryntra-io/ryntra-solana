'use client';

import { useId } from 'react';
import { CoinLogo } from './CoinLogo';
import { Icon } from './icons';
import { Kick } from './Type';
import s from './ui.module.css';

/** What a person may type as an amount: digits and one decimal mark, a comma or a point, as their keyboard writes it. */
export function amountText(typed: string): string {
  const kept = typed.replace(/[^\d.,]/g, '');
  const mark = kept.search(/[.,]/);
  if (mark < 0) return kept;
  return `${kept.slice(0, mark + 1)}${kept.slice(mark + 1).replace(/[.,]/g, '')}`;
}

/**
 * The amount field: its label, an optional line on the right (the balance), the big number and the coin it is in.
 * The text is kept as typed — the screen reads it the way its engine wants (`city/lib/trade/**`); nothing here rounds.
 */
export function AmountField({
  label,
  aside,
  value,
  onChange,
  asset,
  onAsset,
  assetLabel,
  placeholder = '0',
}: {
  label: string;
  aside?: string;
  value: string;
  onChange: (text: string) => void;
  asset?: Readonly<{ symbol: string; icon: string | null }>;
  /** Opens the screen's own list of coins; without it the coin is shown, not chosen. */
  onAsset?: () => void;
  assetLabel?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <label htmlFor={id}>
          <Kick>{label}</Kick>
        </label>
        {aside ? <span className={s.fieldAside}>{aside}</span> : null}
      </div>
      <div className={s.fieldRow}>
        <input
          id={id}
          className={s.amount}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(amountText(event.target.value))}
        />
        {asset ? (
          onAsset ? (
            <button type="button" className={s.pill} onClick={onAsset} aria-label={assetLabel ?? asset.symbol}>
              <CoinLogo src={asset.icon} symbol={asset.symbol} size="s" />
              {asset.symbol}
              <Icon name="chevron" size="s" />
            </button>
          ) : (
            <span className={s.pill}>
              <CoinLogo src={asset.icon} symbol={asset.symbol} size="s" />
              {asset.symbol}
            </span>
          )
        ) : null}
      </div>
    </div>
  );
}

/** A share of what can be spent, one tap each: 25 %, 50 %, 75 %, all. */
export function Shares<T extends string>({ options, value, onPick, label }: { options: readonly Readonly<{ id: T; label: string }>[]; value: T | null; onPick: (id: T) => void; label: string }) {
  return (
    <div className={s.shares} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={option.id === value} onClick={() => onPick(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
