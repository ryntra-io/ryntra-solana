'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { citySigner } from '@/city/lib/app-bridge/route';
import { BRAND } from '@/city/lib/brand';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText } from '@/city/lib/i18n/figures';
import { hydrateLang, LANG_LABEL, LANGS, setLang, useLang, useLangStore, type Lang } from '@/city/lib/i18n/lang';
import {
  askedSum,
  costsOf,
  figure,
  noteOf,
  payRequest,
  readRequest,
  READ_EVERY_MS,
  READ_PENDING_MS,
  shownStatus,
  stillOpen,
  typedAmount,
  type FetchLike,
  type Note,
  type PayPhase,
  type Shown,
  type Stop,
  type View,
} from '@/city/lib/pay/flow';
import { PAY } from '@/city/lib/pay/words';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import type { WalletConnection } from '@/lib/solana/wallet.client';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { isPhoneUserAgent, phantomBrowseUrl, PHANTOM_DOWNLOAD_URL, solflareBrowseUrl } from '@/lib/solana/open-in-wallet';
import { skrNameFor } from '@/lib/solana/skr.client';
import { Mark } from '../hud/Mark';
import { CoinIcon, Terms } from '../money/bits';
import m from '../money/money.module.css';
import s from './pay.module.css';

type Words = (typeof PAY)['en'];
type Phase = 'idle' | 'connecting' | PayPhase;

/** Each reason a payment stopped, by its line in the dictionary. */
const STOP_WORD: Readonly<Record<Stop, keyof Words>> = {
  self: 'selfPay',
  refused: 'nothingSigned',
  wallet: 'walletFailed',
  aged: 'tooSlow',
  paid: 'alreadyPaid',
  ended: 'linkEnded',
  onItsWay: 'alreadyOnItsWay',
  needAmount: 'needAmount',
  badAmount: 'badAmount',
  network: 'networkRefused',
  paused: 'paused',
  changed: 'changed',
  unclear: 'noAnswer',
  failed: 'failed',
};

const STATUS_WORD: Readonly<Record<Shown, keyof Words>> = {
  awaiting: 'waiting',
  pending: 'onItsWay',
  paid: 'paid',
  expired: 'expired',
  checking: 'checking',
};

/** Stops after which the engine knows something new about the request: read it at once. */
const READ_AFTER: ReadonlySet<Stop> = new Set(['paid', 'ended', 'onItsWay', 'unclear']);

const browserFetch: FetchLike = (url, init) => fetch(url, init);

const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

/** A still of our own live city behind the window (`public/city/art/`): filmed from the 3D scene, never generated. */
const BACKDROP = { small: '/city/art/district-harbor-800.webp', large: '/city/art/district-harbor-1600.webp' } as const;

/**
 * The payer's page (CITY-156): `/pay/<id>` as one window of the city. It says what is asked — the sum and the coin, for
 * what, to whom (the `.skr` name when the wallet chose one) — the status the engine reports, and offers one amber
 * action: pay from the wallet in this browser. A computer also shows the page's code for a phone; a phone without a
 * wallet opens the page in one. Once paid, the window is the receipt. Everything on it comes from the engine's public
 * read (`lib/pay/**`); the status changes only through the same read.
 */
export function PayerPage({ initial, qr, pageUrl }: { initial: View; qr: string | null; pageUrl: string }) {
  const w = useWords(PAY);
  const lang = useLang();
  const ready = useLangStore((st) => st.ready);
  const [view, setView] = useState<View>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stop, setStop] = useState<Stop | null>(null);
  const [typed, setTyped] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [asked, setAsked] = useState(false);
  const [phone, setPhone] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const inFlight = useRef(false);

  const wallets = useWallet((st) => st.wallets);
  const connection = useWallet((st) => st.connection);
  const walletError = useWallet((st) => st.error);

  const request = view.request;
  const id = request.id;

  useLayoutEffect(() => void hydrateLang(), []);

  useEffect(() => {
    startWallets();
    setPhone(isPhoneUserAgent(navigator.userAgent));
  }, []);

  // The recipient's `.skr` name: a label read once for the page, never where the money goes (the full address pays).
  useEffect(() => {
    let live = true;
    void skrNameFor(request.recipient.address).then((found) => live && setName(found));
    return () => {
      live = false;
    };
  }, [request.recipient.address]);

  const read = useCallback(async () => {
    const next = await readRequest(browserFetch, id);
    if (next === 'gone') return setGone(true);
    if (!next) return;
    setView(next);
    if (next.request.status === 'PAID') setPending(null);
  }, [id]);

  // The truth is the engine's: while a payment can still arrive, ask again; stop the moment it is paid or ended.
  const open = stillOpen(request.status) || pending !== null;
  useEffect(() => {
    if (!open || gone) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void read();
    }, pending ? READ_PENDING_MS : READ_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [open, gone, pending, read]);

  /** The payment from this wallet: the engine builds it now, the wallet signs, the engine sends it once. */
  const payFrom = useCallback(
    async (wallet: WalletConnection) => {
      const amount = typedAmount(request, typed);
      if (!amount.ok) return setStop(amount.why === 'empty' ? 'needAmount' : 'badAmount');
      const outcome = await payRequest(
        {
          fetch: browserFetch,
          sign: (wire) => citySigner.signTransaction({ wallet: wallet.wallet, address: wallet.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
          onPhase: setPhase,
        },
        { id: request.id, payer: wallet.address, amount: request.amount ? null : amount.text },
      );
      if (outcome.kind === 'sent') {
        setPending(outcome.signature);
        if (outcome.view) setView(outcome.view);
      } else {
        setStop(outcome.stop);
        if (READ_AFTER.has(outcome.stop)) void read();
      }
    },
    [read, request, typed],
  );

  /** One press at a time: a second tap while the wallet is asked does nothing. */
  const once = useCallback(async (run: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await run();
    } finally {
      inFlight.current = false;
      setPhase('idle');
    }
  }, []);

  /** A wallet this browser has, connected from the tap, then the payment at once: one press, the wallet asks twice. */
  const connectAndPay = useCallback(
    (walletName: string) =>
      once(async () => {
        setChoosing(false);
        setPhase('connecting');
        const ok = await useWallet.getState().connect(walletName);
        const now = useWallet.getState().connection;
        if (ok && now) await payFrom(now);
      }),
    [once, payFrom],
  );

  const act = () => {
    if (inFlight.current) return;
    setStop(null);
    const amount = typedAmount(request, typed);
    if (!amount.ok) return setStop(amount.why === 'empty' ? 'needAmount' : 'badAmount');
    if (connection) return void once(() => payFrom(connection));
    if (wallets.length === 1) return void connectAndPay(wallets[0]!.name);
    if (wallets.length > 1) return setChoosing(true);
    setAsked(true);
  };

  if (gone) return <Missing />;

  const shown = shownStatus(request.status, pending !== null);
  const canPay = shown === 'awaiting' || shown === 'checking';
  const busy = phase !== 'idle';
  const note = noteOf(request);
  const costs = costsOf(request.token);
  const sum = askedSum(request);
  const typedNow = typedAmount(request, typed);
  const paySum = sum ?? (typedNow.ok && typedNow.text ? `${figure(typedNow.raw, request.token.decimals)} ${request.token.symbol}` : null);
  const who = name ? (
    <>
      <b translate="no">{name}</b>
      <span className={s.address} translate="no">
        · {short(request.recipient.address)}
      </span>
    </>
  ) : (
    <b className={s.address} translate="no" title={request.recipient.address}>
      {short(request.recipient.address)}
    </b>
  );
  const when = (iso: string, full = false) =>
    ready ? dateText(new Date(iso), full ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, lang) : '';
  // With no wallet here: a phone opens this page inside a wallet app; a computer pays by the code, or gets a wallet.
  const noWallet = !connection && wallets.length === 0 && (phone || asked);
  const actionWord =
    phase === 'connecting' ? w.opening : phase === 'preparing' ? w.preparing : phase === 'wallet' ? w.confirm : phase === 'sending' ? w.sending : paySum ? w.pay(digits(paySum, lang)) : w.payPlain;

  return (
    <Frame>
      <section className={`${s.window} ${canPay && qr ? '' : s.single}`} aria-labelledby="pay-title">
        <Chrome title={shown === 'paid' ? w.receipt : w.request} status={<Status shown={shown} label={w[STATUS_WORD[shown]] as string} />}>
          <div className={s.body}>
            <div className={s.main}>
              <div className={s.sum}>
                <CoinIcon mint={request.token.mint} size={40} symbol={request.token.symbol} />
                <Figure request={request} shown={shown} anyAmount={w.anyAmount} />
              </div>

              <div className={s.facts}>
                {request.description ? <p className={s.what}>{request.description}</p> : null}
                <p className={s.who}>
                  <span>{w.to}</span>
                  {who}
                </p>
                {note ? <p className={`${m.note} ${m.noteWarn}`}>{noteLine(note, w, lang)}</p> : null}
              </div>

              {canPay ? (
                <>
                  {!request.amount ? (
                    <label className={s.field}>
                      <span className={s.fieldLabel}>{w.amount}</span>
                      <span className={s.amountBox}>
                        <input
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder={digits('0.00', lang)}
                          value={fieldText(typed, lang)}
                          onChange={(event) => setTyped(event.target.value)}
                          disabled={busy}
                          translate="no"
                        />
                        <span translate="no">{request.token.symbol}</span>
                      </span>
                    </label>
                  ) : null}

                  <Terms
                    label={w.feeDetails}
                    line={
                      <>
                        {w.fee} <b>{digits(w.feeFrom(costs.networkSol), lang)}</b> · {w.noRyntraFee}
                      </>
                    }
                  >
                    <dt>{w.youPay}</dt>
                    <dd>{paySum ? digits(paySum, lang) : w.anyAmount}</dd>
                    <dt>{w.fee}</dt>
                    <dd>{digits(w.feeFrom(costs.networkSol), lang)}</dd>
                    <dt>{w.ryntraFee}</dt>
                    <dd>{w.zero}</dd>
                    {costs.opensAccount ? (
                      <>
                        <dt>{w.theirAccount}</dt>
                        <dd>{digits(costs.classic ? w.upTo(costs.accountSol) : w.feeFrom(costs.accountSol), lang)}</dd>
                      </>
                    ) : null}
                    {costs.opensAccount && !costs.classic ? (
                      <>
                        <dt>{w.coinFee}</dt>
                        <dd>{w.coinFeeIfAny}</dd>
                      </>
                    ) : null}
                    <dt>{w.toAddress}</dt>
                    <dd translate="no">
                      {name ? <b>{name} · </b> : null}
                      {request.recipient.address}
                    </dd>
                    {request.token.mint ? (
                      <>
                        <dt>{w.coin}</dt>
                        <dd translate="no">{request.token.mint}</dd>
                      </>
                    ) : null}
                  </Terms>

                  {stop ? (
                    <p className={`${m.note} ${m.noteError}`} role="alert">
                      {w[STOP_WORD[stop]] as string}
                    </p>
                  ) : walletError && !busy ? (
                    <p className={`${m.note} ${m.noteError}`} role="alert">
                      {walletError}
                    </p>
                  ) : null}

                  <div className={s.act}>
                    {choosing ? (
                      <div className={m.wallets} role="group" aria-label={w.chooseWallet}>
                        {wallets.map((wallet) => (
                          <button key={wallet.name} type="button" className={m.walletButton} onClick={() => void connectAndPay(wallet.name)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
                            {wallet.name}
                          </button>
                        ))}
                      </div>
                    ) : noWallet && phone ? (
                      <>
                        <a className={`${m.display} ${m.action}`} href={phantomBrowseUrl(pageUrl, origin(pageUrl))}>
                          {w.openInPhantom}
                        </a>
                        <div className={s.ways}>
                          <a className={`${m.display} ${m.secondary} ${s.way}`} href={solflareBrowseUrl(pageUrl, origin(pageUrl))}>
                            {w.openInSolflare}
                          </a>
                          <a className={`${m.display} ${m.secondary} ${s.way}`} href={view.payUrl}>
                            {w.otherWallet}
                          </a>
                        </div>
                      </>
                    ) : noWallet ? (
                      <a className={`${m.display} ${m.secondary} ${s.way}`} href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                        {w.getPhantom}
                      </a>
                    ) : (
                      <button type="button" className={`${m.display} ${m.action} ${busy ? m.waiting : ''}`} disabled={busy} onClick={act} data-pay-action="">
                        {actionWord}
                      </button>
                    )}
                  </div>

                  <div className={s.foot}>
                    <span className={s.when}>{when(request.expiresAt) ? w.until(when(request.expiresAt)) : null}</span>
                    {connection ? (
                      <span>
                        {w.from(short(connection.address))} ·{' '}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setStop(null);
                            useWallet.getState().disconnect();
                          }}
                        >
                          {w.change}
                        </button>
                      </span>
                    ) : null}
                  </div>
                </>
              ) : shown === 'pending' && pending ? (
                <div className={s.result} role="status">
                  <p className={s.resultLine}>{w.sent}</p>
                  <div className={s.links}>
                    <a className={`${m.display} ${m.secondary}`} href={explorerTxUrl('mainnet', pending)} target="_blank" rel="noreferrer noopener">
                      {w.viewOnSolana}
                    </a>
                  </div>
                </div>
              ) : shown === 'paid' ? (
                <div className={`${s.result} ${s.resultGood}`}>
                  {request.paid?.paidAt ? <p className={`${s.resultLine} ${s.when}`}>{when(request.paid.paidAt, true) ? w.paidAt(when(request.paid.paidAt, true)) : null}</p> : null}
                  {request.paid ? (
                    <div className={s.links}>
                      <a className={`${m.display} ${m.secondary}`} href={explorerTxUrl('mainnet', request.paid.signature)} target="_blank" rel="noreferrer noopener">
                        {w.viewOnSolana}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={s.result}>
                  <p className={s.resultLine}>{w.newLink}</p>
                  <span className={`${s.foot} ${s.when}`}>{when(request.expiresAt) ? w.ended(when(request.expiresAt)) : null}</span>
                </div>
              )}
            </div>

            {canPay && qr ? (
              <aside className={s.scan}>
                <div className={s.qr}>
                  {/* A data URI drawn on the server; there is no file for next/image. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt={w.qr} width={180} height={180} />
                </div>
                <span className={s.scanWord}>{w.scan}</span>
              </aside>
            ) : null}
          </div>
        </Chrome>
      </section>
    </Frame>
  );
}

/** The sum: what is asked, what arrived once paid (in mint), faded once the link ended. */
function Figure({ request, shown, anyAmount }: { request: View['request']; shown: Shown; anyAmount: string }) {
  const lang = useLang();
  const tone = shown === 'paid' ? s.got : shown === 'expired' ? s.faded : '';
  const raw = shown === 'paid' && request.paid ? request.paid.creditedRaw : (request.amount?.raw ?? null);
  return (
    <h1 id="pay-title" className={`${s.figure} ${tone} ${raw ? '' : s.open}`}>
      <span translate="no">{raw ? digits(figure(raw, request.token.decimals), lang) : anyAmount}</span>
      <span className={s.unit} translate="no">
        {request.token.symbol}
      </span>
    </h1>
  );
}

function Status({ shown, label }: { shown: Shown; label: string }) {
  return (
    <span className={s.status} data-shown={shown} role="status">
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

function noteLine(note: Note, w: Words, lang: Lang): string {
  switch (note.kind) {
    case 'wrongCoin':
      return w.wrongCoin;
    case 'short':
      return digits(note.fee ? `${w.arrivedOf(note.received, note.amount)} ${w.feeKept(note.fee)}` : w.arrivedOf(note.received, note.amount), lang);
    case 'more':
      return digits(w.arrivedMore(note.received), lang);
    case 'total':
      return digits(w.arrivedTotal(note.received), lang);
  }
}

function origin(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return 'https://ryntra.io';
  }
}

/* ------------------------------------------------------------------ *
 * The page around the window
 * ------------------------------------------------------------------ */

/** The page: our own city behind, the mark home and the language above, the window in the middle. */
function Frame({ children }: { children: ReactNode }) {
  const w = useWords(PAY);
  const lang = useLang();
  return (
    <div className={s.page} data-pay-page="">
      <div className={s.backdrop} aria-hidden="true">
        {/* A still of the live 3D scene in two widths; decoration, so no next/image round trip. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BACKDROP.large} srcSet={`${BACKDROP.small} 800w, ${BACKDROP.large} 1600w`} sizes="100vw" alt="" decoding="async" />
      </div>
      <div className={s.shade} aria-hidden="true" />
      <header className={s.top}>
        {/* A whole page load into the city, not a client navigation: the city is its own page. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={s.brand} href="/" aria-label={w.home}>
          <Mark size={30} />
          <span className={s.word} aria-hidden="true">
            {BRAND.name}
          </span>
        </a>
        <div className={s.lang} role="group" aria-label={w.language}>
          {LANGS.map((code) => (
            <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => lang !== code && setLang(code)}>
              {LANG_LABEL[code]}
            </button>
          ))}
        </div>
      </header>
      <main className={s.stage} id="main-content">
        {children}
      </main>
    </div>
  );
}

/** The city window's own chrome: the glass, the orange corner brackets, the head with its glyph and title. */
function Chrome({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.panel}>
      <span className={`${s.bracket} ${s.nw}`} aria-hidden="true" />
      <span className={`${s.bracket} ${s.ne}`} aria-hidden="true" />
      <span className={`${s.bracket} ${s.sw}`} aria-hidden="true" />
      <span className={`${s.bracket} ${s.se}`} aria-hidden="true" />
      <div className={s.head}>
        <span className={s.icon} aria-hidden="true">
          <LinkGlyph />
        </span>
        <p className={s.title}>{title}</p>
        {status}
      </div>
      {children}
    </div>
  );
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}

/**
 * A link that does not exist, or no longer does: said in the city's words, with the way into the city. Nothing of the
 * request is read or shown.
 */
export function Missing() {
  const w = useWords(PAY);
  useLayoutEffect(() => void hydrateLang(), []);
  return (
    <Frame>
      <section className={`${s.window} ${s.narrow}`} aria-labelledby="pay-missing">
        <Chrome title={w.request}>
          <div className={s.missing}>
            <h1 id="pay-missing" className={s.missingTitle}>
              {w.missingTitle}
            </h1>
            <p className={s.missingLine}>{w.missingLine}</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className={`${m.display} ${m.action}`} href="/">
              {w.toCity}
            </a>
          </div>
        </Chrome>
      </section>
    </Frame>
  );
}
