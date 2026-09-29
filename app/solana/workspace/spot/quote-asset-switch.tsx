"use client";

import { useRef, type KeyboardEvent } from "react";

import { MarketIcon } from "./market-list.tsx";
import type { SpotQuoteAsset } from "./use-spot-ticket.ts";

import styles from "./spot.module.css";

/**
 * Which asset a person pays with, or receives — USDC or SOL — as one switch
 * drawn by the product.
 *
 * It replaces a native `<select>`: the browser painted that control's list
 * in its own light colours over the dark ticket (the Owner, 2026-09-14), and
 * a list that opens for two choices is one click more than the choice needs.
 * Both assets are on the pill at once; the pressed one is the current one.
 * It is a radio group to the keyboard and to assistive technology — arrows
 * move the choice, Home and End go to the ends — and when a market is itself
 * one of the two quote assets, the one that remains is shown as a plain pill.
 */
export function QuoteAssetSwitch({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly SpotQuoteAsset[];
  disabled?: boolean;
  onChange: (mint: string) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const only = options.length === 1 ? options[0] : null;
  if (only) {
    return (
      <span className={styles.assetPill}>
        <MarketIcon mint={only.mint} icon={only.icon ?? null} symbol={only.symbol} size={22} />
        {only.symbol}
      </span>
    );
  }
  if (options.length === 0) return null;

  const choose = (index: number) => {
    const next = options[(index + options.length) % options.length];
    if (!next) return;
    if (next.mint !== value) onChange(next.mint);
    group.current?.querySelectorAll<HTMLButtonElement>("[role='radio']")[(index + options.length) % options.length]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = Math.max(0, options.findIndex((asset) => asset.mint === value));
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        choose(current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        choose(current - 1);
        break;
      case "Home":
        event.preventDefault();
        choose(0);
        break;
      case "End":
        event.preventDefault();
        choose(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={group} className={styles.quoteSwitch} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((asset) => {
        const checked = asset.mint === value;
        return (
          <button
            key={asset.mint}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className={styles.quoteOption}
            onClick={() => { if (!checked) onChange(asset.mint); }}
          >
            <MarketIcon mint={asset.mint} icon={asset.icon ?? null} symbol={asset.symbol} size={18} />
            <span>{asset.symbol}</span>
          </button>
        );
      })}
    </div>
  );
}
