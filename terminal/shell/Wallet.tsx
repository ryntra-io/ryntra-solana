'use client';

import { useEffect, useRef, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { cityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { seekerRegistered } from '@/lib/solana/wallet.client';
import { Action, Chip, Icon, Kick, Quiet } from '@/terminal/ui';
import { closePanel, togglePanel, useFrame } from './frame';
import { MenuIcon } from './menu-icons';
import { useDismiss } from './useDismiss';
import { KNOWN, placeOf, walletRows, type GetRow, type Here, type Place } from './wallet-catalog';
import { headerWalletShows, walletLineCalm } from './wallet-panel';
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
  // With no wallet, the window's logos are fetched while the page is idle: it never opens on empty discs.
  useEffect(() => {
    if (!connection) warmLogos();
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

let warmed = false;

/** The popular wallets' logos, into the browser's cache once per page, when it has nothing else to do. */
function warmLogos(): void {
  if (warmed) return;
  warmed = true;
  const fetchAll = () => {
    for (const known of KNOWN) new Image().src = known.logo;
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fetchAll, { timeout: 4_000 });
  else window.setTimeout(fetchAll, 1_500);
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

/** A wallet's logo — the window's own for a wallet it knows, the icon a wallet registered otherwise — or its letter. */
function WalletLogo({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken)
    return (
      <span className={s.walletDisc} aria-hidden="true">
        {name.slice(0, 1)}
      </span>
    );
  // A file of the site or a wallet's own data address: nothing for the image optimiser to do.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.walletLogo} src={src} alt="" onError={() => setBroken(true)} />;
}

/**
 * Connecting in one window (v2, kadr `A-LoginPhone`). The wallets this browser has come first, under
 * «Installed» — the Seeker's first and recommended — and a tap signs in with one; one amber «Sign in with …» for the
 * first, and one calm line: closing the window changes nothing. Under them the popular Solana wallets it does not have,
 * each with its logo and its one step: on a computer its install page, on a phone a link that opens Ryntra inside the
 * wallet's app (`wallet-catalog.ts`). With none in the browser, the first of them is the amber step; its row stays a
 * plain row of the list, so the window holds one lit choice.
 */
function WalletList() {
  const w = useWords(WALLET);
  const wallets = useWallet((st) => st.wallets);
  // Where the page is open, read as the list first draws: it only ever draws in the browser, after a tap (`step` is
  // `pick`), so a phone never flashes a computer's words first.
  const [place] = useState<Place>(() => (typeof navigator === 'undefined' ? 'desk' : placeOf(navigator.userAgent)));
  const [here] = useState<Here>(() => (typeof window === 'undefined' ? { url: '', origin: '' } : { url: window.location.href, origin: window.location.origin }));
  const { installed, more } = walletRows(wallets, place, here, place === 'android' && seekerRegistered());
  const pick = (name: string) => void cityAccount.getState().pick(name);
  const desk = place === 'desk';
  const first = installed[0] ?? null;
  const firstGet = first ? null : (more.find((row): row is GetRow => row.kind === 'get') ?? null);
  // An install page opens beside Ryntra; on a phone an «Open» link hands this page to the wallet's app.
  const follow = (row: GetRow) => (row.step === 'install' ? window.open(row.href, '_blank', 'noopener,noreferrer') : window.location.assign(row.href));
  const stepWord = (row: GetRow) => (row.step === 'install' ? w.install : w.open);

  return (
    <div className={s.login}>
      <div className={s.loginHead}>
        <h2 className={s.loginTitle}>{first ? w.signInTitle : w.connectTitle}</h2>
        <p className={s.loginLine}>{first ? w.oneSign : desk ? w.noneHere : w.openInApp}</p>
      </div>
      {installed.length ? (
        <div className={s.choices} role="group" aria-label={w.installed}>
          {more.length ? <Kick className={s.choicesKick}>{w.installed}</Kick> : null}
          {installed.map((row, i) => (
            <button key={row.key} type="button" className={s.choice} data-first={i === 0 && row.seeker ? '' : undefined} data-wallet={row.key} onClick={() => pick(row.wallet)}>
              <WalletLogo src={row.logo} name={row.name} />
              <span className={s.choiceWords}>
                <span>{row.name}</span>
                {row.seeker ? <span className={s.choiceSub}>{w.inYourPhone}</span> : null}
              </span>
              {row.seeker ? <Chip tone="warn">{w.recommended}</Chip> : <Icon name="arrow" size="s" />}
            </button>
          ))}
        </div>
      ) : null}
      {more.length ? (
        <div className={s.choices} role="group" aria-label={first ? w.moreWallets : w.connectTitle}>
          {first ? <Kick className={s.choicesKick}>{w.moreWallets}</Kick> : null}
          {more.map((row) =>
            row.kind === 'seeker' ? (
              <button key={row.key} type="button" className={s.choice} data-wallet={row.key} onClick={() => pick(row.wallet)}>
                <WalletLogo src={row.logo} name={row.name} />
                <span className={s.choiceWords}>
                  <span>{row.name}</span>
                  <span className={s.choiceSub}>{w.onSeeker}</span>
                </span>
                <Icon name="arrow" size="s" />
              </button>
            ) : (
              <a
                key={row.key}
                className={s.choice}
                data-wallet={row.key}
                href={row.href}
                target={row.step === 'install' ? '_blank' : undefined}
                rel="noreferrer noopener"
                aria-label={row.step === 'install' ? w.installName(row.name) : w.openIn(row.name)}
              >
                <WalletLogo src={row.logo} name={row.name} />
                <span className={s.choiceWords}>
                  <span>{row.name}</span>
                </span>
                <span className={s.choiceStep}>
                  {stepWord(row)}
                  {/* An install page, beside Ryntra; the wallet's own app on a phone. */}
                  {row.step === 'install' ? <MenuIcon name="out" small /> : <Icon name="arrow" size="s" />}
                </span>
              </a>
            ),
          )}
        </div>
      ) : null}
      {first ? (
        <Action onClick={() => pick(first.wallet)}>{w.signInWith(first.name)}</Action>
      ) : firstGet ? (
        <Action onClick={() => follow(firstGet)}>{firstGet.step === 'install' ? w.installName(firstGet.name) : w.openIn(firstGet.name)}</Action>
      ) : null}
      {first ? (
        <p className={s.loginCalm}>
          <Icon name="shield" size="s" />
          {w.closeCalm}
        </p>
      ) : null}
    </div>
  );
}
