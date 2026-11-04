'use client';

import { useEffect, useState } from 'react';
import { cityDoors } from '@/city/lib/command/doors';
import { SOL_COIN } from '@/city/lib/command/parse';
import { run } from '@/city/lib/command/run';
import { openCommand } from '@/city/lib/command/store';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { entryHeadline } from '@/city/lib/instruct/face';
import { isLive, liveOf, useInstruct, type Entry, type Live } from '@/city/lib/instruct/store';
import { INSTRUCT } from '@/city/lib/instruct/words';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopOfView } from '@/city/lib/trade/stops-api';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { WalletPicker } from '../trade/WalletParts';
import { CoinMark } from './AgentCard';
import s from './instruct.module.css';

type W = ReturnType<typeof useWords<(typeof INSTRUCT)['en']>>;

/** The list reads its engines again this often while it is open. */
const REFRESH_MS = 30_000;

function stateWords(entry: Entry, live: Live, w: W): string {
  switch (live.state) {
    case 'reading':
      return '…';
    case 'next':
      return live.at === null ? w.paused : w.next(dateText(live.at, { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
    case 'due':
      return w.due;
    case 'paused':
      return w.paused;
    case 'waiting':
      return w.waiting;
    case 'watching':
      return w.watching;
    case 'reached':
      return w.reached;
    case 'filled':
      return w.filled;
    case 'ended':
      return w.ended;
    case 'unknown':
      return w.unknown;
  }
}

const TONE: Readonly<Record<Live['state'], string>> = {
  reading: 'quiet',
  next: 'calm',
  due: 'hot',
  paused: 'quiet',
  waiting: 'calm',
  watching: 'calm',
  reached: 'hot',
  filled: 'good',
  ended: 'quiet',
  unknown: 'quiet',
};

/** A due purchase opens the trade window on it, filled; a reached stop opens its sale — the person signs there. */
function act(entry: Entry, live: Live): void {
  if (live.state === 'due') {
    const coin = entry.coin.mint === SOL_COIN.mint ? SOL_COIN : { ...entry.coin, tower: true };
    useInstruct.getState().closeList();
    run({ kind: 'buy', coin, view: 'spot', amount: entry.amount, pay: 'USDC', share: null }, cityDoors);
    return;
  }
  if (live.state === 'reached' && entry.ref.kind === 'stop') {
    const id = entry.ref.id;
    const view = useInstruct.getState().reads.stops?.find((stop) => stop.id === id);
    if (!view) return;
    useInstruct.getState().closeList();
    useSpot.getState().openSale(stopOfView(view, entry.owner));
  }
}

function Row({ entry, now }: { entry: Entry; now: number }) {
  const w = useWords(INSTRUCT);
  const reads = useInstruct((st) => st.reads);
  const cancelling = useInstruct((st) => st.cancelling);
  const live = liveOf(entry, reads, now);
  const busy = cancelling === entry.id;
  const doing = live.state === 'due' ? w.buyNow : live.state === 'reached' ? w.sellNow : null;
  return (
    <li className={s.row}>
      <CoinMark symbol={entry.coin.symbol} icon={entry.coin.icon} size="small" />
      <div className={s.rowText}>
        <span className={s.rowTitle}>{entryHeadline(entry, w)}</span>
        <span className={`${s.state} ${s[`tone_${TONE[live.state]}`] ?? ''}`}>{stateWords(entry, live, w)}</span>
      </div>
      {doing && (
        <button type="button" className={s.rowGo} onClick={() => act(entry, live)}>
          {doing}
        </button>
      )}
      <button type="button" className={s.rowCancel} disabled={cancelling !== null} onClick={() => void useInstruct.getState().cancel(entry.id)}>
        {busy ? w.cancelling : isLive(live) ? w.cancel : w.remove}
      </button>
    </li>
  );
}

/**
 * «My instructions» (CITY-176): what the agent set from sentences, each with its state from its engine — the next
 * purchase, the price an order waits for, a stop watched or reached — and «Cancel» in one tap.
 */
export default function Instructions() {
  const w = useWords(INSTRUCT);
  const connection = useWallet((st) => st.connection);
  const entries = useInstruct((st) => st.entries);
  const owner = useInstruct((st) => st.owner);
  const notice = useInstruct((st) => st.listNotice);
  const [picking, setPicking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => startWallets(), []);
  useEffect(() => {
    void useInstruct.getState().readList();
    const timer = setInterval(() => {
      setNow(Date.now());
      void useInstruct.getState().readList();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [connection?.address]);

  if (!connection) {
    if (picking) return <WalletPicker onBack={() => setPicking(false)} />;
    return (
      <div className={s.empty}>
        <p className={s.emptyTitle}>{w.connectList}</p>
        <button type="button" className={s.action} onClick={() => setPicking(true)}>
          {w.connect}
        </button>
      </div>
    );
  }
  const mine = owner === connection.address ? entries : [];
  if (!mine.length) {
    return (
      <div className={s.empty}>
        {/* The scouts over the city, from the live scene: the agents at work. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={s.emptyArt} src="/city/art/scouts-800.webp" alt="" decoding="async" />
        <p className={s.emptyTitle}>{w.empty}</p>
        <p className={s.emptyHint}>{w.emptyHint}</p>
        <button
          type="button"
          className={s.action}
          onClick={() => {
            useInstruct.getState().closeList();
            openCommand();
          }}
        >
          {w.sayIt}
        </button>
      </div>
    );
  }
  return (
    <div className={s.listBody}>
      <ul className={s.rows}>
        {mine.map((entry) => (
          <Row key={entry.id} entry={entry} now={now} />
        ))}
      </ul>
      {notice && <p className={notice.tone === 'error' ? s.problem : s.notice}>{notice.text}</p>}
    </div>
  );
}
