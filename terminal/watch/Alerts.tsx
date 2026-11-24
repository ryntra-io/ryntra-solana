'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { useWallet } from '@/city/lib/trade/wallet';
import { openPanel } from '@/terminal/shell/frame';
import { useMarket } from '@/terminal/shell/useMarket';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, AmountField, Chip, CoinLogo, Icon, Info, Panel, Quiet, Search, Segment, Title, cx, priceText, usdText } from '@/terminal/ui';
import { useAlerts } from './alerts-store';
import { addressIn, coinNowOf, coinPageHref, coinsMatching, levelOf, logoOf, ruleFor, type AlertBasis, type AlertRow, type CoinNow, type CoinPick } from './watch-view';
import { ALERT_WORDS } from './words';
import v from './watch.module.css';

type A = (typeof ALERT_WORDS)['en'];

/** The coin's price and cap now, from the market read every coin of Solana has. */
async function readCoin(mint: string): Promise<CoinNow | null> {
  try {
    const answer = await fetch(`/api/spot/market?${new URLSearchParams({ mint })}`, { headers: { accept: 'application/json' } });
    return answer.ok ? coinNowOf(await answer.json(), mint) : null;
  } catch {
    return null;
  }
}

function connect(): void {
  // A phone's wallet lives in the frame's own sheet.
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** A level the person set, as a price reads — without the zeros its places add: $0.0006, not $0.0006000. */
function levelText(value: number, lang: Lang): string {
  return digits(priceText(value, 'en').replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''), lang);
}

/** A rule in the screen's words: a price, or — set by a cap — the cap the person typed. */
export function ruleWords(row: AlertRow, cap: number | null, a: A, lang: Lang): string {
  if (!row.price) return row.ruleText;
  if (cap !== null) return row.price.direction === 'above' ? a.capAbove(usdText(cap, lang)) : a.capBelow(usdText(cap, lang));
  const level = levelText(row.price.level, lang);
  return row.price.direction === 'above' ? a.priceAbove(level) : a.priceBelow(level);
}

function stateWord(row: AlertRow, a: A): Readonly<{ text: string; tone: 'ok' | 'warn' | 'plain' }> {
  if (row.state === 'paused') return { text: a.paused, tone: 'plain' };
  if (row.state === 'rang' || row.state === 'cooling') return { text: a.rang, tone: 'warn' };
  if (row.state === 'unread' || row.state === 'learning') return { text: a.reading, tone: 'plain' };
  return { text: a.armed, tone: 'ok' };
}

/** The person's alerts: the coin, the rule, whether it waits or rang — and one tap takes it away. */
export function AlertList({ onRemove }: { onRemove: (id: string) => void }) {
  const a = useWords(ALERT_WORDS);
  const lang = useLang();
  const view = useAlerts((st) => st.view);
  const notes = useAlerts((st) => st.notes);
  if (!view || view.rows.length === 0) return <p className={v.line}>{a.empty}</p>;
  return (
    <ul className={v.alerts} aria-label={a.yours}>
      {view.rows.map((row) => {
        const logo = logoOf(row.mint, null);
        const note = notes[row.id];
        const cap = note && row.price && note.level === row.price.level ? note.cap : null;
        const state = stateWord(row, a);
        return (
          <li key={row.id} className={v.alert}>
            <CoinLogo src={logo.src} also={logo.also} symbol={row.symbol} />
            <span className={v.alertMain}>
              <Link href={coinPageHref(row.mint)} className={v.coinLink}>
                {row.symbol}
              </Link>
              <span className={v.alertRule}>{ruleWords(row, cap, a, lang)}</span>
            </span>
            <Chip tone={state.tone} dot>
              {state.text}
            </Chip>
            <Quiet size="s" className={v.iconButton} aria-label={a.remove(row.symbol)} onClick={() => onRemove(row.id)}>
              <Icon name="close" size="s" />
            </Quiet>
          </li>
        );
      })}
    </ul>
  );
}

/** The coin's field: a ticker of the market or any coin's address; the list under it picks one. */
function CoinField({ onPick }: { onPick: (coin: CoinPick) => void }) {
  const a = useWords(ALERT_WORDS);
  const towers = useMarket().towers;
  const [typed, setTyped] = useState('');
  const address = addressIn(typed);
  const found = address ? [] : coinsMatching(towers, typed);
  return (
    <div className={v.coinField}>
      <Search
        value={typed}
        placeholder={a.coinField}
        onChange={(text) => {
          const mint = addressIn(text);
          if (mint) {
            setTyped('');
            onPick({ mint, symbol: mint.slice(0, 4), name: '', icon: null });
            return;
          }
          setTyped(text);
        }}
      />
      {found.length > 0 ? (
        <ul className={v.picks} aria-label={a.pickCoin}>
          {found.map((coin) => {
            const logo = logoOf(coin.mint, null);
            return (
              <li key={coin.mint}>
                <button type="button" className={v.pick} onClick={() => onPick(coin)}>
                  <CoinLogo src={logo.src} also={logo.also} symbol={coin.symbol} size="s" eager />
                  <span className={v.pickSymbol}>{coin.symbol}</span>
                  <span className={v.pickName}>{coin.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : typed.trim().length > 1 ? (
        <p className={v.note}>{a.notListed}</p>
      ) : null}
    </div>
  );
}

type FormNote = Readonly<{ text: string; tone: 'ok' | 'down' }> | null;

/**
 * «Tell me when the price or the cap crosses X»: the coin (fixed on its own page, chosen here elsewhere), what to watch,
 * the level — above now it rings on the way up, below now on the way down — and one press. `amber` — the screen's one
 * action; on the coin's page the press is quiet beside its ticket. Without a wallet the press connects one.
 */
export function AlertForm({ fixed, amber = true, onSet }: { fixed?: CoinNow | null; amber?: boolean; onSet?: () => void }) {
  const a = useWords(ALERT_WORDS);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const view = useAlerts((st) => st.view);
  const [picked, setPicked] = useState<CoinPick | null>(null);
  const [coin, setCoin] = useState<CoinNow | null>(fixed ?? null);
  const [reading, setReading] = useState(false);
  const [basis, setBasis] = useState<AlertBasis>('price');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<FormNote>(null);

  useEffect(() => {
    if (fixed) setCoin(fixed);
  }, [fixed]);

  // The wallet's alerts, when its proof is already here: how many are free. Never opens the wallet.
  const owner = connection?.address ?? null;
  useEffect(() => {
    if (owner) void useAlerts.getState().read(owner, lang);
  }, [owner, lang]);

  // A coin picked here is read for its price and cap now.
  useEffect(() => {
    if (!picked) return;
    let live = true;
    setReading(true);
    setCoin(null);
    void readCoin(picked.mint).then((now) => {
      if (!live) return;
      setReading(false);
      setCoin(now);
      if (!now) setNote({ text: a.noCoin, tone: 'down' });
    });
    return () => {
      live = false;
    };
  }, [picked, a.noCoin]);

  const level = levelOf(typed);
  const outcome = coin ? ruleFor(basis, level, { price: coin.price, cap: coin.cap }) : null;
  const nowText = coin ? (basis === 'cap' ? (coin.cap !== null ? usdText(coin.cap, lang) : '—') : coin.price !== null ? priceText(coin.price, lang) : '—') : '—';
  const preview = outcome?.ok && level !== null ? (basis === 'cap' ? (outcome.rule.direction === 'above' ? a.capAbove(usdText(level, lang)) : a.capBelow(usdText(level, lang))) : outcome.rule.direction === 'above' ? a.priceAbove(levelText(level, lang)) : a.priceBelow(levelText(level, lang))) : null;

  const submit = async () => {
    if (!connection) {
      connect();
      return;
    }
    if (!coin || busy) return;
    if (!outcome || !outcome.ok) {
      setNote({ text: !outcome || outcome.code === 'LEVEL' ? a.noLevel : outcome.code === 'NOW' ? a.noNow : a.same, tone: 'down' });
      return;
    }
    setBusy(true);
    setNote(null);
    const made = await useAlerts.getState().create(connection, lang, { mint: coin.mint, rule: outcome.rule, cap: basis === 'cap' ? level : null });
    setBusy(false);
    if (made.ok) {
      setTyped('');
      setNote({ text: a.set, tone: 'ok' });
      onSet?.();
      return;
    }
    const free = digits(String(useAlerts.getState().view?.free ?? 3), lang);
    const text =
      made.refusal === 'declined'
        ? a.declined
        : made.refusal === 'limit'
          ? a.limit(free)
          : made.refusal === 'coin'
            ? a.coinRefused
            : made.refusal === 'price'
              ? a.unpriced
              : made.refusal === 'same'
                ? a.already
                : a.failed;
    setNote({ text, tone: 'down' });
  };

  const press = connection ? a.notify : a.connect;
  const free = view ? a.left(digits(String(view.left), lang), digits(String(view.free), lang)) : null;
  return (
    <div className={v.alertForm}>
      {fixed ? null : coin || reading ? (
        <div className={v.chosen}>
          {coin ? <CoinLogo {...logoOf(coin.mint, coin.icon)} symbol={coin.symbol} size="s" /> : <span className={v.boneDisc} aria-hidden="true" />}
          <span className={v.chosenSymbol}>{coin?.symbol ?? picked?.symbol ?? ''}</span>
          <span className={v.grow} />
          <Quiet
            size="s"
            onClick={() => {
              setPicked(null);
              setCoin(null);
              setNote(null);
              setTyped('');
            }}
          >
            {a.anotherCoin}
          </Quiet>
        </div>
      ) : (
        <CoinField
          onPick={(one) => {
            setNote(null);
            setPicked(one);
          }}
        />
      )}
      <Segment
        label={a.basis}
        value={basis}
        onChange={(next) => {
          setBasis(next);
          setTyped('');
          setNote(null);
        }}
        items={[
          { id: 'price', label: a.price },
          { id: 'cap', label: a.cap },
        ]}
      />
      <AmountField
        label={a.crosses}
        aside={a.now(nowText)}
        value={typed}
        onChange={(text) => {
          setTyped(text);
          setNote(null);
        }}
        unit="$"
      />
      <p className={v.note} data-tone={note?.tone === 'down' ? 'down' : note?.tone === 'ok' ? 'up' : undefined} role={note ? 'status' : undefined}>
        {note?.text ?? preview ?? ''}
      </p>
      {amber ? (
        <Action onClick={() => void submit()} busy={busy} disabled={Boolean(connection) && (!coin || reading)}>
          {press}
        </Action>
      ) : (
        <Quiet full onClick={() => void submit()} disabled={Boolean(connection) && (!coin || reading || busy)}>
          {press}
        </Quiet>
      )}
      <div className={v.formFoot}>
        <span className={v.dim}>{connection && free ? free : ''}</span>
        <Info label={a.how}>{a.howText(digits(String(view?.perHour ?? 20), lang))}</Info>
      </div>
    </div>
  );
}

/**
 * The coin page's own alert: a quiet «Alert» beside the coin, and under it the same form, for this coin. The page
 * mounts it where its head has room; it reads the coin's price and cap itself when the page does not hand them over.
 */
export function CoinAlert({ mint, symbol, price = null, cap = null }: { mint: string; symbol: string; price?: number | null; cap?: number | null }) {
  const a = useWords(ALERT_WORDS);
  const [open, setOpen] = useState(false);
  const [coin, setCoin] = useState<CoinNow | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    if (price !== null && cap !== null) {
      setCoin({ mint, symbol, name: '', icon: null, price, cap });
      return;
    }
    let live = true;
    void readCoin(mint).then((now) => {
      if (live) setCoin(now ?? { mint, symbol, name: '', icon: null, price, cap });
    });
    return () => {
      live = false;
    };
  }, [open, mint, symbol, price, cap]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
    };
  }, [open, close]);

  return (
    <span className={v.coinAlert} ref={wrap}>
      <Quiet size="s" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
        <Icon name="bell" size="s" />
        {a.alert}
      </Quiet>
      {open ? (
        <div id={id} className={v.pop} role="dialog" aria-label={a.alertOn(symbol)}>
          <Panel tone="soft" pad="m" gap={12}>
            <Title as="h2" className={v.popTitle}>
              {a.alertOn(symbol)}
            </Title>
            {coin ? <AlertForm fixed={coin} amber={false} /> : <span className={cx(v.bone, v.boneTall)} aria-hidden="true" />}
          </Panel>
        </div>
      ) : null}
    </span>
  );
}
