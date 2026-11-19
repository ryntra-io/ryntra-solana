'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { PulseRow } from '@/lib/spot/pulse';
import { coinHref } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { CoinLogo, Tabs, changeText, changeTone, usdText } from '@/terminal/ui';
import { ageParts, countText } from './depth-view';
import { DEPTH, UNIT_WORD } from './depth-words';
import { Bars, People } from './glyphs';
import { PULSE_COLUMNS, PULSE_MOVE, PULSE_SHOWN, bornAt, cardLogo, curvePct, padWord, pulseBoard, type PulseColumn } from './pulse-view';
import { usePulse, usePulseRead } from './pulse-store';
import { QuickSum, ZapButton, type QuickCoin } from './QuickBuy';
import d from './depth.module.css';

const TITLE = { new: 'colNew', soon: 'colSoon', dex: 'colDex' } as const;

/**
 * The Pulse: what is being born on Solana right now, in three live columns of the engine's
 * feeds — New · Almost on a DEX · Out on a DEX — Ryntra's own launches first while they live. A card is its coin's
 * page; its ⚡ buys with the screen's one sum, right there. A column under the pointer holds still: a new coin waits
 * until the pointer leaves, so nothing jumps under the finger. A phone shows one column at a time, by tabs.
 */
export function Pulse() {
  const w = useWords(DEPTH);
  const narrow = useNarrow();
  usePulseRead();
  const feeds = usePulse((st) => st.feeds);
  const [tab, setTab] = useState<PulseColumn>('soon');
  const cards = useMemo(() => pulseBoard({ new: feeds.new.rows, soon: feeds.soon.rows, dex: feeds.dex.rows }), [feeds]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className={d.pulse} aria-labelledby="pulse-title" data-terminal="pulse">
      <div className={d.sectionHead}>
        <h2 id="pulse-title" className={d.h2}>
          {w.pulse}
        </h2>
        <span className={d.live}>
          <i aria-hidden="true" />
          {w.live}
        </span>
        <span className={d.grow} />
        <QuickSum />
      </div>
      {narrow ? (
        <>
          <Tabs
            fill
            label={w.pulse}
            value={tab}
            onChange={setTab}
            className={d.pulseTabs}
            items={PULSE_COLUMNS.map((id) => ({ id, label: id === 'dex' ? w.colDexShort : w[TITLE[id]] }))}
          />
          <Column id={tab} rows={cards[tab]} status={feeds[tab].status} now={now} head={false} />
        </>
      ) : (
        <div className={d.pulseCols}>
          {PULSE_COLUMNS.map((id) => (
            <Column key={id} id={id} rows={cards[id]} status={feeds[id].status} now={now} head />
          ))}
        </div>
      )}
    </section>
  );
}

function Column({ id, rows, status, now, head }: { id: PulseColumn; rows: readonly PulseRow[]; status: 'reading' | 'ready' | 'failed'; now: number; head: boolean }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  // Under the pointer the column holds what it shows; the newest read stands once the pointer leaves.
  const [held, setHeld] = useState(false);
  const shown = useRef<readonly PulseRow[]>(rows);
  if (!held) shown.current = rows;
  const list = shown.current.slice(0, PULSE_SHOWN);
  return (
    <section className={d.pulseCol} aria-label={w[TITLE[id]]} onPointerEnter={(event) => event.pointerType === 'mouse' && setHeld(true)} onPointerLeave={() => setHeld(false)}>
      {head ? (
        <div className={d.pulseHead}>
          <b>{w[TITLE[id]]}</b>
          {status === 'ready' ? <span>{digits(String(shown.current.length), lang)}</span> : null}
        </div>
      ) : null}
      {list.length ? (
        list.map((row) => <Card key={row.mint} row={row} column={id} now={now} />)
      ) : (
        <p className={d.pulseNone} role="status">
          {status === 'reading' ? <span className={d.shimmer} /> : w.pulseNone}
        </p>
      )}
    </section>
  );
}

function Card({ row, column, now }: { row: PulseRow; column: PulseColumn; now: number }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const router = useRouter();
  const href = coinHref(row.mint, 'live');
  const born = bornAt(row);
  const age = born === null ? null : ageParts(Math.max(0, now - born));
  const pad = padWord(row);
  const move = row.windows[PULSE_MOVE[column]].changePct;
  const volume = row.windows.h1.volumeUsd;
  const pct = column === 'soon' ? curvePct(row) : null;
  const logo = cardLogo(row);
  const quick: QuickCoin = { id: row.mint, symbol: row.symbol, name: row.name, icon: row.icon, logo };
  return (
    <div className={d.card} data-card="" data-ours={row.ryntra ? '' : undefined} onClick={() => router.push(href)}>
      <CoinLogo src={logo} symbol={row.symbol} size="m" className={d.cardLogo} />
      <span className={d.cardWords}>
        <span className={d.cardLine}>
          <Link href={href} className={d.cardSym} onClick={(event) => event.stopPropagation()}>
            {row.symbol}
          </Link>
          {age ? <span className={d.age}>{digits(`${age.n} ${w[UNIT_WORD[age.unit]]}`, lang)}</span> : null}
          {pad ? (
            <span className={d.pad} data-ours={row.ryntra ? '' : undefined}>
              {pad}
            </span>
          ) : null}
        </span>
        {/* A fact the feed did not measure is left out, not dashed. */}
        <span className={d.cardFacts}>
          {row.holders === null ? null : (
            <span>
              <People />
              {countText(row.holders, lang)}
            </span>
          )}
          {volume === null ? null : (
            <span>
              <Bars />
              {usdText(volume, lang)}
            </span>
          )}
          {pct !== null ? <span className={d.curve}>{digits(`${pct}%`, lang)}</span> : null}
        </span>
      </span>
      <span className={d.cardFig}>
        {row.marketCapUsd === null || row.marketCapUsd <= 0 ? null : <b>{usdText(row.marketCapUsd, lang)}</b>}
        {move === null ? null : <span data-tone={changeTone(move)}>{changeText(move, lang)}</span>}
      </span>
      <ZapButton coin={quick} />
      {pct !== null ? (
        <span className={d.bar} role="img" aria-label={w.toDex(digits(`${pct}%`, lang))}>
          <i style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}
