'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import type { Lang } from '@/city/lib/i18n/langs';
import { Action, Cell, CoinLogo, Icon, Quiet, QuietLink, Search, Table, TableHead, TableRow, amountOf, cx } from '@/terminal/ui';
import { addressIn, agoOf, coinPageHref, logoOf, shortAddress, walletHref, type Trade } from './watch-view';
import { WATCH_WORDS } from './words';
import v from './watch.module.css';

type W = (typeof WATCH_WORDS)['en'];

/** Copy a text; what was copied last, for two seconds. */
export function useCopy(): [string | null, (text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(text))
      .catch(() => undefined);
  };
  return [copied, copy];
}

/** A wallet's address as a trader reads it — the first four and the last four — and one tap copies it whole. */
export function AddressButton({ address, className }: { address: string; className?: string }) {
  const w = useWords(WATCH_WORDS);
  const [copied, copy] = useCopy();
  const done = copied === address;
  return (
    <Quiet size="s" className={cx(v.address, className)} aria-label={done ? w.copied : w.copyAddress} onClick={() => copy(address)}>
      <span className={v.addressText}>{shortAddress(address)}</span>
      {done ? <Icon name="check" size="s" /> : null}
    </Quiet>
  );
}

/** How long ago, in the screen's words; «—» when the chain did not say. */
export function agoText(at: number | null, now: number, w: W, lang: Lang): string {
  const ago = agoOf(at, now);
  if (!ago) return '—';
  const n = digits(String(ago.n), lang);
  return ago.unit === 's' ? w.agoS(n) : ago.unit === 'm' ? w.agoM(n) : ago.unit === 'h' ? w.agoH(n) : w.agoD(n);
}

/**
 * What a trade paid or got, in what it was paid with — one form for every row, the sum and then its ticker: «1.9 SOL»,
 * «165 USDC». Never turned into another money at today's price; a coin-for-coin trade has no such figure.
 */
export function tradeSum(trade: Trade, lang: Lang): string {
  if (trade.quoteAmount === null || trade.quote === null) return '—';
  const sum = trade.quoteAmount;
  const places = trade.quote === 'SOL' ? (sum < 1 ? 3 : 2) : sum < 100 ? 2 : 0;
  const text = sum > 0 && Number(sum.toFixed(places)) === 0 ? `<${amountOf(10 ** -places, places, lang)}` : amountOf(sum, places, lang);
  return `${text} ${trade.quote}`;
}

/** A coin's ticker as the chain gave it, or its address short. */
export const symbolOf = (trade: Readonly<{ symbol: string | null; mint: string }>): string => trade.symbol ?? shortAddress(trade.mint);

function CoinMark({ trade }: { trade: Trade }) {
  const logo = logoOf(trade.mint, trade.icon);
  const symbol = symbolOf(trade);
  return (
    <span className={v.coin}>
      <CoinLogo src={logo.src} also={logo.also} symbol={symbol} size="s" />
      <Link href={coinPageHref(trade.mint)} className={cx(v.over, v.coinLink)}>
        {symbol}
      </Link>
    </span>
  );
}

function Side({ side, w }: { side: Trade['side']; w: W }) {
  return (
    <span className={v.side} data-side={side}>
      {side === 'buy' ? w.bought : w.sold}
    </span>
  );
}

function Buy({ trade, w }: { trade: Trade; w: W }) {
  // The coin's own page: its ticket buys it — the terminal's one form, never one of this screen's.
  return (
    <span className={v.over}>
      <QuietLink size="s" href={coinPageHref(trade.mint)} className={v.buy}>
        <span aria-hidden="true">{w.buy}</span>
        <span className={v.hidden}>{w.buyCoin(symbolOf(trade))}</span>
      </QuietLink>
    </span>
  );
}

/**
 * Trades as rows: on a desk a table — who, the coin, bought or sold, for how much, when, and «Buy» — on a phone one
 * row each, the same facts in two lines. `who` — the wallets' names (the feed); without it the rows are one wallet's.
 */
export function Trades({ rows, now, lang, phone, who = true, buy = true, label }: { rows: readonly (Trade & { who?: string })[]; now: number; lang: Lang; phone: boolean; who?: boolean; /** Each row's «Buy» — off where the screen's own action is another. */ buy?: boolean; label: string }) {
  const w = useWords(WATCH_WORDS);
  if (phone) {
    return (
      <ul className={v.phoneRows} aria-label={label}>
        {rows.map((row) => {
          const logo = logoOf(row.mint, row.icon);
          return (
            <li key={row.key} className={v.phoneRow}>
              <CoinLogo src={logo.src} also={logo.also} symbol={symbolOf(row)} />
              <span className={v.phoneMain}>
                <span className={v.phoneTop}>
                  <Side side={row.side} w={w} />
                  <Link href={coinPageHref(row.mint)} className={v.coinLink}>
                    {symbolOf(row)}
                  </Link>
                </span>
                <span className={v.phoneSub}>
                  {who && row.who ? (
                    <Link href={walletHref(row.wallet)} className={v.whoLink}>
                      {row.who}
                    </Link>
                  ) : null}
                  <span>{tradeSum(row, lang)}</span>
                  <span>{agoText(row.at, now, w, lang)}</span>
                </span>
              </span>
              {buy ? <Buy trade={row} w={w} /> : null}
            </li>
          );
        })}
      </ul>
    );
  }
  const columns = who ? 'minmax(132px, 1.2fr) minmax(132px, 1.3fr) 84px minmax(96px, 1fr) 64px 92px' : 'minmax(132px, 1.4fr) 84px minmax(96px, 1fr) 72px 92px';
  return (
    <Table columns={columns} minWidth={who ? 640 : 520} label={label}>
      <TableHead>
        {who ? <Cell head>{w.who}</Cell> : null}
        <Cell head>{w.coin}</Cell>
        <Cell head>{w.trade}</Cell>
        <Cell head end>
          {w.amount}
        </Cell>
        <Cell head end>
          {w.when}
        </Cell>
        <Cell head />
      </TableHead>
      {rows.map((row) => (
        <TableRow key={row.key}>
          {who ? (
            <Cell href={walletHref(row.wallet)} className={v.whoCell}>
              {row.who ?? shortAddress(row.wallet)}
            </Cell>
          ) : null}
          <Cell>
            <CoinMark trade={row} />
          </Cell>
          <Cell>
            <Side side={row.side} w={w} />
          </Cell>
          <Cell end>{tradeSum(row, lang)}</Cell>
          <Cell end tone="dim">
            {agoText(row.at, now, w, lang)}
          </Cell>
          <Cell end>
            <Buy trade={row} w={w} />
          </Cell>
        </TableRow>
      ))}
    </Table>
  );
}

/** The rows' place while a read is on its way: the same height, nothing pressable. */
export function RowBones({ n = 5, label }: { n?: number; label: string }) {
  return (
    <div className={v.bones} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: n }, (_, at) => (
        <span key={at} className={v.boneRow} aria-hidden="true">
          <span className={v.boneDisc} />
          <span className={v.bone} />
          <span className={v.grow} />
          <span className={cx(v.bone, v.boneShort)} />
        </span>
      ))}
    </div>
  );
}

/**
 * «Paste a wallet address» and «Watch»: an address or a link with one in it; what is not one is said in one line and
 * nothing is asked of the engine. The name comes after, on the wallet's own page. `amber` — the screen's one action;
 * elsewhere the same form is quiet.
 */
export function AddWallet({ onAdd, amber = true, busy = false, note }: { onAdd: (address: string) => void; amber?: boolean; busy?: boolean; note?: string | null }) {
  const w = useWords(WATCH_WORDS);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const address = addressIn(typed);
    if (!address) {
      setBad(typed.trim().length > 0);
      return;
    }
    setBad(false);
    setTyped('');
    onAdd(address);
  };
  const line = bad ? w.badAddress : (note ?? null);
  return (
    <form className={v.add} onSubmit={submit} noValidate data-bad={bad ? '' : undefined}>
      <div className={v.addRow}>
        <Search
          value={typed}
          placeholder={w.pasteAddress}
          onChange={(text) => {
            setTyped(text);
            if (bad) setBad(false);
          }}
        />
        {amber ? (
          <Action type="submit" size="m" busy={busy}>
            {w.follow}
          </Action>
        ) : (
          <Quiet type="submit" full>
            {w.follow}
          </Quiet>
        )}
      </div>
      <p className={v.note} role={line ? 'alert' : undefined} data-tone={bad || note ? 'down' : undefined}>
        {line ?? ''}
      </p>
    </form>
  );
}
