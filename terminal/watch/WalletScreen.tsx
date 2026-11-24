'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { useWallet } from '@/city/lib/trade/wallet';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Action, ActionBody, Chip, CoinLogo, Figure, Info, Kick, Page, PageHead, Panel, Quiet, QuietLink, Search, SwitchRow, Tile, Title, amountOf, cx, usdText } from '@/terminal/ui';
import { useFollows } from './follows';
import { AddressButton, RowBones, Trades } from './parts';
import { rereadWallet, useWalletRead } from './wallet-reads';
import { addressIn, coinPageHref, isAddress, logoOf, nameOf, portfolioHref, resultShown, shareText, shortAddress, tradeIcons, walletHref, WALLET_LABELS, type WalletRead } from './watch-view';
import { useHolds, type HoldsRead } from './useHolds';
import { WALLET_WORDS, WATCH_WORDS } from './words';
import sw from '@/terminal/swap/swap.module.css';
import v from './watch.module.css';

type WW = (typeof WALLET_WORDS)['en'];

/** The latest trades a wallet's page lists; a phone shows the first of them, the rest on a tap. */
const TRADES_SHOWN = 20;
const PHONE_TRADES = 8;

/** SOL with its sign, as a result reads: +1.204, −0.35. */
function solSigned(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  const sign = value > 0.0005 ? '+' : value < -0.0005 ? '−' : '';
  return `${sign}${amountOf(abs, abs < 10 ? 3 : 2, lang)}`;
}

const toneOf = (value: number | null): 'up' | 'down' | undefined => (value === null ? undefined : value > 0.0005 ? 'up' : value < -0.0005 ? 'down' : undefined);

/** Another address: the wallet's page opens on it. */
function GoWallet() {
  const w = useWords(WATCH_WORDS);
  const ww = useWords(WALLET_WORDS);
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = addressIn(typed);
    if (!address) {
      setBad(typed.trim().length > 0);
      return;
    }
    router.push(walletHref(address));
  };
  return (
    <form className={v.add} onSubmit={submit} noValidate data-bad={bad ? '' : undefined}>
      <div className={v.addRow}>
        <Search
          value={typed}
          placeholder={w.pasteAddress}
          onChange={(text) => {
            setTyped(text);
            setBad(false);
          }}
        />
        <Action type="submit" size="m">
          {ww.openWallet}
        </Action>
      </div>
      <p className={v.note} role={bad ? 'alert' : undefined} data-tone={bad ? 'down' : undefined}>
        {bad ? w.badAddress : ''}
      </p>
    </form>
  );
}

/**
 * The result: one figure in SOL and the four facts under it. Where the engine calls no result — not all the turnover is
 * priced — the figure is what is known, the sum of «Closed» and «Still held», with the share priced beside it and the why
 * behind the «i»; «—» only when nothing is priced, never a zero.
 */
function Result({ read, ww, lang }: { read: WalletRead; ww: WW; lang: Lang }) {
  const r = read.result;
  const shown = resultShown(r);
  const usd = shown.value !== null && read.solUsd ? usdText(Math.abs(shown.value * read.solUsd), lang) : null;
  const share = shown.priced !== null ? digits(shareText(shown.priced), lang) : null;
  const all = r.wins + r.losses;
  // A month by its name in Ukrainian: «лист.» beside a small «з» read as «3 20».
  const since = read.oldestAt !== null ? dateText(read.oldestAt * 1000, { day: 'numeric', month: lang === 'uk' ? 'long' : 'short', year: 'numeric' }, lang) : null;
  const why = [share ? ww.pricedText(share) : null, ww.howResultText, r.approx ? ww.approxText : null].filter(Boolean).join(' ');
  return (
    <div className={v.result}>
      <div className={v.resultHead}>
        <Kick>{ww.result}</Kick>
        {since ? <span className={v.dim}>{ww.since(since)}</span> : null}
        <Info label={ww.howResult}>{why}</Info>
      </div>
      <div className={v.resultFigure} aria-label={ww.resultLabel}>
        <Figure value={shown.value !== null ? solSigned(shown.value, lang) : '—'} unit={shown.value !== null ? 'SOL' : undefined} tone={toneOf(shown.value)} />
        {usd ? <span className={v.dim}>{ww.usd(usd)}</span> : null}
        {share ? <Chip>{ww.priced(share)}</Chip> : null}
      </div>
      <div className={v.tiles}>
        <Tile label={ww.realized} value={r.realized !== null ? solSigned(r.realized, lang) : '—'} unit={r.realized !== null ? 'SOL' : undefined} tone={toneOf(r.realized)} />
        <Tile label={ww.open} value={r.unrealized !== null ? solSigned(r.unrealized, lang) : '—'} unit={r.unrealized !== null ? 'SOL' : undefined} tone={toneOf(r.unrealized)} />
        <Tile label={ww.trades} value={r.trades !== null ? digits(String(r.trades), lang) : '—'} />
        <Tile
          label={ww.inProfit}
          value={
            all > 0 ? (
              // «з» between the figures in the figures' face reads as «3»: the word stands in the words' face, quiet.
              <>
                {digits(String(r.wins), lang)}
                <span className={v.of}>{ww.of}</span>
                {digits(String(all), lang)}
              </>
            ) : (
              '—'
            )
          }
        />
      </div>
    </div>
  );
}

/** «Watch» and, once watched, its name, its notes and «Stop watching». */
function FollowBlock({ address }: { address: string }) {
  const w = useWords(WATCH_WORDS);
  const ww = useWords(WALLET_WORDS);
  const lang = useLang();
  const follow = useFollows((st) => st.list.find((row) => row.address === address) ?? null);
  const mode = useFollows((st) => st.mode);
  const notes = useFollows((st) => st.notes[address] ?? true);
  const note = useFollows((st) => st.note);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(follow?.name ?? '');
  const stored = follow?.name ?? '';
  useEffect(() => setName(stored), [stored]);

  const add = async () => {
    if (busy) return;
    setBusy(true);
    await useFollows.getState().add(address, null, lang, w.creatorOf);
    setBusy(false);
  };
  const failed = note === 'failed' ? w.failed : note === 'full' ? w.full(digits('20', lang)) : null;
  if (!follow) {
    return (
      <div className={v.follow}>
        <Action onClick={() => void add()} busy={busy}>
          {w.follow}
        </Action>
        <p className={v.note} role={failed ? 'alert' : undefined} data-tone={failed ? 'down' : undefined}>
          {failed ?? ''}
        </p>
      </div>
    );
  }
  const changed = (nameOf(name) ?? '') !== stored;
  return (
    <div className={v.follow}>
      <div className={v.followRow}>
        <Chip tone="ok" dot>
          {w.following}
        </Chip>
        <span className={v.grow} />
        <Quiet size="s" onClick={() => void useFollows.getState().remove(address, lang)}>
          {w.unfollow}
        </Quiet>
      </div>
      <form
        className={v.nameRow}
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) void useFollows.getState().rename(address, name, lang);
        }}
      >
        <label className={cx(sw.big, v.nameField)}>
          <span className={sw.bigHead}>
            <Kick>{ww.nameIt}</Kick>
          </span>
          <input className={sw.text} value={name} maxLength={32} placeholder={ww.nameHint} onChange={(event) => setName(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {changed ? (
          <Quiet type="submit" size="s">
            {ww.save}
          </Quiet>
        ) : null}
      </form>
      {mode === 'server' ? <SwitchRow label={w.notesOn} on={notes} onChange={(on) => void useFollows.getState().setNotes(address, on, lang)} /> : null}
      <p className={v.note} role={failed ? 'alert' : undefined} data-tone={failed ? 'down' : undefined}>
        {failed ?? ''}
      </p>
    </div>
  );
}

/**
 * What the wallet holds now, the biggest first; the whole of it in the portfolio. A coin the wallet traded is drawn by
 * the picture its trades gave. `retry` — its own «Try again» when only this read fell; when the wallet's read fell too,
 * the page's one «Try again» reads both.
 */
function HoldsPanel({ address, read, icons, retry }: { address: string; read: HoldsRead; icons: ReadonlyMap<string, string>; retry: boolean }) {
  const w = useWords(WATCH_WORDS);
  const ww = useWords(WALLET_WORDS);
  const lang = useLang();
  const holds = read.holds;
  return (
    <Panel pad="l" gap={16} edge className={v.holds}>
      <div className={v.panelTop}>
        <Title as="h2" className={v.panelTitle}>
          {ww.holds}
        </Title>
        <span className={v.grow} />
        {holds?.usd !== null && holds?.usd !== undefined ? <Figure value={usdText(holds.usd, lang)} size="s" /> : null}
      </div>
      {read.status === 'reading' && !holds ? (
        <RowBones n={4} label={ww.holds} />
      ) : !holds ? (
        <div className={v.failRow}>
          <span className={v.line}>{ww.holdsUnread}</span>
          {retry ? (
            <Quiet size="s" onClick={read.again}>
              {w.again}
            </Quiet>
          ) : null}
        </div>
      ) : holds.rows.length === 0 ? (
        <p className={v.line}>{ww.holdsEmpty}</p>
      ) : (
        <ul className={v.holdRows} aria-label={ww.holds}>
          {holds.rows.map((row) => {
            const symbol = row.symbol ?? row.label ?? (row.mint ? shortAddress(row.mint) : '—');
            const logo = row.mint ? logoOf(row.mint, icons.get(row.mint) ?? null) : null;
            return (
              <li key={row.id} className={v.holdRow}>
                <CoinLogo src={logo?.src ?? null} also={logo?.also} symbol={symbol} size="s" eager />
                {row.mint ? (
                  <Link href={coinPageHref(row.mint)} className={v.holdName}>
                    {symbol}
                  </Link>
                ) : (
                  <span className={v.holdName}>{symbol}</span>
                )}
                <span className={v.dim}>{row.amount !== null ? amountOf(row.amount, row.amount < 1 ? 4 : 2, lang) : ''}</span>
                <span className={v.holdUsd}>{row.usd !== null ? usdText(row.usd, lang) : '—'}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className={v.panelFoot}>
        {holds && holds.more > 0 ? <span className={v.dim}>{ww.more(digits(String(holds.more), lang))}</span> : null}
        <span className={v.grow} />
        <QuietLink size="s" href={portfolioHref(address)}>
          {ww.portfolio}
        </QuietLink>
      </div>
    </Panel>
  );
}

/**
 * Any wallet of Solana on its own page, instead of an explorer: what it holds (the portfolio's read by address), what it
 * traded lately and its result (the chain's record of its trades, the honest count), and one press — «Watch». A text
 * that is no address, or a coin's address, is a state of the page with a way on, never an error. Reads only.
 */
export function WalletScreen({ address }: { address: string }) {
  const w = useWords(WATCH_WORDS);
  const ww = useWords(WALLET_WORDS);
  const lang = useLang();
  const phone = useNarrow();
  const router = useRouter();
  const valid = isAddress(address);
  const entry = useWalletRead(valid ? address : null, 30_000);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const name = useFollows((st) => st.list.find((row) => row.address === address)?.name ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [allTrades, setAllTrades] = useState(false);

  // The list of watched wallets follows the connected wallet; this page only reads it and adds to it.
  useEffect(() => useFollows.getState().hydrate(), []);
  useEffect(() => {
    void useFollows.getState().follow(owner, lang);
    // The language changes no wallet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const answer = entry?.answer ?? null;
  const state = !valid || answer?.kind === 'bad' ? 'bad' : !answer ? 'reading' : answer.kind;
  const title = name ?? ww.wallet;

  const read = answer?.kind === 'wallet' ? answer.read : null;
  const coin = answer?.kind === 'coin' ? answer : null;
  // What it holds is read for a wallet only: a coin's address or a text that is no address asks nothing of the portfolio.
  const holds = useHolds(state !== 'bad' && !coin ? address : null);
  const icons = useMemo(() => tradeIcons(read?.trades ?? []), [read]);
  // The wallet's read fell: one line where the result stands and one «Try again» for the whole page — its trades are not
  // drawn as bones that never fill, and what it holds asks no second «Try again» of its own.
  const fell = !read && (state === 'busy' || state === 'unread');
  const again = () => {
    rereadWallet(address);
    if (holds.status === 'failed') holds.again();
  };
  const trades = read ? read.trades.slice(0, phone && !allTrades ? PHONE_TRADES : TRADES_SHOWN) : [];
  const moreTrades = phone && !allTrades && read !== null && Math.min(read.trades.length, TRADES_SHOWN) > PHONE_TRADES;
  return (
    <Page data-wallet-screen="" data-state={state === 'bad' ? 'bad' : coin ? 'coin' : read ? 'live' : state}>
      <PageHead title={state === 'bad' || coin ? ww.wallet : title} />
      {state === 'bad' ? (
        <ActionBody>
          <Panel tone="hi" pad="l" gap={16} edge className={v.statePanel}>
            <Title as="h2" className={v.panelTitle}>
              {ww.notWallet}
            </Title>
            <p className={v.line}>{ww.notWalletLine}</p>
            <GoWallet />
          </Panel>
        </ActionBody>
      ) : coin ? (
        <ActionBody>
          <Panel tone="hi" pad="l" gap={16} edge className={v.statePanel}>
            <div className={v.coinHead}>
              <CoinLogo {...logoOf(coin.mint, null)} symbol={coin.symbol} size="l" />
              <Title as="h2" className={v.panelTitle}>
                {ww.isCoin(coin.symbol)}
              </Title>
            </div>
            <div className={v.stateActs}>
              <Action size="m" full={false} onClick={() => router.push(coinPageHref(coin.mint))}>
                {ww.openCoin}
              </Action>
              {coin.creator ? <QuietLink href={walletHref(coin.creator)}>{ww.creatorWallet}</QuietLink> : null}
            </div>
          </Panel>
        </ActionBody>
      ) : (
        <ActionBody className={v.walletBody} side={<HoldsPanel address={address} read={holds} icons={icons} retry={!fell} />} sideLabel={ww.holds}>
          <Panel tone="hi" pad="l" gap={20} edge className={v.hero}>
            <div className={v.heroTop}>
              <AddressButton address={address} />
              {read
                ? WALLET_LABELS.filter((label) => read.badges[label] > 0).map((label) => (
                    <Chip key={label} tone="warn">
                      {ww[label](digits(String(read.badges[label]), lang))}
                    </Chip>
                  ))
                : null}
            </div>
            {read ? (
              <Result read={read} ww={ww} lang={lang} />
            ) : state === 'reading' ? (
              <RowBones n={3} label={ww.reading} />
            ) : (
              <div className={v.failRow}>
                <span className={v.line} data-tone="down">
                  {state === 'busy' ? ww.busy : ww.unread}
                </span>
                <Quiet size="s" onClick={again}>
                  {w.again}
                </Quiet>
              </div>
            )}
            <FollowBlock address={address} />
          </Panel>
          {fell ? null : (
            <Panel pad="none" edge className={v.tradesPanel}>
              <div className={v.panelHead}>
                <Title as="h2" className={v.panelTitle}>
                  {ww.latest}
                </Title>
              </div>
              {read ? (
                read.trades.length > 0 ? (
                  <>
                    <Trades rows={trades} now={now} lang={lang} phone={phone} who={false} label={ww.latest} />
                    {moreTrades ? (
                      <div className={v.more}>
                        <Quiet full onClick={() => setAllTrades(true)}>
                          {ww.moreTrades}
                        </Quiet>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={cx(v.line, v.pad)}>{ww.noTrades}</p>
                )
              ) : (
                <div className={v.pad}>
                  <RowBones label={ww.reading} />
                </div>
              )}
            </Panel>
          )}
        </ActionBody>
      )}
    </Page>
  );
}
