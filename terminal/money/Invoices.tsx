'use client';

import { useId, useState } from 'react';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { cleanAmount } from '@/city/lib/money/amount';
import { USDC } from '@/city/lib/trade/tiles';
import { iconOf } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Action, AmountField, Chip, CoinLogo, Figure, Icon, Kick, Panel, Quiet, Shares, cx } from '@/terminal/ui';
import { DEFAULT_EXPIRY, DESCRIPTION_MAX, EXPIRIES, INVOICE_COINS, createBody, invoiceAmount, stateKey, toneOf, type Expiry, type Invoice, type InvoiceCoin } from './money-view';
import { Qr, useCopy } from './parts';
import type { Created, Links } from './useInvoices';
import { MONEY_WORDS } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from '@/terminal/swap/swap.module.css';
import m from './money.module.css';

const coinIcon = (coin: InvoiceCoin): string | null => (coin.mint === USDC.mint ? iconOf(USDC) : '/api/icon/So11111111111111111111111111111111111111112');

/**
 * «Invoices» — a payment link: a sum in USDC or SOL, what it is for, how long it is
 * valid, and the link to send — paid straight to this wallet, by the link or its QR, on the payer's page `/pay/<id>`
 * as it is. The engine makes it (`lib/pay/**`, `POST /api/v1/pay/requests`); the wallet proves itself once by one signed
 * message, never a transaction. The form's one amber press is «Create link»; once made, «Copy link». It stands only
 * with a wallet here: without one the tab is «Money»'s own blank (`NoWallet.tsx`).
 */
export function InvoiceForm({ create }: { create: (body: ReturnType<typeof createBody>) => Promise<Created> }) {
  const w = useWords(MONEY_WORDS);
  const lang = useLang();
  const [coin, setCoin] = useState<InvoiceCoin>(INVOICE_COINS[0]);
  const [menu, setMenu] = useState(false);
  const [typed, setTyped] = useState('');
  const [about, setAbout] = useState('');
  const [expiry, setExpiry] = useState<Expiry>(DEFAULT_EXPIRY);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [made, setMade] = useState<Invoice | null>(null);
  const [how, setHow] = useState(false);
  const howId = useId();

  if (made) return <Made link={made} onAnother={() => setMade(null)} />;

  const amount = invoiceAmount(typed, coin);
  const expiryWord: Readonly<Record<Expiry, string>> = { '1h': w.expiry1h, '24h': w.expiry24h, '7d': w.expiry7d, '30d': w.expiry30d };
  const submit = async () => {
    if (!amount || busy) return;
    setBusy(true);
    setLine(null);
    const done = await create(createBody(coin, amount, about, expiry));
    setBusy(false);
    if (done.ok) {
      setMade(done.link);
      setTyped('');
      setAbout('');
      return;
    }
    setLine(done.declined ? w.declined : w.failed);
  };

  return (
    <>
      <fieldset className={t.group} disabled={busy}>
        <AmountField
          label={w.amount}
          value={fieldText(typed, lang)}
          onChange={(text) => setTyped(cleanAmount(fieldValue(text, lang)))}
          asset={{ symbol: coin.symbol, icon: coinIcon(coin) }}
          onAsset={() => setMenu((was) => !was)}
          assetLabel={w.pickCoin}
        />
        {menu ? (
          <div className={cx(s.pickList, s.coinList)} role="menu" aria-label={w.pickCoin}>
            {INVOICE_COINS.map((each) => (
              <button
                key={each.symbol}
                type="button"
                role="menuitemradio"
                aria-checked={each.symbol === coin.symbol}
                className={t.menuRow}
                onClick={() => {
                  setMenu(false);
                  setCoin(each);
                }}
              >
                <CoinLogo src={coinIcon(each)} symbol={each.symbol} size="s" />
                <span className={t.menuName}>{each.symbol}</span>
              </button>
            ))}
          </div>
        ) : null}
      </fieldset>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.forWhat}</Kick>
        </span>
        <input className={s.text} value={about} maxLength={DESCRIPTION_MAX} onChange={(event) => setAbout(event.target.value)} placeholder={w.forWhatHint} autoComplete="off" disabled={busy} />
      </label>
      <div className={m.expiry}>
        <Kick>{w.validFor}</Kick>
        <fieldset className={cx(t.group, m.expiryChoice)} disabled={busy}>
          <Shares label={w.validFor} options={EXPIRIES.map((id) => ({ id, label: expiryWord[id] }))} value={expiry} onPick={setExpiry} />
        </fieldset>
      </div>
      <div className={m.grow} />
      <div className={s.terms}>
        <span className={s.termsLine}>{w.straight}</span>
        <ExplainButton label={w.how} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? (
        <ExplainBox id={howId}>
          <span>{w.howText}</span>
        </ExplainBox>
      ) : null}
      {line ? (
        <p className={t.note} data-tone="error" role="alert">
          {line}
        </p>
      ) : null}
      <Action onClick={() => void submit()} disabled={!amount} busy={busy}>
        {busy ? w.creating : w.create}
      </Action>
    </>
  );
}

/** The link just made: its sum, what it is for, its QR and its address — and one copy. */
function Made({ link, onAnother }: { link: Invoice; onAnother: () => void }) {
  const w = useWords(MONEY_WORDS);
  const lang = useLang();
  const [copied, copy] = useCopy();
  const sum = link.asked ? `${digits(link.asked, lang)} ${link.symbol}` : w.any;
  return (
    <>
      <div className={m.made} data-pay-made="">
        <Qr value={link.payUrl} label={w.qr(sum)} />
        <div className={m.receiveWords}>
          <Kick className={m.madeKick}>{w.made}</Kick>
          {link.asked ? <Figure value={digits(link.asked, lang)} unit={link.symbol} /> : <Figure value={w.any} />}
          {link.description ? <p className={m.line}>{link.description}</p> : null}
          <a className={m.url} href={link.url} target="_blank" rel="noreferrer" translate="no" aria-label={w.open}>
            {link.url.replace(/^https?:\/\//, '')}
            <Icon name="arrow" size="s" />
          </a>
        </div>
      </div>
      <div className={m.grow} />
      <Quiet full onClick={onAnother}>
        {w.another}
      </Quiet>
      <Action onClick={() => copy(link.url)}>{copied === link.url ? w.copied : w.copyLink}</Action>
    </>
  );
}

/**
 * «Your links»: every link this wallet made, newest first, each with its state as the chain read it — waiting, paid
 * (what came, and the payment on Solana, where the payer stands), expired — and a copy. Read only behind the wallet's
 * proof: without one, a quiet «Show my links» asks the wallet for its one signed message.
 */
export function MyLinks({ links, onUnlock, onRead }: { links: Links; onUnlock: () => Promise<'ok' | 'declined' | 'failed'>; onRead: () => void }) {
  const w = useWords(MONEY_WORDS);
  const lang = useLang();
  const [copied, copy] = useCopy();
  const [asking, setAsking] = useState(false);
  const when = (iso: string | null): string => {
    const at = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(at) ? dateText(at, { day: 'numeric', month: 'short' }, lang) : '—';
  };
  let body;
  if (links.state === 'reading')
    body = (
      <div className={s.bones} aria-busy="true" aria-label={w.reading}>
        <span />
        <span />
      </div>
    );
  else if (links.state === 'locked')
    body = (
      <div className={m.listBlank}>
        <p className={m.line}>{w.locked}</p>
        <Quiet
          size="s"
          disabled={asking}
          onClick={() => {
            setAsking(true);
            void onUnlock().finally(() => setAsking(false));
          }}
        >
          {w.show}
        </Quiet>
      </div>
    );
  else if (links.state === 'failed')
    body = (
      <div className={m.listBlank}>
        <p className={m.line} data-tone="down">
          {w.unread}
        </p>
        <Quiet size="s" onClick={onRead}>
          {w.again}
        </Quiet>
      </div>
    );
  else if (!links.links.length) body = <p className={cx(m.line, m.listLine)}>{w.none}</p>;
  else
    body = (
      <ul className={m.links}>
        {links.links.map((link) => {
          const sum = link.asked ? `${digits(link.asked, lang)} ${link.symbol}` : w.any;
          const partly = link.received && link.asked && link.received !== link.asked;
          return (
            <li key={link.id} className={m.link} data-pay-link={link.status}>
              <span className={m.linkNames}>
                <b>{sum}</b>
                {link.paid ? (
                  <a className={m.paidLink} href={explorerTxUrl('mainnet', link.paid.signature)} target="_blank" rel="noreferrer" aria-label={w.onSolana}>
                    {w.paidOn(when(link.paid.at))}
                    <Icon name="arrow" size="s" />
                  </a>
                ) : (
                  <span>{link.description ?? w.created(when(link.createdAt))}</span>
                )}
              </span>
              <span className={m.linkState}>
                <Chip tone={toneOf(link)} dot={link.status === 'AWAITING' || link.status === 'CHECKING'}>
                  {w[stateKey(link)]}
                </Chip>
                {partly ? <span className={m.linkGot}>{w.receivedOf(digits(link.received!, lang), digits(link.asked!, lang))}</span> : null}
              </span>
              <span className={m.linkActs}>
                <Quiet size="s" aria-label={w.copyOne(sum)} onClick={() => copy(link.url)}>
                  {copied === link.url ? w.copied : w.copy}
                </Quiet>
              </span>
            </li>
          );
        })}
      </ul>
    );
  return (
    <Panel pad="none" edge label={w.yours} className={m.list}>
      <div className={m.listHead}>
        <Kick className={m.listKick}>{w.yours}</Kick>
      </div>
      {body}
    </Panel>
  );
}
