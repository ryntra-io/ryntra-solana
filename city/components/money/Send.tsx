'use client';

import { useEffect, useMemo, useState } from 'react';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { downloadReceipt } from '@/lib/solana/send-receipt-vault.client';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { cleanAmount, shareOf } from '@/city/lib/money/amount';
import { formatAmount, sendable } from '@/city/lib/money/assets';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { chosenAsset, reviewTotal, sendGate } from '@/city/lib/money/form';
import { useMoney } from '@/city/lib/money/open';
import { grouped, short } from '@/city/lib/money/recipient';
import { settledWord } from '@/city/lib/money/send';
import { useMoneyStore } from '@/city/lib/money/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { CoinIcon, Note, Soon, Terms } from './bits';
import { MONEY } from './words';
import s from './money.module.css';

/** Coins shown before «more»: a wallet of seventy tokens is not seventy chips. */
const COINS_SHOWN = 8;

const SHARES = [
  { id: '25', label: '25%', numerator: 1n, denominator: 4n },
  { id: '50', label: '50%', numerator: 1n, denominator: 2n },
  { id: 'max', label: null, numerator: 1n, denominator: 1n },
] as const;

/**
 * Send: a coin to a Solana address or a `.skr` name. The engine reads who it is, builds the exact transfer and its
 * Review — what leaves, the fee, what they get, an account opened for them — before the wallet opens; the person
 * signs in their own wallet and the engine sends it once and reads the chain back. Behind the money switch until the
 * owner's canary passes.
 */
export function Send({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  if (!MONEY_OPEN) {
    return (
      <Soon title={w.send}>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
          {w.topUpInstead}
        </button>
      </Soon>
    );
  }
  return <SendForm owner={owner} />;
}

function SendForm({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  const connected = useWallet((st) => st.connection?.address === owner);
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const send = useMoneyStore((st) => st.send);
  const gate = sendGate({ connected, owner, wallet, walletRead, send });
  const asset = chosenAsset(wallet, send.assetId);
  const coins = useMemo(() => (wallet ? sendable(wallet.assets) : []), [wallet]);
  const [allCoins, setAllCoins] = useState(false);
  // The most valuable first; the chosen one always in view, however far down the wallet it is.
  const shown = allCoins || coins.length <= COINS_SHOWN ? coins : coins.filter((coin, index) => index < COINS_SHOWN - 1 || coin.id === send.assetId).slice(0, COINS_SHOWN);
  const idle = send.phase === 'idle';
  const [canPaste, setCanPaste] = useState(false);
  useEffect(() => setCanPaste(typeof navigator.clipboard?.readText === 'function'), []);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) useMoneyStore.getState().setTo(text.trim());
    } catch {
      // A refused clipboard leaves the field for typing.
    }
  };

  const act = () => {
    const store = useMoneyStore.getState();
    if (gate.action === 'review') void store.reviewSend();
    else if (gate.action === 'confirm') void store.confirmSend();
  };

  if (send.settled) return <SendDone />;

  return (
    <section className={s.tabBody} aria-label={w.send}>
      {send.resumed ? <Resumed signature={send.resumed.signature} state={send.resumed.state} /> : null}

      <span className={s.label} id="money-coin">
        {w.coin}
      </span>
      {coins.length ? (
        <div className={s.chips} role="radiogroup" aria-labelledby="money-coin">
          {shown.map((coin) => (
            <button
              key={coin.id}
              type="button"
              role="radio"
              aria-checked={coin.id === send.assetId}
              className={`${s.coinChip} ${coin.id === send.assetId ? s.chipOn : ''}`}
              onClick={() => useMoneyStore.getState().setSendAsset(coin.id)}
              disabled={!idle}
            >
              <CoinIcon mint={coin.mint} size={20} icon={coin.icon} symbol={coin.symbol} />
              {coin.symbol}
            </button>
          ))}
          {shown.length < coins.length ? (
            <button type="button" className={s.coinChip} onClick={() => setAllCoins(true)} disabled={!idle}>
              {w.more(coins.length - shown.length)}
            </button>
          ) : null}
        </div>
      ) : wallet ? (
        <div className={s.bar}>
          <p className={s.empty}>{w.nothingToSend}</p>
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
            {w.topUp}
          </button>
        </div>
      ) : walletRead === 'failed' ? (
        <p className={s.empty}>
          {w.balancesUnavailable}{' '}
          <button type="button" className={s.link} onClick={() => useMoneyStore.getState().readWallet()}>
            {w.tryAgain}
          </button>
        </p>
      ) : (
        <div className={s.bones} aria-label={w.readingBalances}>
          <span />
        </div>
      )}

      <label className={s.label} htmlFor="money-to">
        {w.to}
      </label>
      <div className={s.field}>
        <input
          id="money-to"
          className={s.input}
          value={send.to}
          onChange={(event) => useMoneyStore.getState().setTo(event.target.value)}
          placeholder={w.toPlaceholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          disabled={!idle}
        />
        {canPaste && !send.to ? (
          <button type="button" className={s.inline} onClick={() => void paste()} disabled={!idle}>
            {w.paste}
          </button>
        ) : null}
      </div>
      {!send.to && send.recents.length ? (
        <div className={s.recents}>
          {send.recents.slice(0, 3).map((address) => (
            <button key={address} type="button" className={s.recent} onClick={() => useMoneyStore.getState().setTo(address)} title={address} translate="no" disabled={!idle}>
              {short(address)}
            </button>
          ))}
        </div>
      ) : null}
      {send.name?.state === 'FOUND' && gate.recipient ? <p className={s.fine} translate="no">{send.name.name} → {short(gate.recipient)}</p> : null}
      <Note line={gate.toLine} />
      <Note line={gate.riskLine} />
      {gate.toLine && send.check?.result?.next === 'pay-link' && send.check.result.linkUrl ? (
        <a className={s.link} href={send.check.result.linkUrl}>
          {w.openPayLink}
        </a>
      ) : null}

      {gate.recipient && gate.lookalike ? (
        <div className={s.hold} role="alert">
          <span>{gate.lookalike === owner ? w.looksYours : w.looksRecent}</span>
          <code translate="no">{grouped(gate.recipient)}</code>
          {gate.action === 'accept-lookalike' ? (
            <button type="button" className={s.inline} onClick={() => useMoneyStore.getState().acceptLookalike()}>
              {w.rightAddress}
            </button>
          ) : null}
        </div>
      ) : null}
      {gate.recipient && gate.isNew ? (
        <div className={s.hold} role="alert">
          <span>{w.newAddress}</span>
          {gate.lookalike ? null : <code translate="no">{grouped(gate.recipient)}</code>}
          {gate.action === 'accept-fresh' ? (
            <button type="button" className={s.inline} onClick={() => useMoneyStore.getState().acceptFresh()}>
              {w.addressChecked}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.amountHead}>
        <label className={s.label} htmlFor="money-amount">
          {w.amount}
        </label>
        {asset ? (
          <span className={s.balance}>{w.available(formatAmount(asset.spendableRaw, asset.decimals), asset.symbol)}</span>
        ) : null}
      </div>
      <div className={s.field}>
        <input
          id="money-amount"
          className={`${s.input} ${s.amount}`}
          value={fieldText(send.amount)}
          onChange={(event) => useMoneyStore.getState().setAmount(cleanAmount(event.target.value))}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          disabled={!idle || !asset}
        />
        <span className={s.unit}>{asset?.symbol ?? ''}</span>
      </div>
      {asset ? (
        <div className={s.shares}>
          {SHARES.map((share) => (
            <button
              key={share.id}
              type="button"
              className={s.share}
              disabled={!idle}
              onClick={() => useMoneyStore.getState().setAmount(shareOf(asset.spendableRaw, asset.decimals, share.numerator, share.denominator))}
            >
              {share.label ?? w.max}
            </button>
          ))}
        </div>
      ) : null}
      {gate.amountLine ? <Note line={{ tone: 'error', text: gate.amountLine }} /> : null}

      <div className={s.dock}>
        {send.review ? <Review /> : null}
        <Note line={send.line} />
        <button
          type="button"
          className={`${s.display} ${s.action} ${s.cta} ${idle ? '' : s.waiting}`}
          disabled={gate.action !== 'review' && gate.action !== 'confirm'}
          onClick={act}
        >
          {gate.label}
        </button>
      </div>
    </section>
  );
}

/**
 * The engine's Review of this exact transfer, before the wallet opens: what they get, to whom, and one line with the
 * fee, an account opened for them, the least a new address takes and the total — the breakdown behind the «i».
 */
function Review() {
  const w = useWords(MONEY);
  const lang = useLang();
  const review = useMoneyStore((st) => st.send.review);
  const name = useMoneyStore((st) => (st.send.name?.state === 'FOUND' ? st.send.name.name : null));
  const wallet = useMoneyStore((st) => st.wallet);
  const assetId = useMoneyStore((st) => st.send.assetId);
  if (!review) return null;
  const check = review.bundle.check;
  const symbol = chosenAsset(wallet, assetId)?.symbol ?? (check.asset.mint === null ? 'SOL' : '');
  const total = reviewTotal(check, symbol);
  const unread = w.unread;
  const sol = (value: string | null) => (value === null ? unread : `${digits(value)} SOL`);
  const totalText = total.whole ? digits([total.coin, total.sol].filter(Boolean).join(' + ')) : null;
  return (
    <div className={s.review} aria-label={w.review}>
      <span className={`${s.display} ${s.kicker}`}>{w.theyGet}</span>
      <b className={`${s.display} ${s.hero}`}>
        {digits(check.receive.amount)} {symbol}
      </b>
      <span className={s.fine} translate="no">
        {w.toWho(name ? `${name} · ${short(check.to.owner)}` : short(check.to.owner))}
      </span>
      <Terms
        label={w.transferDetails}
        line={
          <>
            {w.fee} <b>{digits(check.networkFee.sol)} SOL</b>
            {check.setup ? (
              <>
                {` · ${w.theirAccount} `}
                <b>{check.setup.sol === null ? '—' : `${digits(check.setup.sol)} SOL`}</b>
              </>
            ) : null}
            {check.minimum ? (
              <>
                {` · ${w.least} `}
                <b>{check.minimum.sol === null ? '—' : `${digits(check.minimum.sol)} SOL`}</b>
              </>
            ) : null}
            {` · ${w.totalWord} `}
            <b>{totalText ?? '—'}</b>
          </>
        }
      >
        <dt>{w.youSend}</dt>
        <dd>
          {digits(check.send.amount)} {symbol}
        </dd>
        {check.issuerFee ? (
          <>
            <dt>{w.issuerKeeps}</dt>
            <dd>
              {digits(check.issuerFee.amount)} {symbol}
            </dd>
          </>
        ) : null}
        <dt>{w.theyGet}</dt>
        <dd>
          {digits(check.receive.amount)} {symbol}
        </dd>
        <dt>{w.networkFee}</dt>
        <dd>{digits(check.networkFee.sol)} SOL</dd>
        {check.setup ? (
          <>
            <dt>{w.accountOpens}</dt>
            <dd>{sol(check.setup.sol)}</dd>
          </>
        ) : null}
        {check.minimum ? (
          <>
            <dt>{w.leastNew}</dt>
            <dd>{sol(check.minimum.sol)}</dd>
          </>
        ) : null}
        <dt>{w.leaves}</dt>
        <dd>{totalText ?? w.notEveryCost}</dd>
        <dt>{w.to}</dt>
        <dd translate="no">
          {name ? <b>{name} · </b> : null}
          {grouped(check.to.owner)}
        </dd>
      </Terms>
      {check.warnings.length ? (
        <ul className={s.warnings}>
          {check.warnings.map((warning) => (
            <li key={warning.code} className={warning.stops ? s.stop : ''}>
              {warning[lang] ?? warning.en}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What the engine settled: the chain read back, the transaction and the receipt. */
function SendDone() {
  const w = useWords(MONEY);
  const settled = useMoneyStore((st) => st.send.settled);
  const line = useMoneyStore((st) => st.send.line);
  if (!settled) return null;
  const word = settledWord(settled);
  return (
    <section className={s.tabBody} aria-label={w.sent}>
      <div className={`${s.result} ${word === 'Sent' ? s.resultGood : word === 'Not sent' ? s.resultBad : ''}`}>
        <span className={`${s.display} ${s.resultWord}`}>{word === 'Sent' ? w.sent : word === 'Not sent' ? w.notSent : w.notConfirmed}</span>
        <Note line={line} />
        <div className={s.links}>
          <a className={s.link} href={explorerTxUrl('mainnet', settled.signature)} target="_blank" rel="noreferrer">
            {w.onSolana(short(settled.signature))}
          </a>
          {settled.receipt ? (
            <button type="button" className={s.link} onClick={() => downloadReceipt(settled.receipt)}>
              {w.downloadReceipt}
            </button>
          ) : null}
        </div>
      </div>
      <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoneyStore.getState().newSend()}>
        {w.newTransfer}
      </button>
      <button type="button" className={s.link} onClick={() => useMoney.getState().setTab('activity')}>
        {w.seeInActivity}
      </button>
    </section>
  );
}

/** A transfer this device signed and never saw the end of, read back by its signature. */
function Resumed({ signature, state }: { signature: string; state: 'CHECKING' | 'LANDED' | 'FAILED' | 'UNKNOWN' }) {
  const w = useWords(MONEY);
  const text = state === 'CHECKING' ? w.resumeChecking : state === 'LANDED' ? w.resumeLanded : state === 'FAILED' ? w.resumeFailed : w.resumeUnknown;
  return (
    <div className={`${s.hold} ${state === 'LANDED' ? s.holdGood : ''}`} role="status">
      <span>{text}</span>
      <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
        {w.onSolana(short(signature))}
      </a>
    </div>
  );
}
