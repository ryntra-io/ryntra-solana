'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { cleanAmount } from '@/city/lib/money/amount';
import { useWallet } from '@/city/lib/trade/wallet';
import { PAY_PATH } from '@/lib/privacy/invoices/code';
import { DEFAULT_EXPIRY, EXPIRIES, FOR_WHAT_MAX, PRIVATE_INVOICE_COINS, amountUnits, coinOf, timeLeft, unitsText, type Expiry, type Left, type PrivateInvoice } from '@/lib/privacy/invoices/model';
import { listOrder, waitingTotals, type InvoiceState } from '@/lib/privacy/invoices/status';
import type { KeptInvoice } from '@/lib/privacy/invoices/store.client';
import { keptUrl, usePrivateInvoices } from '@/lib/privacy/invoices/usePrivateInvoices';
import { PRIVATE_TEST, explorerUrl } from '@/lib/privacy/network';
import { usePrivate } from '@/lib/privacy/usePrivate';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Glyph } from '@/terminal/portfolio/glyphs';
import { SeenLine } from '@/terminal/portfolio/private/PrivateBalance';
import { PRIVATE } from '@/terminal/portfolio/private/words';
import { Action, AmountField, Chip, Figure, Icon, Kick, Panel, Quiet, QuietLink, Shares, cx } from '@/terminal/ui';
import { Qr, useCopy } from '../parts';
import { ReportAccess } from '../report/Report';
import { PRIVATE_INVOICE_WORDS } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from '@/terminal/swap/swap.module.css';
import m from '../money.module.css';
import p from './private-invoices.module.css';

type Words = (typeof PRIVATE_INVOICE_WORDS)['en'];

/** The coin's mark: SOL by its own icon route, as the open invoices draw it. */
const SOL_ICON = '/api/icon/So11111111111111111111111111111111111111112';

/** «3 days left», «ще 5 год» — how long an invoice still waits. */
export function leftText(left: Left | null, w: Words): string | null {
  if (!left) return null;
  if (left.unit === 'days') return w.leftDays(left.count);
  if (left.unit === 'hours') return w.leftHours(left.count);
  return w.leftMinutes(left.count);
}

/** A sum in its coin as the person reads it: «0,05 SOL». */
export function sumOf(invoice: Pick<PrivateInvoice, 'mint' | 'amount'>, lang: ReturnType<typeof useLang>): Readonly<{ value: string; unit: string }> {
  const coin = coinOf(invoice.mint) ?? PRIVATE_INVOICE_COINS[0];
  return { value: digits(unitsText(invoice.amount, coin.decimals), lang), unit: coin.symbol };
}

/** The lock in its lit well, the kick and what stands beside it — the panel's head in every state. */
function Head({ kick, children, w }: { kick: string; children?: ReactNode; w: Words }) {
  return (
    <div className={p.head}>
      <span className={p.badge}>
        <Glyph name="lock" />
      </span>
      <span className={p.words}>
        <Kick>{kick}</Kick>
        {children}
      </span>
      {PRIVATE_TEST ? <Chip>{w.net}</Chip> : null}
    </div>
  );
}

/**
 * «Invoices», private: the action panel of «Money» in its
 * private mode. The main figure is what the person waits for; the one amber press is «New invoice». The new invoice —
 * a sum, what it is for, how long — becomes a link and its QR; the payment lands in the person's private balance, so
 * the panel first asks for the private balance to be on. Nothing here signs: making an invoice reads the slot and seals
 * the invoice in this browser.
 */
export function PrivateInvoicePanel({ owner }: { owner: string }) {
  const w = useWords(PRIVATE_INVOICE_WORDS);
  const pw = useWords(PRIVATE);
  const connection = useWallet((st) => st.connection);
  const phase = usePrivate((st) => st.phase);
  const busy = usePrivate((st) => st.busy);
  const [step, setStep] = useState<'overview' | 'form' | 'made'>('overview');
  const [made, setMade] = useState<Readonly<{ kept: KeptInvoice; url: string }> | null>(null);

  useEffect(() => {
    usePrivate.getState().follow(connection?.wallet ?? null, connection?.address ?? null);
  }, [connection?.wallet, connection?.address]);
  useEffect(() => {
    usePrivateInvoices.getState().follow(owner);
  }, [owner]);

  if (phase === 'loading' || phase === 'none' || phase === 'shut')
    return (
      <div className={p.bones} aria-busy="true" aria-label={w.reading}>
        <span />
        <span />
      </div>
    );

  if (phase === 'failed')
    return (
      <>
        <Head kick={w.mine} w={w}>
          <p className={p.fail}>{w.notRead}</p>
        </Head>
        <div className={m.grow} />
        <Action onClick={() => void usePrivate.getState().refresh()}>{w.again}</Action>
      </>
    );

  if (phase === 'off')
    return (
      <>
        <Head kick={w.mine} w={w}>
          <p className={p.line}>{w.needOn}</p>
        </Head>
        <div className={m.grow} />
        <SeenLine action="enable" w={pw} />
        <Action busy={busy === 'on'} disabled={busy !== null} onClick={() => void usePrivate.getState().turnOn()}>
          {busy === 'on' ? w.turningOn : w.turnOn}
        </Action>
      </>
    );

  if (phase === 'elsewhere')
    return (
      <>
        <Head kick={w.mine} w={w}>
          <p className={p.line}>{w.elsewhere}</p>
        </Head>
        <div className={m.grow} />
        <QuietLink href="/portfolio">{w.toPortfolio}</QuietLink>
      </>
    );

  if (step === 'form')
    return (
      <NewInvoice
        w={w}
        onBack={() => setStep('overview')}
        onMade={(done) => {
          setMade(done);
          setStep('made');
        }}
      />
    );

  if (step === 'made' && made)
    return (
      <MadeInvoice
        made={made}
        w={w}
        onDone={() => {
          setMade(null);
          setStep('overview');
        }}
      />
    );

  return <Overview w={w} onNew={() => setStep('form')} />;
}

/** The main figure — what is still to come — and the one press: «New invoice». */
function Overview({ w, onNew }: { w: Words; onNew: () => void }) {
  const lang = useLang();
  const kept = usePrivateInvoices((st) => st.kept);
  const settled = usePrivateInvoices((st) => st.settled);
  const [how, setHow] = useState(false);
  const howId = useId();
  const totals = waitingTotals(kept, settled);
  const shown = totals.length ? totals : [{ mint: PRIVATE_INVOICE_COINS[0].mint, amount: 0n }];
  return (
    <>
      <Head kick={w.waiting} w={w}>
        {shown.map((total) => {
          const sum = sumOf(total, lang);
          return <Figure key={total.mint} value={sum.value} unit={sum.unit} size="l" />;
        })}
      </Head>
      <div className={m.grow} />
      <div className={s.terms}>
        <span className={s.termsLine}>{w.intoPrivate}</span>
        <ExplainButton label={w.howTitle} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? (
        <ExplainBox id={howId}>
          <ul className={p.how}>
            <li>{w.how1}</li>
            <li>{w.how2}</li>
            <li>{w.how3}</li>
            {PRIVATE_TEST ? <li>{w.how4}</li> : null}
          </ul>
        </ExplainBox>
      ) : null}
      <Action onClick={onNew}>{w.newInvoice}</Action>
    </>
  );
}

/** «New invoice»: a sum, what it is for, how long — «Create link». The coin is SOL while the private balance holds SOL. */
function NewInvoice({ w, onBack, onMade }: { w: Words; onBack: () => void; onMade: (made: Readonly<{ kept: KeptInvoice; url: string }>) => void }) {
  const lang = useLang();
  const coin = PRIVATE_INVOICE_COINS[0];
  const making = usePrivateInvoices((st) => st.making);
  const [typed, setTyped] = useState('');
  const [about, setAbout] = useState('');
  const [expiry, setExpiry] = useState<Expiry>(DEFAULT_EXPIRY);
  const [line, setLine] = useState<string | null>(null);
  const amount = amountUnits(typed, coin.decimals);
  const expiryWord: Readonly<Record<Expiry, string>> = { '1h': w.expiry1h, '24h': w.expiry24h, '7d': w.expiry7d, '30d': w.expiry30d };

  const submit = async () => {
    if (amount === null || making) return;
    setLine(null);
    const done = await usePrivateInvoices.getState().make({ mint: coin.mint, typed, forWhat: about, expiry });
    if (done.ok) return onMade({ kept: done.kept, url: done.url });
    setLine(done.reason === 'closed' ? w.closedHere : w.createFailed);
  };

  return (
    <>
      <fieldset className={t.group} disabled={making}>
        <AmountField
          label={w.amount}
          value={fieldText(typed, lang)}
          onChange={(text) => setTyped(cleanAmount(fieldValue(text, lang)))}
          asset={{ symbol: coin.symbol, icon: SOL_ICON }}
        />
      </fieldset>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.forWhat}</Kick>
        </span>
        <input className={s.text} value={about} maxLength={FOR_WHAT_MAX} onChange={(event) => setAbout(event.target.value)} placeholder={w.forWhatHint} autoComplete="off" disabled={making} />
      </label>
      <div className={m.expiry}>
        <Kick>{w.validFor}</Kick>
        <fieldset className={cx(t.group, m.expiryChoice)} disabled={making}>
          <Shares label={w.validFor} options={EXPIRIES.map((id) => ({ id, label: expiryWord[id] }))} value={expiry} onPick={setExpiry} />
        </fieldset>
      </div>
      <div className={m.grow} />
      {line ? (
        <p className={t.note} data-tone="error" role="alert">
          {line}
        </p>
      ) : null}
      <Quiet full disabled={making} onClick={onBack}>
        {w.back}
      </Quiet>
      <Action onClick={() => void submit()} disabled={amount === null} busy={making}>
        {making ? w.creating : w.createLink}
      </Action>
    </>
  );
}

/** The invoice just made: its QR, its sum, what it is for, the page it opens — and one copy. */
function MadeInvoice({ made, w, onDone }: { made: Readonly<{ kept: KeptInvoice; url: string }>; w: Words; onDone: () => void }) {
  const lang = useLang();
  const [copied, copy] = useCopy();
  const { invoice } = made.kept;
  const sum = sumOf(invoice, lang);
  // The page's address without the invoice after `#`: the link itself is what «Copy link» copies.
  const shown = `${new URL(made.url).host}${PAY_PATH}`;
  return (
    <>
      <div className={m.made} data-private-invoice-made="">
        <Qr value={made.url} label={w.qr(`${sum.value} ${sum.unit}`)} />
        <div className={m.receiveWords}>
          <Kick className={m.madeKick}>{w.made}</Kick>
          <Figure value={sum.value} unit={sum.unit} />
          {invoice.forWhat ? <p className={m.line}>{invoice.forWhat}</p> : null}
          <a className={m.url} href={made.url} target="_blank" rel="noreferrer" translate="no" aria-label={w.openPage}>
            {shown}
            <Icon name="arrow" size="s" />
          </a>
        </div>
      </div>
      <div className={m.grow} />
      <Quiet full onClick={onDone}>
        {w.toInvoices}
      </Quiet>
      <Action onClick={() => copy(made.url)}>{copied === made.url ? w.copied : w.copyLink}</Action>
    </>
  );
}

const TONE: Readonly<Record<InvoiceState, 'ok' | 'warn' | 'plain'>> = { paid: 'ok', waiting: 'warn', expired: 'plain' };

/** How often the private history is read again while an invoice waits and the page is seen. */
const CHECK_MS = 30_000;

/**
 * «My invoices»: every private invoice this wallet made in this browser — waiting first, soonest to end on top — each
 * with its state: waiting (and how long is left, and its link to copy), paid (the transaction, where the payer stands),
 * expired. «Paid» comes only from the person's own private history, read when the list opens, every half minute while
 * something waits, and on «Check payments».
 */
export function PrivateInvoiceList({ owner }: { owner: string }) {
  const w = useWords(PRIVATE_INVOICE_WORDS);
  const lang = useLang();
  const [copied, copy] = useCopy();
  const phase = usePrivate((st) => st.phase);
  const loaded = usePrivateInvoices((st) => st.loaded);
  const kept = usePrivateInvoices((st) => st.kept);
  const settled = usePrivateInvoices((st) => st.settled);
  const read = usePrivateInvoices((st) => st.read);
  const any = kept.length > 0;
  const waiting = [...settled.values()].some((one) => one.state === 'waiting');

  useEffect(() => {
    usePrivateInvoices.getState().follow(owner);
  }, [owner]);

  useEffect(() => {
    if (phase !== 'ready' || !loaded || !any) return;
    const check = () => {
      if (document.visibilityState === 'visible') void usePrivateInvoices.getState().check();
    };
    check();
    if (!waiting) return;
    const timer = window.setInterval(check, CHECK_MS);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [phase, loaded, any, waiting]);

  const when = (at: number) => dateText(at, { day: 'numeric', month: 'short' }, lang);
  const now = Date.now();
  const stateWord: Readonly<Record<InvoiceState, string>> = { waiting: w.stateWaiting, paid: w.statePaid, expired: w.stateExpired };

  let body;
  if (!loaded)
    body = (
      <div className={cx(s.bones, p.listLine)} aria-busy="true" aria-label={w.reading}>
        <span />
        <span />
      </div>
    );
  else if (!any) body = <p className={p.listLine}>{w.none}</p>;
  else
    body = (
      <ul className={p.rows}>
        {listOrder(kept, settled).map((one) => {
          const { invoice } = one;
          const got = settled.get(invoice.id);
          const state = got?.state ?? 'waiting';
          const sum = sumOf(invoice, lang);
          const under = state === 'waiting' ? leftText(timeLeft(invoice, now), w) : state === 'expired' ? w.endedOn(when(invoice.expiresAt)) : w.madeOn(when(invoice.createdAt));
          return (
            <li key={invoice.id} className={p.item} data-private-invoice={state}>
              <span className={p.itemNames}>
                <b>{`${sum.value} ${sum.unit}`}</b>
                <span>{invoice.forWhat ?? under}</span>
              </span>
              <span className={m.linkState}>
                <Chip tone={TONE[state]} dot={state === 'waiting'}>
                  {stateWord[state]}
                </Chip>
                {invoice.forWhat && under ? <span className={p.under}>{under}</span> : null}
              </span>
              <span className={p.itemActs}>
                {state === 'waiting' ? (
                  <Quiet size="s" aria-label={w.copyOne(`${sum.value} ${sum.unit}`)} onClick={() => copy(keptUrl(one))}>
                    {copied === keptUrl(one) ? w.copied : w.copy}
                  </Quiet>
                ) : null}
                {state === 'paid' && got?.paid ? (
                  <a className={p.txLink} href={explorerUrl('tx', got.paid.signature)} target="_blank" rel="noreferrer">
                    {w.tx}
                    <Icon name="arrow" size="s" />
                  </a>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    );

  return (
    <Panel pad="none" label={w.mine} className={p.list}>
      <div className={p.listHead}>
        <Kick className={p.listKick}>{w.mine}</Kick>
        {phase === 'ready' && any ? (
          <Quiet size="s" disabled={read === 'reading'} aria-busy={read === 'reading' || undefined} onClick={() => void usePrivateInvoices.getState().check()}>
            {read === 'reading' ? w.checking : w.refresh}
          </Quiet>
        ) : null}
      </div>
      {body}
      {any && read === 'failed' ? <p className={p.listLine}>{w.unread}</p> : null}
      {any && read === 'nokeys' ? <p className={p.listLine}>{w.noKeys}</p> : null}
      <div className={p.report}>
        <ReportAccess focus="in" />
      </div>
    </Panel>
  );
}
