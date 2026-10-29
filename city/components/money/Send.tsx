'use client';

import { useEffect, useMemo, useState } from 'react';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { downloadReceipt } from '@/lib/solana/send-receipt-vault.client';
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
import s from './money.module.css';

/** Coins shown before «more»: a wallet of seventy tokens is not seventy chips. */
const COINS_SHOWN = 8;

const SHARES = [
  { label: '25%', numerator: 1n, denominator: 4n },
  { label: '50%', numerator: 1n, denominator: 2n },
  { label: 'Max', numerator: 1n, denominator: 1n },
] as const;

/**
 * Send: a coin to a Solana address or a `.skr` name. The engine reads who it is, builds the exact transfer and its
 * Review — what leaves, the fee, what they get, an account opened for them — before the wallet opens; the person
 * signs in their own wallet and the engine sends it once and reads the chain back. Behind the money switch until the
 * owner's canary passes.
 */
export function Send({ owner }: { owner: string }) {
  if (!MONEY_OPEN) {
    return (
      <Soon title="Send">
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
          Top up instead
        </button>
      </Soon>
    );
  }
  return <SendForm owner={owner} />;
}

function SendForm({ owner }: { owner: string }) {
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
    <section className={s.tabBody} aria-label="Send">
      {send.resumed ? <Resumed signature={send.resumed.signature} state={send.resumed.state} /> : null}

      <span className={s.label} id="money-coin">
        Coin
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
              <CoinIcon mint={coin.mint} size={20} />
              {coin.symbol}
            </button>
          ))}
          {shown.length < coins.length ? (
            <button type="button" className={s.coinChip} onClick={() => setAllCoins(true)} disabled={!idle}>
              +{coins.length - shown.length} more
            </button>
          ) : null}
        </div>
      ) : wallet ? (
        <div className={s.bar}>
          <p className={s.empty}>Nothing to send yet.</p>
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
            Top up
          </button>
        </div>
      ) : walletRead === 'failed' ? (
        <p className={s.empty}>
          Balances unavailable.{' '}
          <button type="button" className={s.link} onClick={() => useMoneyStore.getState().readWallet()}>
            Try again
          </button>
        </p>
      ) : (
        <div className={s.bones} aria-label="Reading your balances">
          <span />
        </div>
      )}

      <label className={s.label} htmlFor="money-to">
        To
      </label>
      <div className={s.field}>
        <input
          id="money-to"
          className={s.input}
          value={send.to}
          onChange={(event) => useMoneyStore.getState().setTo(event.target.value)}
          placeholder="Solana address or name.skr"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          disabled={!idle}
        />
        {canPaste && !send.to ? (
          <button type="button" className={s.inline} onClick={() => void paste()} disabled={!idle}>
            Paste
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
          Open the payment link
        </a>
      ) : null}

      {gate.recipient && gate.lookalike ? (
        <div className={s.hold} role="alert">
          <span>{gate.lookalike === owner ? 'Looks like your address — it is not.' : 'Looks like a recent address — it is not.'}</span>
          <code translate="no">{grouped(gate.recipient)}</code>
          {gate.action === 'accept-lookalike' ? (
            <button type="button" className={s.inline} onClick={() => useMoneyStore.getState().acceptLookalike()}>
              It is the right address
            </button>
          ) : null}
        </div>
      ) : null}
      {gate.recipient && gate.isNew ? (
        <div className={s.hold} role="alert">
          <span>New address. Check it with whoever gave it.</span>
          {gate.lookalike ? null : <code translate="no">{grouped(gate.recipient)}</code>}
          {gate.action === 'accept-fresh' ? (
            <button type="button" className={s.inline} onClick={() => useMoneyStore.getState().acceptFresh()}>
              Address checked
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.amountHead}>
        <label className={s.label} htmlFor="money-amount">
          Amount
        </label>
        {asset ? (
          <span className={s.balance}>
            {formatAmount(asset.spendableRaw, asset.decimals)} {asset.symbol} available
          </span>
        ) : null}
      </div>
      <div className={s.field}>
        <input
          id="money-amount"
          className={`${s.input} ${s.amount}`}
          value={send.amount}
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
              key={share.label}
              type="button"
              className={s.share}
              disabled={!idle}
              onClick={() => useMoneyStore.getState().setAmount(shareOf(asset.spendableRaw, asset.decimals, share.numerator, share.denominator))}
            >
              {share.label}
            </button>
          ))}
        </div>
      ) : null}
      {gate.amountLine ? <Note line={{ tone: 'error', text: gate.amountLine }} /> : null}

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
    </section>
  );
}

/**
 * The engine's Review of this exact transfer, before the wallet opens: what they get, to whom, and one line with the
 * fee, an account opened for them, the least a new address takes and the total — the breakdown behind the «i».
 */
function Review() {
  const review = useMoneyStore((st) => st.send.review);
  const name = useMoneyStore((st) => (st.send.name?.state === 'FOUND' ? st.send.name.name : null));
  const wallet = useMoneyStore((st) => st.wallet);
  const assetId = useMoneyStore((st) => st.send.assetId);
  if (!review) return null;
  const check = review.bundle.check;
  const symbol = chosenAsset(wallet, assetId)?.symbol ?? (check.asset.mint === null ? 'SOL' : '');
  const total = reviewTotal(check, symbol);
  const unread = 'Could not be read';
  return (
    <div className={s.review} aria-label="Review">
      <span className={`${s.display} ${s.kicker}`}>They get</span>
      <b className={`${s.display} ${s.hero}`}>
        {check.receive.amount} {symbol}
      </b>
      <span className={s.fine} translate="no">
        to {name ? `${name} · ` : ''}
        {short(check.to.owner)}
      </span>
      <Terms
        label="Transfer details"
        line={
          <>
            Fee <b>{check.networkFee.sol} SOL</b>
            {check.setup ? (
              <>
                {' · their account '}
                <b>{check.setup.sol === null ? '—' : `${check.setup.sol} SOL`}</b>
              </>
            ) : null}
            {check.minimum ? (
              <>
                {' · least '}
                <b>{check.minimum.sol === null ? '—' : `${check.minimum.sol} SOL`}</b>
              </>
            ) : null}
            {' · total '}
            <b>{total.whole ? [total.coin, total.sol].filter(Boolean).join(' + ') : '—'}</b>
          </>
        }
      >
        <dt>You send</dt>
        <dd>
          {check.send.amount} {symbol}
        </dd>
        {check.issuerFee ? (
          <>
            <dt>The coin&apos;s issuer keeps</dt>
            <dd>
              {check.issuerFee.amount} {symbol}
            </dd>
          </>
        ) : null}
        <dt>They get</dt>
        <dd>
          {check.receive.amount} {symbol}
        </dd>
        <dt>Network fee</dt>
        <dd>{check.networkFee.sol} SOL</dd>
        {check.setup ? (
          <>
            <dt>Their account opens</dt>
            <dd>{check.setup.sol === null ? unread : `${check.setup.sol} SOL`}</dd>
          </>
        ) : null}
        {check.minimum ? (
          <>
            <dt>Least a new address takes</dt>
            <dd>{check.minimum.sol === null ? unread : `${check.minimum.sol} SOL`}</dd>
          </>
        ) : null}
        <dt>Leaves your wallet</dt>
        <dd>{total.whole ? [total.coin, total.sol].filter(Boolean).join(' + ') : 'Not every cost could be read'}</dd>
        <dt>To</dt>
        <dd translate="no">
          {name ? <b>{name} · </b> : null}
          {grouped(check.to.owner)}
        </dd>
      </Terms>
      {check.warnings.length ? (
        <ul className={s.warnings}>
          {check.warnings.map((warning) => (
            <li key={warning.code} className={warning.stops ? s.stop : ''}>
              {warning.en}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What the engine settled: the chain read back, the transaction and the receipt. */
function SendDone() {
  const settled = useMoneyStore((st) => st.send.settled);
  const line = useMoneyStore((st) => st.send.line);
  if (!settled) return null;
  const word = settledWord(settled);
  return (
    <section className={s.tabBody} aria-label="Sent">
      <div className={`${s.result} ${word === 'Sent' ? s.resultGood : word === 'Not sent' ? s.resultBad : ''}`}>
        <span className={`${s.display} ${s.resultWord}`}>{word}</span>
        <Note line={line} />
        <div className={s.links}>
          <a className={s.link} href={explorerTxUrl('mainnet', settled.signature)} target="_blank" rel="noreferrer">
            {short(settled.signature)} on Solana
          </a>
          {settled.receipt ? (
            <button type="button" className={s.link} onClick={() => downloadReceipt(settled.receipt)}>
              Download receipt
            </button>
          ) : null}
        </div>
      </div>
      <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoneyStore.getState().newSend()}>
        New transfer
      </button>
      <button type="button" className={s.link} onClick={() => useMoney.getState().setTab('activity')}>
        See it in Activity
      </button>
    </section>
  );
}

/** A transfer this device signed and never saw the end of, read back by its signature. */
function Resumed({ signature, state }: { signature: string; state: 'CHECKING' | 'LANDED' | 'FAILED' | 'UNKNOWN' }) {
  const text =
    state === 'CHECKING'
      ? 'Checking an earlier transfer…'
      : state === 'LANDED'
        ? 'Your earlier transfer arrived.'
        : state === 'FAILED'
          ? 'Your earlier transfer did not go through. Nothing moved.'
          : 'An earlier transfer is still being confirmed. Do not send it again.';
  return (
    <div className={`${s.hold} ${state === 'LANDED' ? s.holdGood : ''}`} role="status">
      <span>{text}</span>
      <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
        {short(signature)} on Solana
      </a>
    </div>
  );
}
