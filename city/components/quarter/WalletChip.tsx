'use client';

import { useEffect, useRef, useState } from 'react';
import { useBackPanel } from '@/city/lib/back/panels';
import { useWords } from '@/city/lib/i18n/dict';
import { cityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { openSettings } from '@/city/lib/settings/view';
import { PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import s from '../hud/hud.module.css';
import q from './quarter.module.css';
import w from './wallet.module.css';
import { QUARTER } from './words';

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
  const t = useWords(QUARTER);

  // A tap outside or Escape closes the menu; a list of wallets left open closes with it.
  const showing = open || step === 'pick' || Boolean(error);
  const close = () => {
    setOpen(false);
    const a = cityAccount.getState();
    a.cancel();
    if (a.from === 'top' && a.error) cityAccount.setState({ error: null });
  };
  // «Back» closes the menu first, in the city and in Play alike (CITY-150).
  useBackPanel('wallet', showing, close);
  useEffect(() => {
    if (!showing) return;
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
    const label = step === 'connecting' ? t.opening(to ?? t.aWallet) : step === 'signing' ? t.checkYourWallet : t.connect;
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
          <div className={`${s.panel} ${w.menu}`} role="dialog" aria-label={t.connect}>
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
        aria-label={t.walletOf(shortAddress(connection.address), signed)}
      >
        <span className={`${w.dot} ${signed ? '' : w.dotWait}`} aria-hidden="true" />
        <span className={`${w.address} ${w.long}`}>{step === 'signing' ? t.checkWallet : shortAddress(connection.address)}</span>
      </button>
      {showing && (
        <div className={`${s.panel} ${w.menu}`} role="dialog" aria-label={t.wallet}>
          <div className={w.head}>
            <span className={w.address}>{shortAddress(connection.address)}</span> · {connection.wallet}
          </div>
          <div className={w.note}>
            {signed ? t.signedIn : ready === 'checking' ? t.checking : t.notSignedIn}
          </div>
          {error ? <div className={`${w.note} ${w.error}`}>{error}</div> : null}
          {/* The avatar's window (CITY-87): wallet, trading, notifications, layouts, language, sound, display, security. */}
          <button
            className={w.settings}
            aria-haspopup="dialog"
            onClick={() => {
              setOpen(false);
              openSettings('wallet');
            }}
          >
            <GearGlyph />
            {t.settings}
          </button>
          <div className={w.row}>
            {!signed && (
              <button className={`${s.display} ${w.act}`} onClick={signIn} disabled={busy || ready === 'checking'} aria-busy={busy}>
                {step === 'signing' ? t.checkYourWallet : busy ? t.openingPlain : t.signIn}
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
              {t.disconnect}
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
  const t = useWords(QUARTER);
  if (!wallets.length) {
    return (
      <div className={w.note}>
        {t.noWallet}{' '}
        <a href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          {t.getPhantom}
        </a>
        {t.comeBack}
      </div>
    );
  }
  return (
    <>
      <div className={w.head}>{t.pickWallet}</div>
      <div className={q.wallets}>
        {wallets.map((wallet) => (
          <button key={wallet.name} className={q.choice} onClick={() => void cityAccount.getState().pick(wallet.name)}>
            <b>{wallet.name}</b>
          </button>
        ))}
      </div>
      <div className={w.note}>{t.oneMessage}</div>
    </>
  );
}

/** Settings, in the wallet's menu. */
function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 2.8h3.4l.5 2.6a7.4 7.4 0 0 1 1.8 1l2.5-.9 1.7 2.9-2 1.8a7.4 7.4 0 0 1 0 2l2 1.8-1.7 2.9-2.5-.9a7.4 7.4 0 0 1-1.8 1l-.5 2.6h-3.4l-.5-2.6a7.4 7.4 0 0 1-1.8-1l-2.5.9-1.7-2.9 2-1.8a7.4 7.4 0 0 1 0-2l-2-1.8 1.7-2.9 2.5.9a7.4 7.4 0 0 1 1.8-1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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
