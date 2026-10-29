'use client';

import { useEffect, useState } from 'react';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { BUSY, useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import {
  BACKPACK_DOWNLOAD_URL,
  isPhoneUserAgent,
  PHANTOM_DOWNLOAD_URL,
  phantomBrowseUrl,
  SOLFLARE_DOWNLOAD_URL,
  solflareBrowseUrl,
} from '@/lib/solana/open-in-wallet';
import s from './trade.module.css';

/**
 * The wallet inside the trade card, for the market ticket and the limit and stop ticket alike: the list of wallets
 * this browser has, and the line that says who is trading.
 */

/** Phantom, Solflare, Backpack — whatever this browser has, found the Wallet Standard way. */
export function WalletPicker({ onBack }: { onBack: () => void }) {
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
          {phone ? 'Open Ryntra in your wallet app' : 'No Solana wallet found'}
        </div>
        <div className={s.pair}>
          <a className={`${s.display} ${s.action}`} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
            {phone ? 'Open in Phantom' : 'Get Phantom'}
          </a>
          <button className={s.quiet} onClick={onBack}>
            Back
          </button>
        </div>
        <div className={s.walletHint}>
          Or{' '}
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
            {connecting === wallet.name ? `Opening ${wallet.name}…` : wallet.name}
          </button>
        ))}
      </div>
      {error && <div className={`${s.notice} ${s.noticeError}`}>{error}</div>}
      <button className={s.quiet} onClick={onBack} style={{ height: 40, paddingLeft: 0 }}>
        Back
      </button>
    </>
  );
}

/** Who is trading: your colour, your address, and the way out. */
export function WalletLine() {
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
      <span>· {connection.wallet}</span>
      <button className={s.link} onClick={disconnect} disabled={BUSY.has(phase) || held}>
        Disconnect
      </button>
    </div>
  );
}
