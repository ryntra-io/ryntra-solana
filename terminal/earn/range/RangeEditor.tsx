'use client';

import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { rangePrices } from '@/city/lib/earn/pier';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { EarnBinsAnswer } from '@/lib/earn-pools/bins';
import { Icon, Kick, Quiet, Slider } from '@/terminal/ui';
import type { FactRow } from './facts';
import { pressDown, pressMove, type Press, type Step } from './gesture';
import { RANGE_MAX_HALF, RANGE_MIN_HALF, barsOf, clampHalf, halfAt, pctText, quickPicks, reachOf, shapeAt, spanOf, type RangeView, type ShapeId } from './model';
import type { BinsState } from './useBins';
import { RANGE } from './words';
import r from './range.module.css';

/** The chart's own height in its drawing units; a bar stands at most this tall under the room kept for the shape. */
const TALL = 100;
const BAR_TOP = 78;

/**
 * The pool's liquidity as bars by price, the bin the price stands in marked, and the range over them: a band whose two
 * edges are taken by hand. The range is one width each side of the price, so either edge moves both. Without `onHalf`
 * the range is shown as it is and nothing moves.
 */
export function BinsChart({ answer, half, max, shape, onHalf }: { answer: EarnBinsAnswer; half: number; max: number; shape: ShapeId; onHalf?: (half: number) => void }) {
  const w = useWords(RANGE);
  const lang = useLang();
  const box = useRef<HTMLDivElement>(null);
  const bars = barsOf(answer, half);
  const span = spanOf(answer);
  const columns = span * 2 + 1;
  const shown = Math.min(half, span);
  const left = ((span - shown) / columns) * 100;
  const right = ((span + shown + 1) / columns) * 100;
  const reach = reachOf(answer.stepBps, half);
  const said = w.widthOf(digits(pctText(reach.upPct), lang));

  const at = (clientX: number): number | null => {
    const rect = box.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? halfAt((clientX - rect.left) / rect.width, span, max) : null;
  };
  const set = (clientX: number) => {
    const next = at(clientX);
    if (next !== null && next !== half) onHalf?.(next);
  };
  /* One pointer at a time, as `gesture.ts` steps it: a grip pressed is taken hold of, never jumped to; a finger, on the
     bars or a grip, scrolls the ticket unless it moves across first. */
  const held = useRef<Press | null>(null);
  const edgeAt = (target: EventTarget | null): number | null => {
    const grip = target instanceof Element ? target.closest('[data-earn-range="low"], [data-earn-range="high"]') : null;
    const rect = box.current?.getBoundingClientRect();
    if (!grip || !rect) return null;
    return rect.left + (rect.width * (grip.getAttribute('data-earn-range') === 'low' ? left : right)) / 100;
  };
  const apply = (step: Step, event: PointerEvent<HTMLElement>) => {
    held.current = step.press;
    if (step.capture) event.currentTarget.setPointerCapture(event.pointerId);
    if (step.set !== null) set(step.set);
  };
  const down = (event: PointerEvent<HTMLElement>) => {
    if (!onHalf || (event.pointerType === 'mouse' && event.button !== 0)) return;
    apply(pressDown({ id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' }, edgeAt(event.target)), event);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!onHalf) return;
    apply(pressMove(held.current, { id: event.pointerId, x: event.clientX, y: event.clientY }), event);
  };
  const lift = () => {
    held.current = null;
  };
  /* An edge's arrows move it the way they point: the lower edge left is wider, the upper edge right is wider. */
  const keys = (outward: 'ArrowLeft' | 'ArrowRight') => (event: KeyboardEvent<HTMLElement>) => {
    if (!onHalf) return;
    const step = event.key === outward ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? -1 : event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    const next = event.key === 'Home' ? RANGE_MIN_HALF : event.key === 'End' ? max : step ? clampHalf(half + step, max) : null;
    if (next === null) return;
    event.preventDefault();
    if (next !== half) onHalf(next);
  };
  const edgeProps = (outward: 'ArrowLeft' | 'ArrowRight') => ({
    type: 'button' as const,
    role: 'slider',
    'aria-orientation': 'horizontal' as const,
    'aria-valuemin': RANGE_MIN_HALF,
    'aria-valuemax': max,
    'aria-valuenow': half,
    'aria-valuetext': said,
    onKeyDown: keys(outward),
  });

  const outline = bars
    .filter((bar) => bar.inRange)
    .flatMap((bar) => {
      const index = bar.offset + span;
      const y = TALL - shapeAt(shape, bar.offset, shown) * (TALL - 8);
      return [`${index},${y}`, `${index + 1},${y}`];
    })
    .join(' ');

  return (
    <div className={r.chart} ref={box} data-earn-range="chart" data-live={onHalf ? '' : undefined} onPointerDown={onHalf ? down : undefined} onPointerMove={onHalf ? move : undefined} onPointerUp={lift} onPointerCancel={lift}>
      <svg className={r.bars} viewBox={`0 0 ${columns} ${TALL}`} preserveAspectRatio="none" role="img" aria-label={w.chart}>
        {bars.map((bar) => {
          const tall = bar.height > 0 ? Math.max(2, bar.height * BAR_TOP) : 0;
          return <rect key={bar.offset} className={r.bar} data-side={bar.side} data-in={bar.inRange ? '' : undefined} data-active={bar.active ? '' : undefined} x={bar.offset + span + 0.14} y={TALL - tall} width={0.72} height={tall} />;
        })}
        {outline ? <polyline className={r.shape} points={outline} /> : null}
      </svg>
      <span className={r.now} style={{ left: `${((span + 0.5) / columns) * 100}%` }} aria-hidden="true" />
      <span className={r.band} style={{ left: `${left}%`, width: `${right - left}%` }} aria-hidden="true" />
      {onHalf ? (
        <>
          <button {...edgeProps('ArrowLeft')} className={r.edge} style={{ left: `${left}%` }} aria-label={w.lowEdge} data-earn-range="low" />
          <button {...edgeProps('ArrowRight')} className={r.edge} style={{ left: `${right}%` }} aria-label={w.highEdge} data-earn-range="high" />
        </>
      ) : null}
    </div>
  );
}

/** The range's two prices under the chart, each with how far it stands from the price, and the price now between them. */
function Edges({ range, price, unit }: { range: RangeView; price: number; unit: string }) {
  const w = useWords(RANGE);
  const lang = useLang();
  const prices = rangePrices(range.low, range.high);
  const now = rangePrices(price, range.high).low;
  return (
    <div className={r.edges}>
      <div className={r.edgeCell}>
        <Kick>{w.min}</Kick>
        <b>{digits(prices.low, lang)}</b>
        <span>{digits(`−${pctText(range.downPct)}%`, lang)}</span>
      </div>
      <div className={r.edgeCell} data-at="mid">
        <Kick>{w.now}</Kick>
        <b>{digits(now, lang)}</b>
        <span>{unit}</span>
      </div>
      <div className={r.edgeCell} data-at="end">
        <Kick>{w.max}</Kick>
        <b>{digits(prices.high, lang)}</b>
        <span>{digits(`+${pctText(range.upPct)}%`, lang)}</span>
      </div>
    </div>
  );
}

/** The quick widths: this many per cent each side. One the pool's step cannot reach in one position is not offered. */
function QuickRow({ stepBps, half, max, onHalf }: { stepBps: number; half: number; max: number; onHalf: (half: number) => void }) {
  const w = useWords(RANGE);
  const lang = useLang();
  const picks = quickPicks(stepBps, max);
  const top = reachOf(stepBps, max).upPct;
  return (
    <div className={r.quickBlock}>
      <div className={r.quick} role="group" aria-label={w.quick}>
        {picks.map((pick) => (
          <button key={pick.pct} type="button" className={r.chip} aria-pressed={pick.fits && pick.half === half} disabled={!pick.fits} onClick={() => onHalf(pick.half)}>
            {digits(w.quickOf(String(pick.pct)), lang)}
          </button>
        ))}
      </div>
      {picks.some((pick) => !pick.fits) ? <p className={r.cap}>{w.quickTop(digits(pctText(top), lang))}</p> : null}
    </div>
  );
}

/** What stands under a row of three choices, each under its own: the names a liquidity provider knows, a width's real reach. */
export function Names({ items }: { items: readonly Readonly<{ id: string; label: string; on: boolean }>[] }) {
  return (
    <div className={r.names}>
      {items.map((item) => (
        <span key={item.id} data-on={item.on ? '' : undefined}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Names and their figures before the signature; a row without a figure is left out. */
export function RangeFacts({ rows }: { rows: readonly FactRow[] }) {
  const shown = rows.filter((row): row is readonly [string, string] => row[1] !== null && row[1] !== '');
  if (!shown.length) return null;
  return (
    <dl className={r.facts} data-earn-range="facts">
      {shown.map(([name, value]) => (
        <div key={name} className={r.fact}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The range said in one line — its two prices and its bins — with the control that opens its own tools under it. */
export function RangeLine({ line, open, onOpen, controls }: { line: string; open: boolean; onOpen: (open: boolean) => void; controls: string }) {
  const w = useWords(RANGE);
  return (
    <div className={r.line}>
      <span data-earn-range="line">{line}</span>
      <Quiet size="s" aria-expanded={open} aria-controls={open ? controls : undefined} onClick={() => onOpen(!open)} data-earn-range="tune">
        {w.tune}
        <span className={r.turn} data-open={open ? '' : undefined}>
          <Icon name="chevron" size="s" />
        </span>
      </Quiet>
    </div>
  );
}

/**
 * The range's own tools, opened under its line: the pool's bins with the range over them, the two prices, the width by
 * hand and by quick per cent, and the facts before the signature. With `onHalf` absent the width is one of the form's
 * own three and only shown.
 */
export function RangeEditor({
  id,
  bins,
  range,
  price,
  stepBps,
  half,
  max = RANGE_MAX_HALF,
  shape,
  unit,
  onHalf,
  facts,
}: {
  id: string;
  bins: BinsState;
  range: RangeView;
  price: number;
  stepBps: number;
  half: number;
  max?: number;
  shape: ShapeId;
  unit: string;
  onHalf?: (half: number) => void;
  facts: readonly FactRow[];
}) {
  const w = useWords(RANGE);
  const lang = useLang();
  const reach = reachOf(stepBps, half);
  return (
    <div id={id} className={r.editor} data-earn-range="editor">
      {bins.status === 'ready' ? (
        <BinsChart answer={bins.value} half={half} max={max} shape={shape} onHalf={onHalf} />
      ) : (
        <div className={r.chart} data-state={bins.status} role={bins.status === 'failed' ? 'status' : undefined}>
          {bins.status === 'failed' ? <p className={r.cap}>{w.failed}</p> : null}
        </div>
      )}
      <Edges range={range} price={price} unit={unit} />
      {onHalf ? (
        <>
          <Slider value={half} min={RANGE_MIN_HALF} max={max} onChange={(next) => onHalf(clampHalf(next, max))} label={w.width} valueText={w.widthOf(digits(pctText(reach.upPct), lang))} />
          <QuickRow stepBps={stepBps} half={half} max={max} onHalf={onHalf} />
        </>
      ) : null}
      <RangeFacts rows={facts} />
    </div>
  );
}

/** An id for the editor a `RangeLine` opens. */
export function useEditorId(): string {
  return `range-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
