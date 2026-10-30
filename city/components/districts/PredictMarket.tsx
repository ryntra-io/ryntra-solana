'use client';

import { useMemo, useState } from 'react';
import { changeAcross, changeOver, frameOf, momentOf, nearestAt, pathsOf, RANGES, timeLabels, xAt } from '@/city/lib/districts/predict/chart';
import type { Row } from '@/city/lib/districts/predict/detail';
import { cents, chance, closesIn, headSide, kickerOf, sideName, signedPct, signedUsd, usd, volumeText } from '@/city/lib/districts/predict/markets';
import { linesOn, statusWord, type Line } from '@/city/lib/districts/predict/positions';
import { usePredict } from '@/city/lib/districts/predict/store';
import { PREDICT } from '@/city/lib/districts/predict/words';
import { dateText, digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Range } from '@/city/lib/districts/predict/chart';
import { PredictArt } from './PredictArt';
import { ClockGlyph, VolumeGlyph } from './predictGlyphs';
import { useNow, usePageMarket, usePositions } from './predictHooks';
import { PredictTicket } from './PredictTicket';
import s from './predict.module.css';

/** Rows an event shows before «All markets». */
const ROWS_FIRST = 6;

const W = 640;
const H = 220;

/** A range's pill, by range. */
const RANGE_WORD: Readonly<Record<Range, TextKey<typeof PREDICT>>> = { '1D': 'range1D', '1W': 'range1W', '1M': 'range1M', ALL: 'rangeALL' };

/**
 * A market's page: its picture, its question and the chance in big type with the day's move, its volume and close, the
 * chance over time with its ranges, every market of the event as a row with its own Yes and No, what you hold here, and
 * the ticket beside it. What resolves the market and its sources wait behind «Details» in the ticket.
 */
export function PredictMarket() {
  const at = usePageMarket();
  const detail = usePredict((st) => st.detail);
  const tabs = usePredict((st) => st.tabs);
  const back = usePredict((st) => st.back);
  const loadDetail = usePredict((st) => st.loadDetail);
  const w = useWords(PREDICT);
  if (!at) {
    if (detail.status === 'error') {
      return (
        <div className={s.empty}>
          <span>{detail.gone ? w.marketGone : w.marketDown}</span>
          <button className={s.quiet} onClick={() => (detail.gone ? back() : void loadDetail())}>
            {detail.gone ? w.backToMarkets : w.tryAgain}
          </button>
        </div>
      );
    }
    return (
      <div className={s.page}>
        <div className={s.pageMain}>
          <div className={`${s.hero} ${s.cardLoading}`}>
            <span className={s.shimmer} />
          </div>
        </div>
      </div>
    );
  }
  const { market } = at;
  const head = headSide(market);
  const kicker = kickerOf(market, tabs);
  const rows = at.detail?.rows ?? [];
  return (
    <div className={s.page}>
      <div className={s.pageMain}>
        <div className={s.hero}>
          <PredictArt market={market} size="hero" />
          <div className={s.heroText}>
            {kicker ? <span className={s.kicker}>{kicker}</span> : null}
            <h3 className={s.heroTitle}>{market.title}</h3>
            {market.question ? <span className={s.heroQuestion}>{market.question}</span> : null}
            <div className={s.chanceRow}>
              <span className={s.chanceBig}>{chance(head.p)}</span>
              <span className={s.chanceWord}>{market.binary ? w.chance : sideName(head.label)}</span>
              <Today />
            </div>
            <Facts volume={market.volume} closes={market.closes} />
          </div>
        </div>
        <Chart />
        {rows.length > 1 ? <Rows rows={rows} picked={market.marketId} /> : null}
        <Held eventId={market.eventId} />
      </div>
      <PredictTicket />
    </div>
  );
}

/** The volume and the close, two quiet figures under the chance. */
function Facts({ volume, closes }: { volume: number | null; closes: string | null }) {
  const now = useNow(30_000);
  const w = useWords(PREDICT);
  const when = closes ? new Date(closes) : null;
  const date = when && Number.isFinite(when.getTime()) ? dateText(when, { month: 'short', day: 'numeric', year: when.getFullYear() !== new Date(now).getFullYear() ? 'numeric' : undefined }) : null;
  return (
    <div className={s.facts}>
      <span className={s.fact}>
        <VolumeGlyph />
        <b>{volumeText(volume)}</b> {w.volWord}
      </span>
      {date ? (
        <span className={s.fact} title={closesIn(closes, now)}>
          <ClockGlyph />
          {w.ends} <b>{date}</b>
        </span>
      ) : null}
    </div>
  );
}

/** Every market of the event: what it asks, its chance, and its own Yes and No — a tap shows it and puts it on the ticket. */
function Rows({ rows, picked }: { rows: readonly Row[]; picked: string }) {
  const pickMarket = usePredict((st) => st.pickMarket);
  const [all, setAll] = useState(false);
  const w = useWords(PREDICT);
  const pickedAt = rows.findIndex((r) => r.marketId === picked);
  const shown = all || rows.length <= ROWS_FIRST ? rows : rows.slice(0, Math.max(ROWS_FIRST, pickedAt + 1));
  return (
    <section className={s.rows} aria-label={w.eventMarkets}>
      {shown.map((r) => {
        const head = headSide(r);
        const on = r.marketId === picked;
        const [yes, no] = r.binary ? r.sides : [head, null];
        return (
          <div key={r.marketId} className={s.row} data-on={on ? '' : undefined}>
            <button className={s.rowMain} onClick={() => pickMarket(r.marketId)} aria-pressed={on}>
              <span className={s.rowLabel}>{r.label}</span>
              <span className={s.rowChance}>{chance(head.p)}</span>
            </button>
            <div className={s.rowSides}>
              <button className={s.rowYes} onClick={() => pickMarket(r.marketId, yes!.id)} aria-label={`${r.label}: ${sideName(yes!.label)} ${cents(yes!.p)}`}>
                {r.binary ? w.yes : sideName(yes!.label)} {cents(yes!.p)}
              </button>
              {no ? (
                <button className={s.rowNo} onClick={() => pickMarket(r.marketId, no.id)} aria-label={`${r.label}: ${w.no} ${cents(no.p)}`}>
                  {w.noAt(cents(no.p))}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {shown.length < rows.length ? (
        <button className={s.quiet} onClick={() => setAll(true)}>
          {w.allMarkets(rows.length)}
        </button>
      ) : null}
    </section>
  );
}

/** What you hold on this event: each side, its value and its move — or that the order is on its way. */
function Held({ eventId }: { eventId: string }) {
  const { open } = usePositions();
  const openMarket = usePredict((st) => st.openMarket);
  const lines = linesOn(open, eventId);
  const w = useWords(PREDICT);
  if (!lines.length) return null;
  return (
    <section className={s.held} aria-label={w.yourPosition}>
      <span className={s.heldTitle}>{w.yourPosition}</span>
      {lines.map((l) => (
        <HeldRow key={l.key} line={l} onSell={l.sellable && l.outcomeId ? () => openMarket(eventId, l.outcomeId, 'sell', l.marketId) : null} />
      ))}
    </section>
  );
}

function HeldRow({ line, onSell }: { line: Line; onSell: (() => void) | null }) {
  const word = statusWord(line.status);
  const w = useWords(PREDICT);
  const up = (line.pnl ?? 0) >= 0.005;
  const down = (line.pnl ?? 0) <= -0.005;
  return (
    <div className={s.heldRow} data-status={line.status}>
      <span className={s.heldSide} data-side={/^yes$/i.test(line.label) ? 'yes' : /^no$/i.test(line.label) ? 'no' : 'other'}>
        {sideName(line.label)}
      </span>
      <span className={s.heldShares}>
        {line.shares !== null ? w.sharesShort(digits(line.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })), line.shares) : ''}
        {line.avg !== null ? ` · ${cents(line.avg)}` : ''}
      </span>
      <span className={s.heldValue}>{word ? <span className={s.statusChip} data-status={line.status}>{word}</span> : line.value !== null ? usd(line.value) : '—'}</span>
      {!word && line.pnl !== null ? (
        <span className={`${s.heldPnl} ${up ? s.up : down ? s.down : s.flat}`}>
          {signedUsd(line.pnl)} {line.pct !== null ? signedPct(line.pct) : ''}
        </span>
      ) : null}
      {onSell ? (
        <button className={s.heldSell} onClick={onSell}>
          {w.sell}
        </button>
      ) : null}
    </div>
  );
}

/** The day's move of the chance, from the bars; nothing when the history does not reach back a day. */
function Today() {
  const chart = usePredict((st) => st.chart);
  const range = usePredict((st) => st.range);
  const now = useNow(60_000);
  const w = useWords(PREDICT);
  const points = chart?.status === 'ready' ? chart.points : null;
  if (!points || range !== '1D') return null;
  const move = changeOver(points, 24, now);
  if (move === null || Math.abs(move) < 0.5) return null;
  return (
    <span className={`${s.change} ${move > 0 ? s.up : s.down}`}>
      <span aria-hidden="true">{move > 0 ? '▲' : '▼'}</span> {w.today(String(Math.abs(Math.round(move))))}
    </span>
  );
}

/** The chance over time: ranges, the line in the market's colour, gridlines in whole tens, the last read marked. */
function Chart() {
  const chart = usePredict((st) => st.chart);
  const range = usePredict((st) => st.range);
  const setRange = usePredict((st) => st.setRange);
  const w = useWords(PREDICT);
  const loadChart = usePredict((st) => st.loadChart);
  const lang = useLang();
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => (chart?.status === 'ready' ? chart.points : []), [chart]);
  const frame = useMemo(() => frameOf(points), [points]);
  const paths = useMemo(() => pathsOf(points, frame, W, H), [points, frame]);
  // The clock under the line is written in the language on screen: a switch writes it again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labels = useMemo(() => timeLabels(points, range), [points, range, lang]);
  const move = changeAcross(points);
  const down = move !== null && move < 0;
  const at = hover !== null ? points[hover] : points[points.length - 1];
  const atX = points.length > 1 ? xAt(points, hover ?? points.length - 1) * W : undefined;
  const atY = at ? H - ((at.p - frame.low) / Math.max(1e-6, frame.high - frame.low)) * H : null;
  return (
    <div className={s.chartCard}>
      <div className={s.ranges} role="radiogroup" aria-label={w.range}>
        {RANGES.map((r) => (
          <button key={r} role="radio" aria-checked={r === range} className={`${s.range} ${r === range ? s.rangeOn : ''}`} onClick={() => setRange(r)}>
            {w[RANGE_WORD[r]]}
          </button>
        ))}
      </div>
      <div className={s.chart} data-down={down ? '' : undefined} data-loading={chart?.status === 'loading' && !points.length ? '' : undefined}>
        <div className={s.yLabels} aria-hidden="true">
          {[...frame.ticks].reverse().map((t) => (
            <span key={t}>{Math.round(t * 100)}%</span>
          ))}
        </div>
        <div className={s.plot}>
          {chart?.status === 'loading' && !points.length ? (
            <span className={s.shimmer} aria-label={w.loadingChart}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.ghost} aria-hidden="true">
                <path d={`M0 ${H * 0.62}C${W * 0.18} ${H * 0.52} ${W * 0.3} ${H * 0.7} ${W * 0.48} ${H * 0.5}S${W * 0.78} ${H * 0.36} ${W} ${H * 0.42}`} />
              </svg>
            </span>
          ) : null}
          {chart?.status === 'error' ? (
            <span className={s.chartEmpty}>
              {w.chartDown}
              <button className={s.quiet} onClick={() => void loadChart()}>
                {w.tryAgain}
              </button>
            </span>
          ) : chart?.status === 'ready' && points.length < 2 ? (
            <span className={s.chartEmpty}>{w.noTrades}</span>
          ) : null}
          {points.length >= 2 ? (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className={s.chartSvg}
              role="img"
              aria-label={w.chanceOver(w[RANGE_WORD[range]])}
              onPointerMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const k = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
                setHover(nearestAt(points, k));
              }}
              onPointerLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id="predict-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              {frame.ticks.map((t) => {
                const y = H - ((t - frame.low) / Math.max(1e-6, frame.high - frame.low)) * H;
                return <line key={t} x1="0" x2={W} y1={y} y2={y} className={s.gridLine} vectorEffect="non-scaling-stroke" />;
              })}
              <path d={paths.area} fill="url(#predict-area)" />
              <path d={paths.line} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          ) : null}
          {at && atX !== undefined && atY !== null && points.length >= 2 ? (
            <>
              <span className={s.dot} style={{ left: `${(atX / W) * 100}%`, top: `${(atY / H) * 100}%` }} />
              <span className={s.tip} style={{ left: `${Math.min(92, Math.max(8, (atX / W) * 100))}%`, top: `${(atY / H) * 100}%` }}>
                {chance(at.p)}
                {hover !== null ? <span className={s.tipWhen}>{momentOf(at.t, range)}</span> : null}
              </span>
            </>
          ) : null}
        </div>
        <div className={s.xLabels} aria-hidden="true">
          {labels.map((l, i) => (
            <span key={`${l}-${i}`}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
