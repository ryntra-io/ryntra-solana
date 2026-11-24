'use client';

import { useEffect, useState } from 'react';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { buildWalletPayment, paidIn, walletLamports } from '@/lib/privacy/invoices/chain.client';
import { decodeInvoice } from '@/lib/privacy/invoices/code';
import { shortAddress, timeLeft, type PrivateInvoice } from '@/lib/privacy/invoices/model';
import { WAY_SEEN, failureOf, payView, payWay, walletShort, type PayFailure, type PayWay } from '@/lib/privacy/invoices/pay';
import { paymentHere, rememberPayment, type PaidHere } from '@/lib/privacy/invoices/store.client';
import { PrivateError, submit } from '@/lib/privacy/flows';
import { PRIVATE_TEST, explorerUrl } from '@/lib/privacy/network';
import { loadPrivate } from '@/lib/privacy/sdk.client';
import { usePrivate } from '@/lib/privacy/usePrivate';
import { walletSigner } from '@/lib/privacy/wallet.client';
import { isPhoneUserAgent, withoutFragment } from '@/lib/solana/open-in-wallet';
import { Glyph } from '@/terminal/portfolio/glyphs';
import { SeenLine } from '@/terminal/portfolio/private/PrivateBalance';
import { PRIVATE } from '@/terminal/portfolio/private/words';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, ActionBody, Chip, Figure, Kick, Page, PageHead, Panel } from '@/terminal/ui';
import { leftText, sumOf } from './PrivateInvoices';
import { PRIVATE_INVOICE_WORDS } from './words';
import m from '../money.module.css';
import p from './private-invoices.module.css';

type VaEvent = { url: string } & Record<string, unknown>;
type Va = ((...args: unknown[]) => void) & { q?: unknown[] };

/*
 * The invoice rides in the `#fragment` — «what it is for» with it. Before any analytics event of this page can be sent,
 * every event's address loses its fragment: the queue `window.va` is Vercel Analytics' own documented way to set
 * `beforeSend` ahead of its script (as the claim page does). This runs when the module loads, before the script is in.
 */
if (typeof window !== 'undefined') {
  const holder = window as unknown as { va?: Va; vaq?: unknown[] };
  holder.va ??= ((...args: unknown[]) => void (holder.vaq ??= []).push(args)) as Va;
  holder.va('beforeSend', (event: VaEvent) => ({ ...event, url: withoutFragment(event.url) }));
}

async function copyHere(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}

type Read = 'reading' | 'broken' | 'ready';

/**
 * The payer's page of a private invoice (`/private/pay#i=…`): from whom, the sum, what it is for, how long
 * is left; the line «Others see» for the way it is paid; one amber «Pay».
 *
 * - The payer's private balance holds the sum — a private transfer: only the payer is seen.
 * - It does not (or there is none) — one approval puts the sum from the wallet straight into the recipient's private
 *   balance; one honest line says the sum will be seen.
 *
 * The invoice never leaves this browser: it is read from the fragment, and the payment carries no memo. The proof can
 * take up to 20 seconds; the press says so while it works. A payment made here is remembered here, so the page says
 * «Paid» rather than asking twice.
 */
export function PayScreen() {
  const w = useWords(PRIVATE_INVOICE_WORDS);
  const pw = useWords(PRIVATE);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const wallets = useWallet((st) => st.wallets.length);
  const phase = usePrivate((st) => st.phase);
  const held = usePrivate((st) => st.held);
  const [read, setRead] = useState<Read>('reading');
  const [invoice, setInvoice] = useState<PrivateInvoice | null>(null);
  const [paidHere, setPaidHere] = useState<PaidHere | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PayFailure | 'short' | null>(null);
  const [phone, setPhone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    const open = async () => {
      const found = await decodeInvoice(window.location.hash);
      if (!live) return;
      if (!found) return setRead('broken');
      setInvoice(found);
      setRead('ready');
      setPaidHere(await paymentHere(found.id));
    };
    void open();
    // A link pasted into the same tab changes only the fragment.
    window.addEventListener('hashchange', open);
    return () => {
      live = false;
      window.removeEventListener('hashchange', open);
    };
  }, []);

  // The payer's own private balance, read with their keys as in Portfolio: it decides which way pays.
  useEffect(() => {
    usePrivate.getState().follow(connection?.wallet ?? null, connection?.address ?? null);
  }, [connection?.wallet, connection?.address]);

  const payer = connection?.address ?? null;
  const view = invoice ? payView({ invoice, now, payer, paidHere: paidHere !== null }) : null;
  const mine = invoice && phase === 'ready' ? (held?.find((h) => h.mint === invoice.mint)?.amount ?? 0n) : null;
  const way = invoice ? payWay({ phase, held: mine }, invoice.amount) : 'wait';

  async function pay() {
    if (!invoice || !connection || busy || way === 'wait') return;
    setBusy(true);
    setFailure(null);
    const chosen: PayWay = way;
    try {
      // Before the wallet is asked, nothing can have moved: a failure here says so.
      let ctx: Awaited<ReturnType<typeof loadPrivate>>;
      let tx: unknown = null;
      try {
        ctx = await loadPrivate();
        if (walletShort(await walletLamports(ctx, connection.address), invoice, chosen)) return setFailure('short');
        if (chosen === 'wallet') tx = await buildWalletPayment(ctx, connection.address, invoice);
      } catch (error) {
        return setFailure(error instanceof PrivateError && error.code === 'NOT_REGISTERED' ? 'closed' : 'failed');
      }
      let signature: string | null = null;
      if (chosen === 'private') {
        const sent = await usePrivate.getState().send(invoice.to, invoice.amount);
        if (sent === 'link') return setFailure('closed');
        if (sent !== 'sent') return setFailure(failureOf(usePrivate.getState().failure?.code));
        signature = usePrivate.getState().last?.signature ?? null;
      } else {
        signature = (await submit(ctx, tx, { wallet: walletSigner(connection.wallet, connection.address) })).signature;
        paidIn(ctx, invoice);
      }
      if (!signature) return setFailure('unconfirmed');
      const mark: PaidHere = { signature, payer: connection.address, at: Date.now() };
      await rememberPayment(invoice.id, mark).catch(() => undefined);
      setPaidHere(mark);
    } catch (error) {
      setFailure(failureOf(error instanceof PrivateError ? error.code : null));
    } finally {
      setBusy(false);
    }
  }

  const sum = invoice ? sumOf(invoice, lang) : null;
  const left = invoice ? leftText(timeLeft(invoice, now), w) : null;

  let action = null;
  if (view === 'paidHere' && paidHere)
    action = (
      <p className={p.tx} role="status">
        {w.paidHere}{' '}
        <a href={explorerUrl('tx', paidHere.signature)} target="_blank" rel="noreferrer">
          {w.tx}
        </a>
      </p>
    );
  else if (view === 'expired') action = <p className={p.fail}>{w.expired}</p>;
  else if (view === 'own') action = <p className={p.line}>{w.own}</p>;
  else if (view === 'connect')
    action =
      phone && wallets === 0 ? (
        // A phone's browser with no wallet: the person copies the link and opens it in their wallet's browser — a
        // link that opens the wallet would carry the invoice to another site.
        <>
          <p className={p.line}>{w.noWalletPhone}</p>
          <Action onClick={async () => setCopied(await copyHere())}>{copied ? w.copied : w.copyLink}</Action>
        </>
      ) : (
        <>
          <p className={p.line}>{w.connectLine}</p>
          <Action onClick={connectWallet}>{w.connect}</Action>
        </>
      );
  else if (view === 'pay')
    action = (
      <>
        {way === 'wait' ? null : <SeenLine action={WAY_SEEN[way]} w={pw} />}
        <p className={p.line} data-pay-way={way}>
          {way === 'wait' ? w.readingYours : way === 'private' ? w.fromPrivate : w.fromWallet}
        </p>
        {failure ? (
          <p className={p.fail} role="alert" data-pay-failure={failure}>
            {w[failure]}
          </p>
        ) : null}
        <Action busy={busy} disabled={busy || way === 'wait'} onClick={() => void pay()}>
          {busy ? w.paying : w.pay}
        </Action>
      </>
    );

  return (
    <Page data-screen="private-pay">
      <PageHead title={w.payTitle} mark={PRIVATE_TEST ? <Chip>{w.net}</Chip> : undefined} />
      <ActionBody
        sideLabel={w.details}
        side={
          invoice ? (
            <Panel gap={12} edge label={w.details}>
              <Kick>{w.details}</Kick>
              <dl className={p.facts}>
                <div className={p.fact}>
                  <dt>{w.recipient}</dt>
                  <dd translate="no">{invoice.to}</dd>
                </div>
                <div className={p.fact}>
                  <dt>{w.validUntil}</dt>
                  <dd>{dateText(invoice.expiresAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }, lang)}</dd>
                </div>
              </dl>
            </Panel>
          ) : undefined
        }
      >
        <Panel tone="hi" pad="l" gap={16} edge label={w.payTitle} className={m.form}>
          <div className={p.head}>
            <span className={p.badge}>
              <Glyph name="lock" />
            </span>
            <span className={p.words}>
              {read === 'ready' && invoice && sum ? (
                <>
                  <Kick>
                    {w.from} · <span translate="no">{shortAddress(invoice.to)}</span>
                  </Kick>
                  <Figure value={sum.value} unit={sum.unit} size="xl" />
                  {invoice.forWhat ? <p className={p.forWhat}>{invoice.forWhat}</p> : null}
                  {view === 'paidHere' ? (
                    <span className={p.left}>
                      <Chip tone="ok">{w.paid}</Chip>
                    </span>
                  ) : left ? (
                    <span className={p.left}>
                      <Chip>{left}</Chip>
                    </span>
                  ) : null}
                </>
              ) : null}
              {read === 'broken' ? <p className={p.fail}>{w.broken}</p> : null}
            </span>
          </div>
          <div className={m.grow} />
          {action}
        </Panel>
      </ActionBody>
    </Page>
  );
}
