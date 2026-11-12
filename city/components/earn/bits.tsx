'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { districtFrame, srcSet, type DistrictId } from '@/city/lib/art/frames';
import { monogram } from '@/city/lib/chart/icon';
import { isPhoneUserAgent, phantomBrowseUrl, PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import { useWallet } from '@/city/lib/trade/wallet';
import { solText } from '@/city/lib/earn/lst';
import { digits } from '@/city/lib/i18n/dict';
import type { ProductId } from '@/city/lib/earn/flag';
import { useEarnData } from '@/city/lib/earn/store';
import type { Words } from '@/city/lib/earn/words';
import s from './earn.module.css';

/** Risk as 1 to 3 dots, filled amber for each step, with its word beside them (CITY-243: three dots alone were a riddle). */
export function RiskDots({ dots, words }: { dots: 1 | 2 | 3; words: Words }) {
  return (
    <span className={s.risk} role="img" aria-label={words.riskLabel(dots)} title={words.riskLabel(dots)}>
      <span className={s.riskWord}>{words.risk}</span>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= dots ? s.riskOn : undefined} />
      ))}
    </span>
  );
}

/** A sum in SOL at its full size: mint for a gain, flare for a loss, the same size either way. */
export function SolFigure({ lamports, empty = '—', className = '', unit = true }: { lamports: bigint | null; empty?: string; className?: string; unit?: boolean }) {
  const tone = lamports === null || lamports === 0n ? '' : lamports > 0n ? s.gain : s.loss;
  return (
    <b className={`${s.figure} ${tone} ${className}`}>
      {lamports === null ? empty : digits(solText(lamports, true))}
      {lamports === null || !unit ? null : <small> SOL</small>}
    </b>
  );
}

/** One quiet line with an «i» that opens its details below it, and closes them again. */
export function Line({ line, label, children }: { line: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Opened, the line and its details come into view from the line down.
  useEffect(() => {
    if (open) wrap.current?.scrollIntoView({ block: 'start' });
  }, [open]);
  return (
    <div className={s.lineWrap} ref={wrap}>
      <div className={s.line}>
        <span className={s.lineText}>{line}</span>
        <button type="button" className={`${s.info} ${open ? s.infoOn : ''}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          i
        </button>
      </div>
      {open ? <div className={s.details}>{children}</div> : null}
    </div>
  );
}

/** «Tell me when it opens»: one switch, kept on this device; what it does stands behind its «i». */
export function Notify({ product, words }: { product: ProductId; words: Words }) {
  const on = useEarnData((st) => st.wishes.has(product));
  const [why, setWhy] = useState(false);
  return (
    <div className={s.notifyWrap}>
      <div className={s.notify}>
        <span id={`earn-notify-${product}`}>{on ? words.notifyOn : words.notify}</span>
        <button type="button" className={`${s.info} ${why ? s.infoOn : ''}`} aria-label={words.details} aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          i
        </button>
        <button type="button" className={s.switch} role="switch" aria-checked={on} aria-labelledby={`earn-notify-${product}`} onClick={() => useEarnData.getState().toggleWish(product)}>
          <span className={s.knob} />
        </button>
      </div>
      {why ? <p className={s.fine}>{words.notifyDetails}</p> : null}
    </div>
  );
}

/** A coin's logo through Ryntra's icon route, as every window of the city draws it. */
/**
 * A coin's logo over its first letter: while the logo loads, and for a coin the engine has no logo for, the letter
 * stands in its circle — never an empty one (CITY-188).
 */
export function Coin({ mint, size = 28, symbol }: { mint: string; size?: number; symbol?: string }) {
  const [failed, setFailed] = useState(false);
  if (!symbol) {
    if (failed) return <span className={s.coin} style={{ width: size, height: size }} aria-hidden="true" />;
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={s.coin} style={{ width: size, height: size }} src={`/api/icon/${mint}`} alt="" draggable={false} onError={() => setFailed(true)} />;
  }
  return (
    <span className={`${s.coin} ${s.coinLetter}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }} aria-hidden="true">
      {monogram(symbol)}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {failed ? null : <img className={s.coinLogo} src={`/api/icon/${mint}`} alt="" draggable={false} onError={() => setFailed(true)} />}
    </span>
  );
}

export function EarnGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3M12 18v3M4 12h3M17 12h3" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 10v4M10.5 11.2h2.2a1 1 0 0 1 0 2h-2.2" />
    </svg>
  );
}

export function TabGlyph({ tab }: { tab: string }) {
  const path =
    tab === 'shelf'
      ? 'M4 6h16M4 12h16M4 18h16M7 6v-2M17 12v-2M10 18v-2'
      : tab === 'piers'
        ? 'M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M6 15V6M18 15V6M6 9h12'
        : 'M12 3l7 4v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V7z';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/** The wallets this browser has, found the Wallet Standard way, as one button each; with none, where to get one. */
export function Wallets({ words }: { words: Words }) {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    return (
      <a
        className={`${s.display} ${s.action}`}
        href={phone ? phantomBrowseUrl(window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL}
        target={phone ? undefined : '_blank'}
        rel="noreferrer"
      >
        {words.connect}
      </a>
    );
  }
  return (
    <div className={s.wallets}>
      {wallets.map((wallet) => (
        <button key={wallet.name} type="button" className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
          {connecting === wallet.name ? '…' : wallet.name}
        </button>
      ))}
    </div>
  );
}

/** A frame of the live 3D city (city/lib/art/frames.ts) heading a calm screen — never a generated city. */
export function CityFrame({ district }: { district: DistrictId }) {
  const frame = districtFrame(district);
  const [shown, setShown] = useState(false);
  return (
    <div className={s.productArt} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`${s.artImg} ${shown ? s.artShown : ''}`}
        src={frame.files[0]!.src}
        srcSet={srcSet(frame)}
        sizes="(min-width: 700px) 680px, 100vw"
        alt=""
        decoding="async"
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && !shown) setShown(true);
        }}
        onLoad={() => setShown(true)}
      />
    </div>
  );
}
