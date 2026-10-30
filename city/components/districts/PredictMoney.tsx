'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usd } from '@/city/lib/districts/predict/markets';
import { rawUsd, usdcRaw, withdrawalWord, withdrawReason } from '@/city/lib/districts/predict/real';
import { movingWithdrawal, useReal } from '@/city/lib/districts/predict/real-store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { PREDICT } from '@/city/lib/districts/predict/words';
import { useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { CopyGlyph, PracticeCoin, UsdcCoin } from './predictGlyphs';
import { WalletPicker } from './PredictTicket';
import s from './predict.module.css';

/**
 * Money in and out of the Predictions account: Deposit is the account's own Solana address for USDC, with its code to
 * scan; Withdraw sends to the wallet you signed in with — never an address typed in — after the engine prices it.
 */
export function PredictMoney({ tab }: { tab: 'deposit' | 'withdraw' }) {
  const mode = usePredict((st) => st.mode);
  const go = usePredict((st) => st.go);
  const w = useWords(PREDICT);
  if (mode !== 'real') return <PracticeMoney />;
  return (
    <div className={s.money}>
      <div className={s.ticketTabs} role="tablist" aria-label={w.depositOrWithdraw}>
        {(['deposit', 'withdraw'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`${s.ticketTab} ${tab === t ? s.ticketTabOn : ''}`} onClick={() => go({ kind: 'money', tab: t })}>
            {t === 'deposit' ? w.deposit : w.withdraw}
          </button>
        ))}
      </div>
      <Account>{tab === 'deposit' ? <Deposit /> : <Withdraw />}</Account>
    </div>
  );
}

function PracticeMoney() {
  const cash = usePredict((st) => st.book.cash);
  const w = useWords(PREDICT);
  return (
    <div className={s.money}>
      <div className={s.summary}>
        <span className={s.summaryCoin}>
          <PracticeCoin />
        </span>
        <span className={s.summaryFigure}>{usd(cash)}</span>
        <span className={s.summaryWord}>{w.practiceDollars}</span>
      </div>
    </div>
  );
}

/** What stands before money: a wallet, its signature, an open account. */
function Account({ children }: { children: ReactNode }) {
  const connection = useWallet((st) => st.connection);
  const live = useReal((st) => (connection && st.owner === connection.address ? st.live : null));
  const liveRead = useReal((st) => st.liveRead);
  const opening = useReal((st) => st.opening);
  const openError = useReal((st) => st.openError);
  const start = useReal((st) => st.start);
  const [picking, setPicking] = useState(false);
  const w = useWords(PREDICT);
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);
  if (!connection) {
    if (picking) return <WalletPicker onBack={() => setPicking(false)} />;
    return (
      <button
        className={`${s.primary} ${s.action}`}
        onClick={() => {
          const { wallets, connect } = useWallet.getState();
          if (wallets.length === 1) void connect(wallets[0]!.name);
          else setPicking(true);
        }}
      >
        {w.connectWallet}
      </button>
    );
  }
  if (opening) return <button className={`${s.primary} ${s.action} ${s.waiting}`} disabled>{w.confirmIn(connection.wallet)}</button>;
  if (!live && liveRead === 'reading') return <button className={`${s.primary} ${s.action} ${s.waiting}`} disabled>{w.readingAccount}</button>;
  if (!live || !live.linked) {
    return (
      <>
        <button className={`${s.primary} ${s.action}`} onClick={() => void start(connection)}>
          {live ? w.openAccount : w.signIn}
        </button>
        {openError ? <div className={`${s.line} ${s.lineWarn}`}>{openError}</div> : null}
      </>
    );
  }
  if (live.access.state !== 'open') return <div className={s.empty}>{w.realSoonLine}</div>;
  return <>{children}</>;
}

function Deposit() {
  const funding = useReal((st) => st.funding);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const w = useWords(PREDICT);
  const address = funding?.deposit.state === 'ready' ? funding.deposit.address : null;
  useEffect(() => {
    if (!address) return;
    let live = true;
    // The code's module loads on the first Deposit; a load that fails is tried once more, and without it the address stands alone.
    const draw = () => import('qrcode').then((m) => m.toDataURL(address, { margin: 1, width: 360, color: { dark: '#0B0A14', light: '#EEF1FF' } }));
    void draw()
      .catch(() => new Promise<string>((resolve, reject) => setTimeout(() => draw().then(resolve, reject), 1200)))
      .then((url) => live && setQr(url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address]);
  if (!funding) return <div className={`${s.hero} ${s.cardLoading}`}><span className={s.shimmer} /></div>;
  if (!address) return <div className={s.empty}>{funding.deposit.state === 'preparing' ? w.addressMaking : w.depositsClosed}</div>;
  return (
    <div className={s.depositPage}>
      <div className={s.balanceBig}>
        <span className={s.summaryCoin}>
          <UsdcCoin />
        </span>
        <span className={s.summaryFigure}>{funding.available !== null ? usd(funding.available) : '—'}</span>
      </div>
      {qr ? (
        // A code of the address, made here from the engine's address.
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.qr} src={qr} alt="" width={180} height={180} />
      ) : (
        <span className={s.qrSpace} />
      )}
      <div className={s.addressLine}>
        <span className={s.address}>{shortAddress(address)}</span>
        <button
          className={s.copy}
          onClick={() => {
            void navigator.clipboard?.writeText(address).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          <CopyGlyph />
          {copied ? w.copied : w.copyAddress}
        </button>
      </div>
      <div className={s.line}>{w.sendOnly}</div>
    </div>
  );
}

function Withdraw() {
  const funding = useReal((st) => st.funding);
  const withdraw = useReal((st) => st.withdraw);
  const preview = useReal((st) => st.previewWithdraw);
  const confirm = useReal((st) => st.confirmWithdraw);
  const reset = useReal((st) => st.resetWithdraw);
  const [text, setText] = useState('');
  const w = useWords(PREDICT);
  // A Review belongs to the amount typed on this page: leaving the page puts it away.
  useEffect(() => () => reset(), [reset]);
  const raw = usdcRaw(text);
  const moving = movingWithdrawal(funding);
  const reviewing = withdraw.step === 'review' || withdraw.step === 'sending';
  let label = w.review;
  let press: () => void = () => raw && void preview({ amountRaw: raw });
  let disabled = !raw || withdraw.step === 'pricing';
  let note: string | null = null;
  let warn = false;
  if (withdraw.step === 'pricing') label = w.gettingFee;
  if (reviewing) {
    const p = withdraw.preview;
    if (p.quoted && p.receiveRaw) {
      label = withdraw.step === 'sending' ? w.sending : w.withdrawGet(usd(rawUsd(p.receiveRaw) ?? 0));
      press = () => void confirm();
      disabled = withdraw.step === 'sending';
      note = w.feeToWallet(usd(rawUsd(p.feeRaw) ?? 0));
    } else {
      [label, disabled, note, warn] = [w.review, true, withdrawReason(p.reason), true];
    }
  }
  if (withdraw.step === 'failed') [note, warn] = [withdraw.text, true];
  if (withdraw.step === 'sent') note = withdraw.phase === 'completed' ? w.arrived : withdraw.phase === 'unknown' ? w.checking : w.onItsWay;
  if (moving) [label, disabled, note] = [withdrawalWord(moving.phase), true, moving.amountUsd !== null ? w.toWallet(usd(moving.amountUsd)) : null];
  return (
    <div className={s.withdraw}>
      <div className={s.balanceBig}>
        <span className={s.summaryCoin}>
          <UsdcCoin />
        </span>
        <span className={s.summaryFigure}>{funding?.available !== null && funding?.available !== undefined ? usd(funding.available) : '—'}</span>
      </div>
      <label className={s.fieldLabel} htmlFor="predict-withdraw">
        {w.amountUsdc}
      </label>
      <div className={s.field}>
        <span className={s.fieldCoin}>
          <UsdcCoin />
        </span>
        <input
          id="predict-withdraw"
          className={s.fieldInput}
          inputMode="decimal"
          autoComplete="off"
          value={fieldText(text)}
          placeholder={fieldText('0.00')}
          onChange={(e) => {
            setText(fieldValue(e.target.value).replace(/[^0-9.]/g, ''));
            reset();
          }}
        />
        <button
          className={s.max}
          onClick={() => {
            if (funding?.available) setText(String(Math.floor(funding.available * 100) / 100));
            reset();
          }}
        >
          {w.max}
        </button>
      </div>
      <button className={`${s.primary} ${s.action} ${withdraw.step === 'pricing' || withdraw.step === 'sending' ? s.waiting : ''}`} onClick={press} disabled={disabled}>
        {label}
      </button>
      {note ? <div className={`${s.line} ${warn ? s.lineWarn : ''}`}>{note}</div> : null}
    </div>
  );
}
