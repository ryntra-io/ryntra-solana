'use client';

import { useEffect, useRef, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { cityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { Action, Chip, Icon, Quiet } from '@/terminal/ui';
import { SEEKER_CONNECT_WALLET } from '@/lib/solana/seeker-connect';
import { closePanel, togglePanel, useFrame } from './frame';
import { useDismiss } from './useDismiss';
import { headerWalletShows, walletLineCalm, walletsInOrder } from './wallet-panel';
import { WALLET } from './words';
import s from './shell.module.css';

/**
 * The wallet, on the city's own logic: the one wallet store every window uses (`city/lib/trade/wallet.ts`) and the
 * account flow that connects and signs in to Ryntra with one message, no transaction (`city/lib/quarter/account-live.ts`).
 * The header shows «Connect wallet», or the short address with its menu: sign in, disconnect.
 */
export function WalletButton() {
  const w = useWords(WALLET);
  const connection = useWallet((st) => st.connection);
  const ready = useReadiness();
  const step = useCityAccount((st) => (st.from === 'top' ? st.step : null));
  const to = useCityAccount((st) => st.connectingTo);
  const error = useCityAccount((st) => (st.from === 'top' ? st.error : null));
  const open = useFrame((st) => st.panel === 'wallet');
  // The phone's sheet holds the wallet while it is open: its list of wallets is the sheet's, and nothing here closes it.
  const sheet = useFrame((st) => st.panel === 'sheet');
  const wrap = useRef<HTMLDivElement>(null);
  const showing = headerWalletShows({ sheet, open, connected: connection !== null, picking: step === 'pick', error: Boolean(error) });
  useDismiss(showing, wrap, dismissWallet);
  // A wallet that lets go (locked, switched off) takes its menu with it: no empty panel under the button.
  useEffect(() => {
    if (!connection) closePanel('wallet');
  }, [connection]);
  // Once signed in from here, the menu has done its job.
  useEffect(() => {
    if (ready === 'ready' && step === null) closePanel('wallet');
  }, [ready, step]);
  const busy = step === 'connecting' || step === 'signing' || step === 'opening';

  if (!connection) {
    const label = step === 'connecting' ? w.opening(to ?? w.aWallet) : step === 'signing' ? w.checkYourWallet : w.connect;
    return (
      <div className={s.anchor} ref={wrap}>
        <button
          type="button"
          className={s.wallet}
          data-terminal="wallet"
          data-connect=""
          disabled={busy}
          aria-busy={busy || undefined}
          aria-expanded={step === 'pick'}
          aria-haspopup="dialog"
          onClick={() => (step === 'pick' ? cityAccount.getState().cancel() : connectWallet())}
        >
          {/* On a phone the button is this icon alone, beside the bell: the wallet one tap from the first screen. */}
          <Icon name="portfolio" className={s.walletIcon} />
          <span className={s.walletText}>{label}</span>
        </button>
        {showing ? (
          <>
            {/* On a phone the sign-in is a sheet from the bottom (v2, «Вхід одним вікном»); a tap on the shade closes it. */}
            {step === 'pick' ? <div className={s.loginShade} aria-hidden="true" onPointerDown={dismissWallet} /> : null}
            <div className={s.pop} role="dialog" aria-modal={step === 'pick' || undefined} aria-label={w.signInTitle} data-login={step === 'pick' ? '' : undefined}>
              <WalletPanel />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  const signed = ready === 'ready';
  return (
    <div className={s.anchor} ref={wrap}>
      <button type="button" className={s.wallet} data-terminal="wallet" aria-expanded={showing} aria-haspopup="dialog" aria-label={w.walletOf(shortAddress(connection.address), signed)} onClick={() => togglePanel('wallet')}>
        <span className={s.live} data-wait={signed ? undefined : ''} aria-hidden="true" />
        <span>{step === 'signing' ? w.checkYourWallet : shortAddress(connection.address)}</span>
      </button>
      {showing ? (
        <div className={s.pop} role="dialog" aria-label={w.wallet}>
          <WalletPanel />
        </div>
      ) : null}
    </div>
  );
}

/** Connect and sign in with one message — the header's own request, so its one line shows here. */
export function connectWallet(): void {
  void cityAccount.getState().begin(null, 'top');
}

function dismissWallet(): void {
  closePanel('wallet');
  cancelWallet();
}

/** A list of wallets left open closes, and the last step's line goes with it: nothing is connected by it. */
export function cancelWallet(): void {
  const account = cityAccount.getState();
  account.cancel();
  if (account.from === 'top' && account.error) cityAccount.setState({ error: null });
}

/**
 * What the wallet's panel holds, in the header's menu and in the phone's sheet alike: the list of wallets to pick, or
 * the connected one with its sign-in and «Disconnect»; one honest line when a step did not go.
 */
export function WalletPanel({ inSheet = false }: { inSheet?: boolean }) {
  const w = useWords(WALLET);
  const connection = useWallet((st) => st.connection);
  const ready = useReadiness();
  const step = useCityAccount((st) => (st.from === 'top' ? st.step : null));
  const to = useCityAccount((st) => st.connectingTo);
  const error = useCityAccount((st) => (st.from === 'top' ? st.error : null));
  const busy = step === 'connecting' || step === 'signing' || step === 'opening';

  if (!connection) {
    return (
      <>
        {step === 'pick' ? <WalletList /> : inSheet ? (
          <Quiet full disabled={busy} aria-busy={busy || undefined} onClick={connectWallet}>
            <Icon name="wallet" size="s" />
            {step === 'connecting' ? w.opening(to ?? w.aWallet) : step === 'signing' ? w.checkYourWallet : w.connect}
          </Quiet>
        ) : null}
        {error ? <p className={walletLineCalm(error) ? s.popLine : s.popError}>{error}</p> : null}
      </>
    );
  }
  const signed = ready === 'ready';
  return (
    <>
      <div className={s.popHead}>
        <span>
          {shortAddress(connection.address)} · {connection.wallet}
        </span>
        <span className={s.live} data-wait={signed ? undefined : ''} aria-hidden="true" />
      </div>
      <p className={s.popLine}>{signed ? w.signedIn : ready === 'checking' ? w.checking : w.notSignedIn}</p>
      {error ? <p className={walletLineCalm(error) ? s.popLine : s.popError}>{error}</p> : null}
      <div className={s.popRow}>
        {!signed ? (
          <Quiet disabled={busy || ready === 'checking'} aria-busy={busy || undefined} onClick={connectWallet}>
            {step === 'signing' ? w.checkYourWallet : w.signIn}
          </Quiet>
        ) : null}
        <Quiet
          disabled={busy}
          onClick={() => {
            closePanel('wallet');
            void cityAccount.getState().disconnect();
          }}
        >
          {w.disconnect}
        </Quiet>
      </div>
    </>
  );
}

/** A wallet's name as a person reads it: the Seeker's own is «Seeker». */
function walletName(name: string): string {
  return name === SEEKER_CONNECT_WALLET ? 'Seeker' : name;
}

/**
 * Sign-in in one window (v2, kadr `A-LoginPhone`): what it is in one line, the wallets with the Seeker's first and
 * recommended, one amber «Sign in with …» for the first, and one calm line — closing the wallet's window changes nothing.
 * A tap on any row signs in with that wallet. Phantom, Solflare, Backpack — whatever this browser has; none found says
 * where to get one.
 */
function WalletList() {
  const w = useWords(WALLET);
  const wallets = useWallet((st) => st.wallets);
  // A phone's browser has no wallet of its own: Ryntra opens inside Phantom's; a computer gets the wallet.
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    return (
      <>
        <p className={s.popLine}>{w.none}</p>
        <a className={s.door} href={phone ? phantomBrowseUrl(window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
          <Icon name="wallet" />
          <span>{phone ? w.openInPhantom : w.getPhantom}</span>
          <Icon name="arrow" size="s" />
        </a>
      </>
    );
  }
  const list = walletsInOrder(wallets);
  const first = list[0]!;
  const pick = (name: string) => void cityAccount.getState().pick(name);
  return (
    <div className={s.login}>
      <div className={s.loginHead}>
        <h2 className={s.loginTitle}>{w.signInTitle}</h2>
        <p className={s.loginLine}>{w.oneSign}</p>
      </div>
      <div className={s.choices}>
        {list.map((wallet, i) => {
          const seeker = wallet.name === SEEKER_CONNECT_WALLET;
          return (
            <button key={wallet.name} type="button" className={s.choice} data-first={i === 0 && seeker ? '' : undefined} onClick={() => pick(wallet.name)}>
              {wallet.icon ? (
                // A wallet's own icon, as the wallet gives it (a data address): nothing for the image optimiser to do.
                // eslint-disable-next-line @next/next/no-img-element
                <img className={s.walletLogo} src={wallet.icon} alt="" />
              ) : (
                <span className={s.walletDisc} aria-hidden="true">
                  {walletName(wallet.name).slice(0, 1)}
                </span>
              )}
              <span className={s.choiceWords}>
                <span>{walletName(wallet.name)}</span>
                {seeker ? <span className={s.choiceSub}>{w.inYourPhone}</span> : null}
              </span>
              {seeker ? <Chip tone="warn">{w.recommended}</Chip> : <Icon name="arrow" size="s" />}
            </button>
          );
        })}
      </div>
      <Action onClick={() => pick(first.name)}>{w.signInWith(walletName(first.name))}</Action>
      <p className={s.loginCalm}>
        <Icon name="shield" size="s" />
        {w.closeCalm}
      </p>
    </div>
  );
}
