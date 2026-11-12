'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useBackPanel } from '@/city/lib/back/panels';
import { useWords } from '@/city/lib/i18n/dict';
import { cityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { menuPlace, TABBABLE, tabTo, type MenuPlace } from '@/city/lib/quarter/wallet-menu';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { openSettings } from '@/city/lib/settings/view';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
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
  // The panel stands in a layer of its own, outside the chip's box (CITY-239): a tap inside it is not a tap «outside».
  const panel = useRef<HTMLDivElement>(null);
  const t = useWords(QUARTER);

  // A tap outside or Escape closes the menu; a list of wallets left open closes with it. Escape is heard on its way
  // down and marked as taken (CITY-240): the panel stands over a window — the Ring, the Vault — and that window's own
  // Escape, which reads the mark, waits for the next press. The panel itself closes on any Escape, as it always has.
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
      const target = event.target as Node;
      if (wrap.current?.contains(target) || panel.current?.contains(target)) return;
      close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, true);
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
          <Over chip={wrap} panel={panel}>
            <div ref={panel} className={`${s.panel} ${w.menu}`} role="dialog" aria-label={t.connect} data-wallet-menu="">
              {step === 'pick' ? <WalletList /> : null}
              {error ? <div className={`${w.note} ${w.error}`}>{error}</div> : null}
            </div>
          </Over>
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
        <Over chip={wrap} panel={panel}>
        <div ref={panel} className={`${s.panel} ${w.menu}`} role="dialog" aria-label={t.wallet} data-wallet-menu="">
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
        </Over>
      )}
    </div>
  );
}

/**
 * The wallet's panel in a layer of its own over the city's windows (CITY-239). The panel answers a tap inside a window
 * («Connect wallet» in the Ring, «Sign in» in the Vault), so it stands over that window; the top bar it belongs to stays
 * under the windows with everything else of the home — the city's event slab, the home's cards, the Deck. Drawn into the
 * city's own root, where its tokens are, and placed under its chip by the chip's place on the screen.
 */
function Over({ chip, panel, children }: { chip: RefObject<HTMLDivElement | null>; panel: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  useLayoutEffect(() => {
    const at = chip.current;
    if (!at) return;
    setRoot(at.closest('main') ?? document.body);
    const measure = () => {
      const next = menuPlace(at.getBoundingClientRect(), window.innerWidth);
      setPlace((was) => (was && was.top === next.top && was.right === next.right ? was : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [chip]);
  // The panel no longer follows its chip in the page, so the keyboard is handed over: opened from the chip, the focus
  // goes into the panel; closed with the focus still inside, it goes back to the chip.
  const shown = Boolean(root && place);
  useLayoutEffect(() => {
    if (!shown) return;
    const button = chip.current?.querySelector('button') ?? null;
    const box = panel.current;
    if (button && button === document.activeElement) box?.querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true });
    return () => {
      if (box?.contains(document.activeElement)) button?.focus({ preventScroll: true });
    };
  }, [shown, chip, panel]);
  // The keyboard's order through the panel, kept by hand since the panel left its chip's place in the page (CITY-240):
  // chip → the panel's controls → what follows the chip in the top bar, and back the same way (`tabTo`). No trap.
  useEffect(() => {
    if (!shown) return;
    const stops = (within: ParentNode) => Array.from(within.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const box = panel.current;
      const button = chip.current?.querySelector('button') ?? null;
      if (!box || !button) return;
      const inside = stops(box);
      const outside = stops(document).filter((el) => !box.contains(el));
      const next = outside.indexOf(button) >= 0 ? (outside[outside.indexOf(button) + 1] ?? null) : null;
      const now = document.activeElement as HTMLElement | null;
      const at = now === button ? 'chip' : now && inside.includes(now) ? inside.indexOf(now) : now !== null && now === next ? 'after' : null;
      const to = tabTo(at, inside.length, event.shiftKey);
      const target = to === 'chip' ? button : to === 'first' ? inside[0] : to === 'last' ? inside[inside.length - 1] : to === 'after' ? next : null;
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown, chip, panel]);
  if (!root || !place) return null;
  return createPortal(
    <div className={w.over} style={{ ['--wallet-top' as string]: `${place.top}px`, ['--wallet-right' as string]: `${place.right}px` }}>
      {children}
    </div>,
    root,
  );
}

/** Phantom, Solflare, Backpack — whatever this browser has; none found says where to get one. */
function WalletList() {
  const wallets = useWallet((st) => st.wallets);
  const t = useWords(QUARTER);
  // A phone's browser has no wallet of its own: Ryntra opens inside Phantom's, as Money and Earn do (CITY-221); a
  // computer gets the wallet. One button under the finger, not a link inside a line.
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    return (
      <>
        <div className={w.note}>{t.noWallet}</div>
        <div className={w.row}>
          <a
            className={`${s.display} ${w.act} ${w.actLink}`}
            href={phone ? phantomBrowseUrl(window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL}
            target={phone ? undefined : '_blank'}
            rel="noreferrer"
            data-wallet-get={phone ? 'open' : 'install'}
          >
            {phone ? t.openInPhantom : t.getPhantom}
          </a>
        </div>
      </>
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
