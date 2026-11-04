'use client';

import { useEffect, useMemo, useState } from 'react';
import { openCoin } from '@/city/lib/coin/open';
import { districtFrame } from '@/city/lib/art/frames';
import { num, useWords } from '@/city/lib/i18n/dict';
import { allLaunches, launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { usd } from '@/city/lib/launch/format';
import { curvePercent, launchedList, type LaunchedCard } from '@/city/lib/launch/launched';
import { useLaunched } from '@/city/lib/launch/launched-store';
import { LAUNCHED } from '@/city/lib/launch/words';
import { CoinIcon } from '../chart/CoinIcon';
import s from './launched.module.css';

/** The Docks as our own live city filmed them (CITY-64): behind the window's head and its empty state. */
const DOCKS = districtFrame('launch').files[1]!.src;
/** A launchpad with no launch yet says so after this long, rather than wait for ever. */
const SETTLE_MS = 6_000;

/**
 * «Launched on Ryntra» (CITY-185): every coin launched on the launchpad, one card each — its picture, ticker, market
 * cap, the curve's way to the pool or «In pool», its holders — and one action, «Trade», which flies to its tower. One
 * amber «Launch yours» on top. Ryntra's own technical launches stand apart behind one quiet disclosure; with no
 * launch by people yet, the window is the Docks with «Be the first tower».
 */
export default function LaunchedWindow() {
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const status = useLaunch((st) => st.status);
  const canLaunch = useLaunch(launchOpenHere);
  const w = useWords(LAUNCHED);
  const list = useMemo(() => launchedList(allLaunches({ feed, mine })), [feed, mine]);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  const reading = status === 'reading' || (status === 'ready' && !feed.length && !mine.length && !settled);
  if (reading) {
    return (
      <div className={s.framed}>
        <div className={s.bones} aria-busy="true" aria-label={w.reading}>
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (!list.people.length) {
    return (
      <div className={`${s.framed} ${s.emptyFrame}`}>
        <div className={s.first} style={{ backgroundImage: `url(${DOCKS})` }}>
          <div className={s.shade} />
          <h3 className={`${s.display} ${s.firstTitle}`}>{w.firstTower}</h3>
          {canLaunch && <LaunchYours />}
        </div>
        <Tests cards={list.tests} />
      </div>
    );
  }

  return (
    <div className={s.framed}>
      <div className={s.head} style={{ backgroundImage: `url(${DOCKS})` }}>
        <div className={s.shade} />
        {canLaunch && <LaunchYours />}
      </div>
      <div className={s.grid}>
        {list.people.map((card) => (
          <Card key={card.token} card={card} />
        ))}
      </div>
      <Tests cards={list.tests} />
    </div>
  );
}

/** The window steps aside for the launch sheet: name, ticker, picture, one signature. */
function LaunchYours() {
  const w = useWords(LAUNCHED);
  return (
    <button
      type="button"
      className={`${s.display} ${s.action}`}
      onClick={() => {
        useLaunched.getState().close();
        useLaunch.getState().openSheet();
      }}
    >
      {w.launchYours}
    </button>
  );
}

/** Its tower when it stands in the city, else its trade card: exactly as its own link `/c/<mint>` opens it. */
function trade(card: LaunchedCard) {
  useLaunched.getState().close();
  void openCoin(card.token, { mint: card.token, symbol: card.symbol, name: card.name, icon: card.image });
}

function Face({ card }: { card: LaunchedCard }) {
  return (
    <span className={s.face}>
      <CoinIcon tower={{ id: card.token, icon: null, symbol: card.symbol }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {card.image && <img src={card.image} alt="" loading="lazy" />}
    </span>
  );
}

function Way({ card }: { card: LaunchedCard }) {
  const w = useWords(LAUNCHED);
  if (card.inPool) return <span className={s.pool}>{w.inPool}</span>;
  if (card.curve === null) return null;
  const pct = curvePercent(card.curve);
  const words = w.toPool(`${num(pct)}%`);
  return (
    <div className={s.way} role="img" aria-label={words}>
      <span className={s.bar} aria-hidden="true">
        <span style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      <span className={s.wayWords}>{words}</span>
    </div>
  );
}

function Card({ card }: { card: LaunchedCard }) {
  const w = useWords(LAUNCHED);
  return (
    <article className={s.card} data-launched={card.symbol}>
      <div className={s.cardTop}>
        <Face card={card} />
        <div className={s.coinWords}>
          <b className={s.display}>${card.symbol}</b>
          <span>{card.name}</span>
        </div>
        {card.mine && <span className={s.tag}>{w.mine}</span>}
      </div>
      <div className={s.figures}>
        {card.marketCapUsd !== null && (
          <span className={s.figure}>
            <small>{w.mcap}</small>
            <b className={s.display}>{usd(card.marketCapUsd)}</b>
          </span>
        )}
        {card.holders && <span className={s.holders}>{w.holders(`${card.holders.atLeast ? '≥' : ''}${num(card.holders.count)}`, card.holders.count)}</span>}
      </div>
      <Way card={card} />
      <button type="button" className={`${s.display} ${s.trade}`} aria-label={w.tradeCoin(card.symbol)} onClick={() => trade(card)}>
        {w.trade}
      </button>
    </article>
  );
}

/** Ryntra's own technical launches: real coins, never people's projects — apart, closed until asked for. */
function Tests({ cards }: { cards: readonly LaunchedCard[] }) {
  const w = useWords(LAUNCHED);
  if (!cards.length) return null;
  return (
    <details className={s.tests}>
      <summary>{w.tests(cards.length)}</summary>
      <ul>
        {cards.map((card) => (
          <li key={card.token}>
            <button type="button" className={s.testRow} aria-label={w.tradeCoin(card.symbol)} onClick={() => trade(card)}>
              <Face card={card} />
              <b>${card.symbol}</b>
              <span className={s.testTag}>{w.test}</span>
              <span className={s.testState}>{card.inPool ? w.inPool : card.curve !== null ? w.toPool(`${num(curvePercent(card.curve))}%`) : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
