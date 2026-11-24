'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { seekerRegistered } from '@/lib/solana/wallet.client';
import { placeOf, walletRows } from '@/terminal/shell/wallet-catalog';
import { WALLET } from '@/terminal/shell/words';
import { CoinLogo, Icon, Quiet } from '@/terminal/ui';
import { TICKET } from './words';
import s from './ticket.module.css';

type Row = Readonly<{ key: string; wallet: string; name: string; logo: string | null; seeker: boolean }>;

/**
 * The wallets of this browser, inside the ticket: Phantom, Solflare, Backpack — whatever the Wallet Standard finds —
 * one tap each; with none, where to get one (on a phone, Ryntra opens inside Phantom's own browser). Connecting is the
 * city's one wallet store (`city/lib/trade/wallet.ts`): a wallet connected here is connected on every screen.
 *
 * On Android, the Seeker's wallet registered but not yet
 * listed stands first as well.
 */
export function WalletPick({ onBack }: { onBack: () => void }) {
  const w = useWords(WALLET);
  const t = useWords(TICKET);
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  const [android, setAndroid] = useState(false);
  useEffect(() => {
    setPhone(isPhoneUserAgent(navigator.userAgent));
    setAndroid(placeOf(navigator.userAgent) === 'android' && seekerRegistered());
  }, []);
  const { installed, more } = walletRows(wallets, android ? 'android' : 'desk', { url: '', origin: '' }, android);
  const seekerRow = more.find((row) => row.kind === 'seeker');
  const rows: Row[] = [...(seekerRow ? [{ key: seekerRow.key, wallet: seekerRow.wallet, name: seekerRow.name, logo: seekerRow.logo, seeker: true }] : []), ...installed];
  return (
    <div className={s.wallets} role="group" aria-label={w.pick}>
      {rows.length ? (
        rows.map((row) => (
          <button key={row.key} type="button" className={s.door} disabled={Boolean(connecting)} onClick={() => void connect(row.wallet)} data-wallet={row.seeker ? 'seeker' : row.key}>
            <DoorLogo src={row.logo} name={row.name} />
            <span className={s.doorWords}>
              <span>{connecting === row.wallet ? w.opening(row.name) : row.name}</span>
              {row.seeker ? <span className={s.doorSub}>{w.seedVault}</span> : null}
            </span>
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

/** A wallet's logo — the one it registered, or the catalog's own — or its letter when there is none: the kit's round logo. */
function DoorLogo({ src, name }: { src: string | null; name: string }) {
  return <CoinLogo src={src} symbol={name} size="s" eager />;
}
