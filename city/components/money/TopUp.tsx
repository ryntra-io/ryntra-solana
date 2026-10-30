'use client';

import { useEffect, useState } from 'react';
import { DEPOSIT_MIN_USD, DEPOSIT_NETWORK_LABEL, DEPOSIT_NETWORKS, DEPOSIT_REFERENCE_USD } from '@/lib/relay/deposit-address';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { feeShort, feeWords, progressWords } from '@/city/lib/money/deposit';
import { flowLive } from '@/city/lib/money/flag';
import { grouped } from '@/city/lib/money/recipient';
import { useMoneyStore } from '@/city/lib/money/store';
import { CopyButton, More, Qr } from './bits';
import { MONEY } from './words';
import s from './money.module.css';

/** While an address from another network is on screen, Relay and the wallet are asked this often, this many times. */
const PROGRESS_MS = 15_000;
const PROGRESS_LIMIT = 240;

/**
 * Top up: money comes to this wallet's own address. On Solana it is the address itself, whole and as a QR — always
 * open, it only shows the address. From another network or an exchange that has no Solana, it is an address there
 * that pays USDC here (SOL-W1): money moving in through Relay, so it waits behind the money switch with Send and
 * Bridge. Nothing on this tab signs or sends.
 */
export function TopUp({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  const networks = flowLive('deposit');
  const deposit = useMoneyStore((st) => st.deposit);
  const [picked, setMode] = useState<'solana' | 'network'>(deposit.network ? 'network' : 'solana');
  const mode = networks ? picked : 'solana';

  return (
    <section className={s.tabBody} aria-label={w.topUp}>
      {networks ? (
        <div className={s.segment} role="tablist" aria-label={w.whereFrom}>
          <button type="button" role="tab" aria-selected={mode === 'solana'} className={mode === 'solana' ? s.segmentOn : ''} onClick={() => setMode('solana')}>
            {w.fromSolana}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'network'} className={mode === 'network' ? s.segmentOn : ''} onClick={() => setMode('network')}>
            {w.fromNetwork}
          </button>
        </div>
      ) : null}
      {mode === 'solana' ? <SolanaAddress owner={owner} /> : <NetworkAddress owner={owner} />}
    </section>
  );
}

/** The wallet's own address: the QR, the address whole, one copy. */
function SolanaAddress({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  return (
    <div className={s.address}>
      <Qr value={owner} label={w.qrSolana} />
      <div className={s.addressFacts}>
        <span className={s.label}>{w.yourAddress}</span>
        <p className={s.addressValue} translate="no">
          {grouped(owner)}
        </p>
        <span className={s.chip}>{w.solanaOnly}</span>
      </div>
      <CopyButton value={owner} primary />
      <More>
        <p className={s.fine}>{w.solanaFine}</p>
      </More>
    </div>
  );
}

/** An address on another network that Relay fills into this wallet as USDC on Solana. */
function NetworkAddress({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  const deposit = useMoneyStore((st) => st.deposit);
  const shown = deposit.address && deposit.address.recipient === owner && deposit.address.network === deposit.network ? deposit.address : null;

  useEffect(() => {
    if (!shown) return;
    let count = 0;
    const ask = () => {
      if (document.visibilityState !== 'visible' || count >= PROGRESS_LIMIT) return;
      count += 1;
      void useMoneyStore.getState().readDepositProgress();
    };
    ask();
    const timer = setInterval(ask, PROGRESS_MS);
    return () => clearInterval(timer);
  }, [shown]);

  const fee = shown ? feeShort(shown.feeUsd) : null;
  return (
    <div className={s.address}>
      <span className={s.label} id="money-networks">
        {w.whereUsdc}
      </span>
      <div className={s.chips} role="radiogroup" aria-labelledby="money-networks">
        {DEPOSIT_NETWORKS.map((network) => (
          <button
            key={network}
            type="button"
            role="radio"
            aria-checked={deposit.network === network}
            className={`${s.chipButton} ${deposit.network === network ? s.chipOn : ''}`}
            onClick={() => void useMoneyStore.getState().pickDeposit(network)}
          >
            {DEPOSIT_NETWORK_LABEL[network]}
          </button>
        ))}
      </div>
      {deposit.network === null ? null : deposit.status === 'failed' ? (
        <p className={s.note} role="alert">
          {w.addressFailed}{' '}
          <button type="button" className={s.link} onClick={() => void useMoneyStore.getState().pickDeposit(deposit.network!)}>
            {w.tryAgain}
          </button>
        </p>
      ) : !shown ? (
        <div className={s.bones} aria-label={w.askingAddress}>
          <span />
        </div>
      ) : (
        <>
          <Qr value={shown.address} label={w.qrNetwork(DEPOSIT_NETWORK_LABEL[shown.network])} />
          <div className={s.addressFacts}>
            <span className={s.label}>{w.sendOn(DEPOSIT_NETWORK_LABEL[shown.network])}</span>
            <p className={s.addressValue} translate="no">
              {grouped(shown.address)}
            </p>
            <span className={s.chip}>{[w.usdcOnly, w.fromMin(digits(`$${DEPOSIT_MIN_USD}`)), fee].filter(Boolean).join(' · ')}</span>
          </div>
          <CopyButton value={shown.address} primary />
          {deposit.progress && progressWords(deposit.progress.progress) ? (
            <p className={`${s.note} ${deposit.progress.progress === 'ARRIVED' ? s.noteGood : deposit.progress.progress === 'FAILED' ? s.noteError : ''}`} aria-live="polite">
              {progressWords(deposit.progress.progress)}
              {deposit.progress.amount ? ` ${digits(deposit.progress.amount)} USDC.` : ''}
            </p>
          ) : null}
          <More>
            <p className={s.fine}>{w.networkFine(feeWords(shown.feeUsd, DEPOSIT_REFERENCE_USD))}</p>
          </More>
        </>
      )}
    </div>
  );
}
