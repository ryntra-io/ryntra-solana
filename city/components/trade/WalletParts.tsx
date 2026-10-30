'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
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
export function WalletPicker({ onBack }: { onBack: () => void }) {
  const w = useWords(PICK);
  const nameOf = useWalletName();
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    const here = typeof window === 'undefined' ? '' : window.location.href;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return (
      <>
        <div className={s.walletHint}>
          {phone ? w.openInWalletApp : w.noWallet}
        </div>
        <div className={s.pair}>
          <a className={`${s.display} ${s.action}`} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
            {phone ? w.openInPhantom : w.getPhantom}
          </a>
          <button className={s.quiet} onClick={onBack}>
            {w.back}
          </button>
        </div>
        <div className={s.walletHint}>
          {w.or}{' '}
          <a href={phone ? solflareBrowseUrl(here, origin) : SOLFLARE_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
            Solflare
          </a>
          {phone ? null : (
            <>
              {' · '}
              <a href={BACKPACK_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                Backpack
              </a>
            </>
          )}
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
