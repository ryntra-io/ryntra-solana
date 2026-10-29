'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isPhoneUserAgent, phantomBrowseUrl, PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import { useWallet } from '@/city/lib/trade/wallet';
import type { Line } from '@/city/lib/money/form';
import s from './money.module.css';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** A coin's logo through Ryntra's icon route, as the trade card draws it; a coin without one gets a plain disc. */
export function CoinIcon({ mint, size = 32 }: { mint: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const id = mint ?? SOL_MINT;
  useEffect(() => setFailed(false), [id]);
  if (failed) return <span className={s.coinIcon} style={{ width: size, height: size }} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.coinIcon} style={{ width: size, height: size }} src={`/api/icon/${id}`} alt="" draggable={false} onError={() => setFailed(true)} />;
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
export function CopyButton({ value, label = 'Copy address', primary = false }: { value: string; label?: string; primary?: boolean }) {
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
      {copied ? 'Copied' : label}
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
export function More({ label = 'Details', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.more}>
      <button type="button" className={s.moreToggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
        <span className={s.chevron} data-open={open ? '' : undefined} aria-hidden="true" />
      </button>
      {open ? <div className={s.moreBody}>{children}</div> : null}
    </div>
  );
}

/** Read again: an icon, and how old the last read is for whoever hovers it. */
export function Refresh({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" className={s.refresh} onClick={onClick} aria-label="Refresh" title={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
      </svg>
    </button>
  );
}

/** The wallet this browser has, found the Wallet Standard way; with none, where to get one. */
export function Connect() {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  return (
    <div className={s.connect}>
      <h3 className={`${s.display} ${s.soonTitle}`}>Connect wallet</h3>
      {wallets.length ? (
        <div className={s.wallets}>
          {wallets.map((wallet) => (
            <button key={wallet.name} type="button" className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
              {connecting === wallet.name ? `Opening ${wallet.name}…` : wallet.name}
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
          {phone ? 'Open in Phantom' : 'Get Phantom'}
        </a>
      )}
      {error ? <Note line={{ tone: 'error', text: error }} /> : null}
      <More>
        <p className={s.fine}>Your wallet signs every transfer. Ryntra never holds your keys or your coins.</p>
      </More>
    </div>
  );
}

/** A tab that moves money, before the owner opens it: its name, «opens soon», and where to go meanwhile. */
export function Soon({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.soon}>
      <span className={`${s.display} ${s.kicker}`}>Opens soon</span>
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
        : tab === 'bridge'
          ? 'M4 9h13M13 5l4 4-4 4M20 15H7M11 19l-4-4 4-4'
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
