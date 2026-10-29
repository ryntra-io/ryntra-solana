'use client';

import { useEffect, useRef, useState } from 'react';
import { cityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import s from '../hud/hud.module.css';
import q from './quarter.module.css';
import w from './wallet.module.css';

/**
 * The wallet in the top bar: «Connect wallet» when there is none — it connects and signs in to Ryntra with one
 * message, no transaction — and the short address once it is here, with a small menu to sign in or disconnect.
 * The same wallet the trade card uses; the city stays open without it, only building needs it.
 */
export function WalletChip() {
  const connection = useWallet((st) => st.connection);
  const ready = useReadiness();
  const step = useCityAccount((st) => (st.from === 'top' ? st.step : null));
  const to = useCityAccount((st) => st.connectingTo);
  const error = useCityAccount((st) => (st.from === 'top' ? st.error : null));
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // A tap outside or Escape closes the menu; a list of wallets left open closes with it.
  const showing = open || step === 'pick' || Boolean(error);
  useEffect(() => {
    if (!showing) return;
    const close = () => {
      setOpen(false);
      const a = cityAccount.getState();
      a.cancel();
      if (a.from === 'top' && a.error) cityAccount.setState({ error: null });
    };
    const outside = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
    };
  }, [showing]);
  // Once signed in from here, the menu has done its job.
  useEffect(() => {
    if (ready === 'ready' && step === null) setOpen(false);
  }, [ready, step]);

  const busy = step === 'connecting' || step === 'signing' || step === 'opening';
  const signIn = () => void cityAccount.getState().begin(null, 'top');

  if (!connection) {
    const label = step === 'connecting' ? `Opening ${to ?? 'wallet'}…` : step === 'signing' ? 'Check your wallet' : 'Connect wallet';
    return (
      <div className={w.wrap} ref={wrap}>
        <button
          className={`${s.panel} ${s.chip} ${w.chip}`}
          onClick={() => (step === 'pick' ? cityAccount.getState().cancel() : signIn())}
          disabled={busy}
          aria-busy={busy}
          aria-expanded={step === 'pick'}
          aria-label={label}
        >
          <span className={w.long}>{label}</span>
          <span className={w.short} aria-hidden="true">
            <WalletGlyph />
          </span>
        </button>
        {(step === 'pick' || error) && (
          <div className={`${s.panel} ${w.menu}`} role="dialog" aria-label="Connect wallet">
            {step === 'pick' ? <WalletList /> : null}
            {error ? <div className={`${w.note} ${w.error}`}>{error}</div> : null}
          </div>
        )}
      </div>
    );
  }

  const signed = ready === 'ready';
  return (
    <div className={w.wrap} ref={wrap}>
      <button
        className={`${s.panel} ${s.chip} ${w.chip}`}
        style={{ ['--player' as string]: colourOf(connection.address) }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={showing}
        aria-label={`Wallet ${shortAddress(connection.address)}${signed ? '' : ', not signed in'}`}
      >
        <span className={`${w.dot} ${signed ? '' : w.dotWait}`} aria-hidden="true" />
        <span className={`${w.address} ${w.long}`}>{step === 'signing' ? 'Check wallet' : shortAddress(connection.address)}</span>
      </button>
      {showing && (
        <div className={`${s.panel} ${w.menu}`} role="dialog" aria-label="Wallet">
          <div className={w.head}>
            <span className={w.address}>{shortAddress(connection.address)}</span> · {connection.wallet}
          </div>
          <div className={w.note}>
            {signed
              ? 'Signed in. Your quarter is kept under this wallet.'
              : ready === 'checking'
                ? 'Checking your sign-in…'
                : 'Not signed in. Sign one message to build here. No transaction.'}
          </div>
          {error ? <div className={`${w.note} ${w.error}`}>{error}</div> : null}
          <div className={w.row}>
            {!signed && (
              <button className={`${s.display} ${w.act}`} onClick={signIn} disabled={busy || ready === 'checking'} aria-busy={busy}>
                {step === 'signing' ? 'Check your wallet' : busy ? 'Opening…' : 'Sign in'}
              </button>
            )}
            <button
              className={q.quiet}
              onClick={() => {
                setOpen(false);
                void cityAccount.getState().disconnect();
              }}
              disabled={busy}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Phantom, Solflare, Backpack — whatever this browser has; none found says where to get one. */
function WalletList() {
  const wallets = useWallet((st) => st.wallets);
  if (!wallets.length) {
    return (
      <div className={w.note}>
        No Solana wallet in this browser.{' '}
        <a href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Get Phantom
        </a>
        , then come back.
      </div>
    );
  }
  return (
    <>
      <div className={w.head}>Pick a wallet</div>
      <div className={q.wallets}>
        {wallets.map((wallet) => (
          <button key={wallet.name} className={q.choice} onClick={() => void cityAccount.getState().pick(wallet.name)}>
            <b>{wallet.name}</b>
          </button>
        ))}
      </div>
      <div className={w.note}>One message to sign in. No transaction, nothing moves.</div>
    </>
  );
}

/** A wallet, for the narrow top bar of a phone. */
function WalletGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5Z" />
      <path d="M4 7.5 15.5 4.5v3" />
      <circle cx="16" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
