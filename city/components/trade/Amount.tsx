'use client';

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { formatUnits } from '@/city/lib/trade/format';
import { keyShare, pointerShare } from '@/city/lib/trade/size';
import type { Choice } from '@/city/lib/trade/store';
import s from './trade.module.css';
import { TRADE } from './words';

/**
 * How much the card spends, the same for Buy and Sell, Market, Limit and Stop: the amount in one big field, the four
 * shares under it — 25 %, 50 %, 75 %, MAX of what can be spent — and the slider from 0 to 100 under them. Each moves the
 * other two (`size.ts`). Without a balance the chips and the slider rest, quietly; the field always works.
 */
export function AmountPart({
  choice,
  typed,
  typable,
  onType,
  onShare,
}: {
  choice: Choice;
  typed: string;
  typable: boolean;
  onType: (text: string) => void;
  onShare: (share: number, settle: 'now' | 'rest') => void;
}) {
  const w = useWords(TRADE);
  const { sizing } = choice;
  const resting = !typable || sizing.share === null;
  const amount = choice.amountRaw && choice.spendDecimals !== null ? formatUnits(choice.amountRaw, choice.spendDecimals, 'down') : '0';
  return (
    <div className={s.size}>
      <label className={`${s.amount} ${choice.problem ? s.amountWrong : ''}`}>
        <input
          className={`${s.display} ${s.amountInput}`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0"
          aria-label={w.amountIn(choice.spendUnit)}
          aria-invalid={Boolean(choice.problem)}
          value={fieldText(typed)}
          onChange={(event) => onType(fieldValue(event.target.value))}
          disabled={!typable}
        />
        <span className={`${s.display} ${s.amountUnit}`}>{choice.spendUnit}</span>
      </label>
      <div className={s.shares} role="group" aria-label={w.shareOfBalance}>
        {sizing.chips.map((chip) => (
          <button key={chip.share} className={`${s.share} ${chip.on ? s.shareOn : ''}`} aria-pressed={chip.on} onClick={() => onShare(chip.share, 'now')} disabled={resting || !chip.usable}>
            {chip.label}
          </button>
        ))}
      </div>
      <ShareSlider share={sizing.share} resting={resting} valueText={`${Math.round(sizing.share ?? 0)}%, ${digits(amount)} ${choice.spendUnit}`} onShare={onShare} />
    </div>
  );
}

/**
 * The share as a slider: a thin track with the shares marked, the amber fill and one thumb. Dragged, tapped or moved by
 * the keyboard — arrows by one, Page Up and Down by ten, Home and End to its ends; priced once it rests.
 */
function ShareSlider({ share, resting, valueText, onShare }: { share: number | null; resting: boolean; valueText: string; onShare: (share: number, settle: 'now' | 'rest') => void }) {
  const w = useWords(TRADE);
  const track = useRef<HTMLDivElement>(null);
  const value = share ?? 0;
  const at = (event: ReactPointerEvent<HTMLElement>) => {
    const box = track.current?.getBoundingClientRect();
    return box ? pointerShare(event.clientX, box.left, box.width) : value;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resting || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    onShare(at(event), 'rest');
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resting && event.currentTarget.hasPointerCapture(event.pointerId)) onShare(at(event), 'rest');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = resting ? null : keyShare(value, event.key);
    if (next === null) return;
    event.preventDefault();
    onShare(next, 'rest');
  };
  return (
    <div
      className={`${s.slider} ${resting ? s.sliderResting : ''}`}
      role="slider"
      tabIndex={resting ? -1 : 0}
      aria-label={w.shareOfBalance}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      aria-disabled={resting}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div ref={track} className={s.track}>
        <span className={s.fill} style={{ width: `${value}%` }} />
        {[25, 50, 75].map((mark) => (
          <span key={mark} className={`${s.mark} ${value >= mark ? s.markPassed : ''}`} style={{ left: `${mark}%` }} />
        ))}
        <span className={s.thumb} style={{ left: `${value}%` }} />
      </div>
    </div>
  );
}
