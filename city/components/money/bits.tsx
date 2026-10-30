'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isPhoneUserAgent, phantomBrowseUrl, PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import type { Line } from '@/city/lib/money/form';
import { spotIcon } from '@/city/lib/search/rank';
import { MONEY } from './words';
import s from './money.module.css';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * A coin's logo: the tower's through Ryntra's icon route, as the trade card draws it; a coin that is no tower (USDC, a
 * meme bought at a launch) the picture the engine's catalogue names, through the engine's icon route. Without either,
 * the coin's own letters on its disc — never an empty circle (CITY-150).
 */
export function CoinIcon({ mint, size = 32, icon = null, symbol = null }: { mint: string | null; size?: number; icon?: string | null; symbol?: string | null }) {
  const id = mint ?? SOL_MINT;
  const sources = [`/api/icon/${id}`, spotIcon(id, icon) ?? `/api/spot/icon?mint=${encodeURIComponent(id)}`];
  const [tried, setTried] = useState(0);
  useEffect(() => setTried(0), [id, icon]);
  if (tried >= sources.length) {
    const letters = (symbol ?? '').replace(/^\$+/, '').slice(0, 2).toUpperCase();
    return (
      <span className={`${s.coinIcon} ${s.coinLetters}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
        {letters}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={sources[tried]} className={s.coinIcon} style={{ width: size, height: size }} src={sources[tried]} alt="" draggable={false} onError={() => setTried((n) => n + 1)} />
  );
}

/** One line under a field or a form: info, a warning, or what went wrong. */
export function Note({ line }: { line: Line | null }) {
  if (!line) return null;
  return (
    <p className={`${s.note} ${line.tone === 'error' ? s.noteError : line.tone === 'warn' ? s.noteWarn : ''}`} role={line.tone === 'info' ? 'status' : 'alert'}>
      {line.text}
    </p>
  );
}

/** A QR of exactly `value` on a warm tile: dark modules on light, which every scanner reads. */
export function Qr({ value, label }: { value: string; label: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    void import('qrcode')
      .then((QRCode) => QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#0b0a14', light: '#fff6e6' } }))
      .then((url) => live && setData(url))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className={s.qr}>
      {/* A data URI drawn here; there is no remote file for next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data ? <img src={data} alt={label} width={180} height={180} /> : <span className={s.qrBone} aria-hidden="true" />}
    </div>
  );
}

/** Copies `value`; the button says it did. A refused clipboard leaves the value on screen in full. */
export function CopyButton({ value, label, primary = false }: { value: string; label?: string; primary?: boolean }) {
  const w = useWords(MONEY);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The address is on screen whole either way.
    }
  };
  return (
    <button type="button" className={`${s.display} ${primary ? s.action : s.secondary}`} onClick={() => void copy()}>
      {copied ? w.copied : (label ?? w.copyAddress)}
    </button>
  );
}

/**
 * One quiet line of what must be seen before signing — the fee, the least that arrives — with an «i» that opens the
 * breakdown. The trade card's own pattern, so a fee reads the same in every window of the city.
 */
export function Terms({ line, label, children }: { line: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={s.terms}>
        <span className={s.termsText}>{line}</span>
        <button type="button" className={`${s.info} ${open ? s.infoOn : ''}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          i
        </button>
      </div>
      {open ? <dl className={s.details}>{children}</dl> : null}
    </>
  );
}

/** One quiet «Details» at the foot of a screen: the small print, opened on a tap and closed again. */
export function More({ label, children }: { label?: string; children: ReactNode }) {
  const w = useWords(MONEY);
  const [open, setOpen] = useState(false);
  return (
    <div className={s.more}>
      <button type="button" className={s.moreToggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label ?? w.details}
        <span className={s.chevron} data-open={open ? '' : undefined} aria-hidden="true" />
      </button>
      {open ? <div className={s.moreBody}>{children}</div> : null}
    </div>
  );
}

/** Read again: an icon, and how old the last read is for whoever hovers it. */
export function Refresh({ onClick, title }: { onClick: () => void; title?: string }) {
  const w = useWords(MONEY);
  return (
    <button type="button" className={s.refresh} onClick={onClick} aria-label={w.refresh} title={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
      </svg>
    </button>
  );
}

/** The wallet this browser has, found the Wallet Standard way; with none, where to get one. */
export function Connect() {
  const w = useWords(MONEY);
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  return (
    <div className={s.connect}>
      <h3 className={`${s.display} ${s.soonTitle}`}>{w.connectWallet}</h3>
      {wallets.length ? (
        <div className={s.wallets}>
          {wallets.map((wallet) => (
            <button key={wallet.name} type="button" className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
              {connecting === wallet.name ? w.opening(wallet.name) : wallet.name}
            </button>
          ))}
        </div>
      ) : (
        <a
          className={`${s.display} ${s.action}`}
          href={phone ? phantomBrowseUrl(window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL}
          target={phone ? undefined : '_blank'}
          rel="noreferrer"
        >
          {phone ? w.openInPhantom : w.getPhantom}
        </a>
      )}
      {error ? <Note line={{ tone: 'error', text: error }} /> : null}
      <More>
        <p className={s.fine}>{w.walletSigns}</p>
      </More>
    </div>
  );
}

/** A tab that moves money, before the owner opens it: its name, «opens soon», and where to go meanwhile. */
export function Soon({ title, children }: { title: string; children?: ReactNode }) {
  const w = useWords(MONEY);
  return (
    <div className={s.soon}>
      <span className={`${s.display} ${s.kicker}`}>{w.opensSoonTitle}</span>
      <h3 className={`${s.display} ${s.soonTitle}`}>{title}</h3>
      {children}
    </div>
  );
}

export function TabGlyph({ tab }: { tab: string }) {
  const path =
    tab === 'topup'
      ? 'M12 4v11M7 10l5 5 5-5M5 20h14'
      : tab === 'send'
        ? 'M12 20V9M7 14l5-5 5 5M5 4h14'
        : tab === 'paylink'
          ? 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
          : tab === 'activity'
            ? 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'
            : 'M12 3v9h9M20.5 15A9 9 0 1 1 9 3.5';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
