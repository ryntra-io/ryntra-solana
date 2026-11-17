'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { WALLET } from '@/terminal/shell/words';
import { Icon, Quiet } from '@/terminal/ui';
import { TICKET } from './words';
import s from './ticket.module.css';

/**
 * The wallets of this browser, inside the ticket: Phantom, Solflare, Backpack — whatever the Wallet Standard finds —
 * one tap each; with none, where to get one (on a phone, Ryntra opens inside Phantom's own browser). Connecting is the
 * city's one wallet store (`city/lib/trade/wallet.ts`): a wallet connected here is connected on every screen.
 */
export function WalletPick({ onBack }: { onBack: () => void }) {
  const w = useWords(WALLET);
  const t = useWords(TICKET);
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  return (
    <div className={s.wallets} role="group" aria-label={w.pick}>
      {wallets.length ? (
        wallets.map((wallet) => (
          <button key={wallet.name} type="button" className={s.door} disabled={Boolean(connecting)} onClick={() => void connect(wallet.name)}>
            <Icon name="wallet" size="s" />
            <span>{connecting === wallet.name ? w.opening(wallet.name) : wallet.name}</span>
            <Icon name="arrow" size="s" />
          </button>
        ))
      ) : (
        <>
          <p className={s.line}>{w.none}</p>
          <a className={s.door} href={phone ? phantomBrowseUrl(window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
            <Icon name="wallet" size="s" />
            <span>{phone ? w.openInPhantom : w.getPhantom}</span>
            <Icon name="arrow" size="s" />
          </a>
        </>
      )}
      {error ? (
        <p className={s.note} data-tone="error" role="alert">
          {error}
        </p>
      ) : null}
      <Quiet full onClick={onBack}>
        {t.back}
      </Quiet>
    </div>
  );
}
