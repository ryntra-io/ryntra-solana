'use client';

import { useState } from 'react';
import { cents, signedPct, signedUsd, usd } from '@/city/lib/districts/predict/markets';
import { recordOf } from '@/city/lib/districts/predict/practice';
import { statusWord, type Line, type Past } from '@/city/lib/districts/predict/positions';
import type { Payout } from '@/city/lib/districts/predict/real';
import { useReal } from '@/city/lib/districts/predict/real-store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { PredictArt } from './PredictArt';
import { ChevronGlyph } from './predictGlyphs';
import { usePositions } from './predictHooks';
import s from './predict.module.css';

/** No payouts: one array for every read, so the store's selector stays still. */
const NONE: readonly Payout[] = [];

const sideOf = (label: string) => (/^yes$/i.test(label) ? 'yes' : /^no$/i.test(label) ? 'no' : 'other');

/** A position: the market, the side with its price now, what it is worth and its move — a tap opens its market on Sell. */
function Row({ line }: { line: Line }) {
  const openMarket = usePredict((st) => st.openMarket);
  const up = (line.pnl ?? 0) >= 0.005;
  const down = (line.pnl ?? 0) <= -0.005;
  const word = statusWord(line.status);
  const go = () => {
    if (!line.eventId) return;
    if (line.sellable) openMarket(line.eventId, line.outcomeId, 'sell', line.marketId);
    else openMarket(line.eventId, line.outcomeId, 'buy', line.marketId);
  };
  return (
    <button className={s.posRow} onClick={go} disabled={!line.eventId} aria-label={`${line.title}, ${line.label}${word ? `, ${word}` : ''}`} data-status={line.status}>
      <PredictArt market={{ image: line.image, categories: [], title: line.title }} size="row" />
      <span className={s.posText}>
        <span className={s.posTitle}>{line.title}</span>
        <span className={s.posSide} data-side={sideOf(line.label)}>
          {line.label}
          {line.shares !== null ? <span className={s.posShares}> · {line.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })} sh</span> : null}
          {line.avg !== null && line.price !== null ? (
            <span className={s.posShares}>
              {' '}
              · {cents(line.avg)} → {cents(line.price)}
            </span>
          ) : null}
        </span>
      </span>
      <span className={s.posFigures}>
        {word ? (
          <span className={s.statusChip} data-status={line.status}>
            {word}
          </span>
        ) : (
          <>
            <span className={s.posValue}>{line.value !== null ? usd(line.value) : line.cost !== null ? usd(line.cost) : '—'}</span>
            {line.pnl !== null && (up || down) ? (
              <span className={`${s.posPnl} ${up ? s.up : s.down}`}>
                {signedUsd(line.pnl)}
                {line.pct !== null ? ` ${signedPct(line.pct)}` : ''}
              </span>
            ) : null}
          </>
        )}
        {word && line.cost !== null ? <span className={s.posValue}>{usd(line.cost)}</span> : null}
      </span>
      <span className={s.posChevron} aria-hidden="true">
        <ChevronGlyph />
      </span>
    </button>
  );
}

/** A closed position or a finished order: how it ended, and what came back. */
function PastRow({ past }: { past: Past }) {
  const openMarket = usePredict((st) => st.openMarket);
  return (
    <button className={s.posRow} onClick={() => past.eventId && openMarket(past.eventId)} disabled={!past.eventId} aria-label={`${past.title}, ${past.word}`}>
      <PredictArt market={{ image: past.image, categories: [], title: past.title }} size="row" />
      <span className={s.posText}>
        <span className={s.posTitle}>{past.title}</span>
        <span className={s.posSide} data-side={sideOf(past.label)}>
          {past.label}
          <span className={s.posShares}> · {past.at ? new Date(past.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        </span>
      </span>
      <span className={s.posFigures}>
        <span className={s.pastWord} data-tone={past.tone}>
          {past.word}
        </span>
        <span className={`${s.posPnl} ${past.tone === 'up' ? s.up : past.tone === 'down' ? s.down : s.flat}`}>{past.pnl !== null && past.tone !== 'flat' ? signedUsd(past.pnl) : past.amount !== null ? usd(past.amount) : ''}</span>
      </span>
      <span className={s.posChevron} aria-hidden="true">
        <ChevronGlyph />
      </span>
    </button>
  );
}

/** «Your positions» beside the markets on a desk; on every width the head's positions button opens the full list. */
export function PositionsAside() {
  const { open, summary } = usePositions();
  const go = usePredict((st) => st.go);
  return (
    <aside className={s.aside} aria-label="Your positions">
      <button className={s.asideTitle} onClick={() => go({ kind: 'positions' })}>
        Your positions
        {summary.pnl !== null && Math.abs(summary.pnl) >= 0.005 ? <span className={`${s.asidePnl} ${summary.pnl > 0 ? s.up : s.down}`}>{signedUsd(summary.pnl)}</span> : null}
      </button>
      {open.length ? (
        <div className={s.posList}>
          {open.slice(0, 6).map((l) => (
            <Row key={l.key} line={l} />
          ))}
        </div>
      ) : (
        <div className={s.asideEmpty}>No positions yet</div>
      )}
    </aside>
  );
}

/** Wins the venues mark payable now: one act collects them, and the receipt joins the history. */
function Collect() {
  const address = useWallet((st) => st.connection?.address ?? null);
  const payouts = useReal((st) => (address && st.owner === address ? (st.live?.payouts ?? NONE) : NONE));
  const collecting = useReal((st) => st.collecting);
  const collect = useReal((st) => st.collect);
  if (!payouts.length) return null;
  const total = payouts.reduce((sum, p) => sum + p.valueUsd, 0);
  return (
    <div className={s.collect}>
      <span className={s.collectText}>
        <b>{usd(total)}</b> won
      </span>
      <button className={`${s.primary} ${s.collectButton} ${collecting === 'sending' ? s.waiting : ''}`} disabled={collecting === 'sending'} onClick={() => void collect(payouts.map((p) => p.outcomeId))}>
        {collecting === 'sending' ? 'Collecting…' : 'Collect'}
      </button>
      {collecting === 'failed' ? <span className={`${s.line} ${s.lineWarn}`}>Not collected. Try again.</span> : null}
    </div>
  );
}

/** Every position, open and past, with what they come to; in Practice the practice dollars start again once spent. */
export function PredictPositions() {
  const { open, past, summary } = usePositions();
  const mode = usePredict((st) => st.mode);
  const book = usePredict((st) => st.book);
  const restart = usePredict((st) => st.restart);
  const back = usePredict((st) => st.back);
  const [tab, setTab] = useState<'open' | 'past'>('open');
  const record = recordOf(book);
  const real = mode === 'real';
  const up = (summary.pnl ?? 0) >= 0.005;
  const down = (summary.pnl ?? 0) <= -0.005;
  return (
    <div className={s.positions}>
      <div className={s.summary}>
        <span className={s.summaryBlock}>
          <span className={s.summaryWord}>{real ? 'In positions' : 'Practice total'}</span>
          <span className={s.summaryFigure}>{usd(real ? summary.value : record.cash + summary.value)}</span>
        </span>
        <span className={s.summaryBlock}>
          <span className={s.summaryWord}>Profit / loss</span>
          <span className={`${s.summaryFigure} ${up ? s.up : down ? s.down : ''}`}>
            {summary.pnl !== null ? signedUsd(summary.pnl) : '—'}
            {summary.pct !== null && (up || down) ? <span className={s.summaryPct}>{signedPct(summary.pct)}</span> : null}
          </span>
        </span>
        {!real ? (
          <span className={s.summaryBlock}>
            <span className={s.summaryWord}>Cash</span>
            <span className={s.summaryFigure}>{usd(record.cash)}</span>
          </span>
        ) : null}
      </div>
      {real ? <Collect /> : null}
      <div className={s.ticketTabs} role="tablist" aria-label="Open or past">
        {(['open', 'past'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`${s.ticketTab} ${tab === t ? s.ticketTabOn : ''}`} onClick={() => setTab(t)}>
            {t === 'open' ? `Open${open.length ? ` · ${open.length}` : ''}` : 'History'}
          </button>
        ))}
      </div>
      {tab === 'open' ? (
        open.length ? (
          <div className={s.posList}>
            {open.map((l) => (
              <Row key={l.key} line={l} />
            ))}
          </div>
        ) : (
          <div className={s.empty}>
            <span>No open positions.</span>
            <button className={s.quiet} onClick={back}>
              Browse markets
            </button>
          </div>
        )
      ) : past.length ? (
        <div className={s.posList}>
          {past.map((p) => (
            <PastRow key={p.key} past={p} />
          ))}
        </div>
      ) : (
        <div className={s.empty}>Nothing closed yet.</div>
      )}
      {mode === 'practice' && record.canReset ? (
        <button className={`${s.primary} ${s.action}`} onClick={restart}>
          Start again with $1,000
        </button>
      ) : null}
    </div>
  );
}
