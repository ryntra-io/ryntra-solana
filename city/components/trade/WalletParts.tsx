'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { createHoldingsWatch } from '@/city/lib/trade/holdings-watch';
import { BUSY, useTrade } from '@/city/lib/trade/store';
import { APP_WALLET, useWallet } from '@/city/lib/trade/wallet';
import {
  BACKPACK_DOWNLOAD_URL,
  isPhoneUserAgent,
  PHANTOM_DOWNLOAD_URL,
  phantomBrowseUrl,
  SOLFLARE_DOWNLOAD_URL,
  solflareBrowseUrl,
} from '@/lib/solana/open-in-wallet';
import { PICK } from './words';
import s from './trade.module.css';

/**
 * The wallet inside the trade card, for the market ticket and the limit and stop ticket alike: the list of wallets
 * this browser has, and the line that says who is trading.
 */

/** A wallet's name as the card says it: the wallets' own names, and the Ryntra app's wallet in the city's words. */
export function useWalletName(): (name: string) => string {
  const w = useWords(PICK);
  return (name) => (name === APP_WALLET ? w.appWallet : name);
}

/** Phantom, Solflare, Backpack — whatever this browser has, found the Wallet Standard way. */
/**
 * `back` — the address a phone's wallet app opens to come back to (CITY-222: the agent's card, `/?open=agent`), this page
 * when not given; `onLeave` — told which way the person left for a wallet, before the browser follows the link.
 */
export function WalletPicker({ onBack, back, onLeave }: { onBack: () => void; back?: string; onLeave?: (to: 'phantom' | 'solflare' | 'install') => void }) {
  const w = useWords(PICK);
  const nameOf = useWalletName();
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    const here = back ?? (typeof window === 'undefined' ? '' : window.location.href);
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return (
      <>
        <div className={s.walletHint}>
          {phone ? w.openInWalletApp : w.noWallet}
        </div>
        {/* CITY-237: the one action takes the card's width — «Open in Phantom» and «Back» side by side did not fit a
            phone's card, and «Back» was cut by its edge. «Back» stands in the quiet line under it, beside the other wallets. */}
        <a className={`${s.display} ${s.action}`} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} onClick={() => onLeave?.(phone ? 'phantom' : 'install')} data-wallet-go="">
          {phone ? w.openInPhantom : w.getPhantom}
        </a>
        <div className={s.walletWays}>
          <span className={s.walletHint}>
            {w.or}{' '}
            <a href={phone ? solflareBrowseUrl(here, origin) : SOLFLARE_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer" onClick={() => onLeave?.(phone ? 'solflare' : 'install')}>
              Solflare
            </a>
            {phone ? null : (
              <>
                {' · '}
                <a href={BACKPACK_DOWNLOAD_URL} target="_blank" rel="noreferrer" onClick={() => onLeave?.('install')}>
                  Backpack
                </a>
              </>
            )}
          </span>
          <button className={s.walletBack} onClick={onBack} data-wallet-back="">
            {w.back}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className={s.wallets}>
        {wallets.map((wallet) => (
          <button key={wallet.name} className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
            {connecting === wallet.name ? w.opening(nameOf(wallet.name)) : nameOf(wallet.name)}
          </button>
        ))}
      </div>
      {error && <div className={`${s.notice} ${s.noticeError}`}>{error}</div>}
      <button className={s.quiet} onClick={onBack} style={{ height: 40, paddingLeft: 0 }}>
        {w.back}
      </button>
    </>
  );
}

/* One watch for every card that asks for funds: a hidden tab reads nothing, two cards share one timer, a return to
   the page is one read (`holdings-watch.ts`). */
const watchHoldings = createHoldingsWatch({
  read: () => useWallet.getState().refreshHoldings(),
  visible: () => document.visibilityState === 'visible',
  now: () => Date.now(),
  every: (run, ms) => {
    const timer = window.setInterval(run, ms);
    return () => window.clearInterval(timer);
  },
  onReturn: (run) => {
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  },
});

/**
 * While a card asks for funds, the wallet's balance is read again — on return to the page and every 15 s while the page
 * is in view — so a top-up turns «Add SOL» back into the card's own action without a reload (CITY-222: the agent's
 * card; CITY-237: the tower's ticket and the money autopilot, whose «Add SOL» would otherwise stay after the SOL arrived).
 */
export function useHoldingsWatch(on: boolean): void {
  useEffect(() => (on ? watchHoldings() : undefined), [on]);
}

/** Who is trading: your colour, your address, and the way out. */
export function WalletLine() {
  const w = useWords(PICK);
  const nameOf = useWalletName();
  const connection = useWallet((st) => st.connection);
  const disconnect = useWallet((st) => st.disconnect);
  const phase = useTrade((st) => st.phase);
  // A limit's signature out holds the wallet too.
  const held = useTrade((st) => st.held);
  if (!connection) return null;
  return (
    <div className={s.walletLine} style={{ ['--player' as string]: colourOf(connection.address) }}>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.address}>{shortAddress(connection.address)}</span>
      <span>· {nameOf(connection.wallet)}</span>
      <button className={s.link} onClick={disconnect} disabled={BUSY.has(phase) || held}>
        {w.disconnect}
      </button>
    </div>
  );
}
