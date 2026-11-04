'use client';

import { useEffect, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { cleanAmount } from '@/city/lib/money/amount';
import { proveWallet } from '@/city/lib/trade/proof';
import { USDC } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { CopyButton } from './bits';
import { MONEY } from './words';
import s from './money.module.css';

/** One link as the engine answers it (`/api/v1/pay/requests`, contract 1.22.0) — only what the window shows. */
type Link = Readonly<{
  id: string;
  url: string;
  status: string;
  token: Readonly<{ symbol: string }>;
  amount: Readonly<{ display: string }> | null;
}>;

const COINS = [
  { key: 'USDC', mint: USDC.mint },
  { key: 'SOL', mint: null },
] as const;

const ENDPOINT = '/api/v1/pay/requests';

/** The engine, with the wallet's proof: a missing proof is asked for once, by one signed message, then the ask again. */
async function withProof(connection: Readonly<{ wallet: string; address: string }>, ask: () => Promise<Response>): Promise<Response | 'declined'> {
  const first = await ask();
  if (first.status !== 401) return first;
  const proof = await proveWallet(connection);
  if (!proof.ok) return proof.state === 'declined' ? 'declined' : first;
  return ask();
}

/**
 * Pay link: ask for a payment — a sum in USDC or SOL — and copy the link to send it. The
 * engine is `lib/pay/**` behind `/api/v1/pay/requests`: the link always pays the proven wallet, never another, and
 * nothing here moves money. The payer's page is a window of the city on the same engine (`/pay/<id>`, CITY-156).
 */
export function PayLink({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const [coin, setCoin] = useState<(typeof COINS)[number]>(COINS[0]);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<'idle' | 'creating'>('idle');
  const [made, setMade] = useState<Link | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [recent, setRecent] = useState<readonly Link[]>([]);

  // The wallet's own links, when its proof is already here: never asks the wallet by itself.
  useEffect(() => {
    let live = true;
    void fetch(ENDPOINT, { credentials: 'same-origin' })
      .then((answer) => (answer.ok ? answer.json() : null))
      .then((body: { links?: Link[] } | null) => {
        if (live && body?.links) setRecent(body.links.slice(0, 3));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [owner, made]);

  const amount = cleanAmount(typed);
  const ready = phase === 'idle' && Boolean(connection) && amount !== '' && Number(amount) > 0;

  const create = async () => {
    if (!connection || !ready) return;
    setPhase('creating');
    setLine(null);
    try {
      const answer = await withProof(connection, () =>
        fetch(ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mint: coin.mint, amount }),
        }),
      );
      if (answer === 'declined') return setLine(w.payProveDeclined);
      const body = (await answer.json().catch(() => null)) as { link?: Link } | null;
      if (!answer.ok || !body?.link) return setLine(w.payFailed);
      setMade(body.link);
      setTyped('');
    } catch {
      setLine(w.payFailed);
    } finally {
      setPhase('idle');
    }
  };

  return (
    <section className={s.tabBody} aria-label={w.payAsk}>
      <span className={s.label}>{w.payCoin}</span>
      <div className={s.segment} role="radiogroup" aria-label={w.payCoin}>
        {COINS.map((option) => (
          <button key={option.key} type="button" role="radio" aria-checked={coin.key === option.key} className={coin.key === option.key ? s.segmentOn : ''} onClick={() => setCoin(option)}>
            {option.key}
          </button>
        ))}
      </div>
      <label className={s.label} htmlFor="money-pay-amount">
        {w.payAmount}
      </label>
      <input
        id="money-pay-amount"
        className={s.input}
        inputMode="decimal"
        value={fieldText(typed, lang)}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={digits('0.00')}
        autoComplete="off"
      />
      {line ? <p className={s.note}>{line}</p> : null}
      <button type="button" className={`${s.display} ${s.action}`} disabled={!ready} onClick={() => void create()}>
        {phase === 'creating' ? w.payCreating : w.payCreate}
      </button>
      {made ? (
        <div className={s.payMade} data-pay-made="">
          <b>
            {made.amount ? digits(made.amount.display) : ''} {made.token.symbol}
          </b>
          <p className={s.payUrl} translate="no">
            {made.url}
          </p>
          <CopyButton value={made.url} label={w.payCopy} primary />
        </div>
      ) : null}
      {recent.length ? (
        <>
          <span className={s.label}>{w.payRecent}</span>
          <ul className={s.rows}>
            {recent.map((link) => (
              <li key={link.id} className={s.row}>
                <span className={s.names}>
                  <b>
                    {link.amount ? digits(link.amount.display) : ''} {link.token.symbol}
                  </b>
                  <span>{w.payStatus(link.status)}</span>
                </span>
                <span />
                <CopyButton value={link.url} label={w.payCopy} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
