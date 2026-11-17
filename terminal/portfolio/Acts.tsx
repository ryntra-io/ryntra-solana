'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MONEY } from '@/city/components/money/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { grouped } from '@/city/lib/money/recipient';
import { useWallet } from '@/city/lib/trade/wallet';
import { Ticket } from '@/terminal/coin/Ticket';
import { BridgePanel } from '@/terminal/swap/Bridge';
import { SendPanel } from '@/terminal/swap/Send';
import { Action, Chip, CoinLogo, Figure, Icon, Panel, Title, changeText, changeTone, priceText } from '@/terminal/ui';
import { CleanPanel, RiskMark } from './CleanBlock';
import { ExitPanel } from './ExitPanel';
import { useClean } from './clean';
import { riskMap } from './clean-view';
import { Glyph } from './glyphs';
import { logoFor } from './Groups';
import type { Act } from './state';
import type { AllData } from './useAll';
import { PORTFOLIO } from './words';
import p from './portfolio.module.css';

/**
 * The one panel the screen acts in: the ticket on a coin (the coin screen's own, `terminal/coin/Ticket.tsx`), the top-up
 * and the transfer (the Swap screen's own panels, `terminal/swap/**`), the wallet's own address, the wallet's clean, the exit. Each closes by its own
 * control, never while money is mid-way; on a desk it stands beside the holdings, on a phone it is a sheet.
 */
export function ActPanel({ act, data, onClose, onTopUp, price }: { act: Act; data: AllData; onClose: () => void; onTopUp: () => void; price: Readonly<{ usd: number | null; dayPct: number | null }> }) {
  const w = useWords(PORTFOLIO);
  const lang = useLang();
  const read = useClean((st) => st.read);
  if (act.kind === 'trade') {
    const coin = act.coin;
    const risk = riskMap(read).get(coin.id) ?? [];
    return (
      <Ticket
        coin={coin}
        onTopUp={onTopUp}
        head={
          <div className={p.coinHeadWrap}>
            <div className={p.coinHead}>
              <CoinLogo src={logoFor(coin.id)} symbol={coin.symbol} size="l" />
              <span className={p.coinWords}>
                <span className={p.coinSym}>{coin.symbol}</span>
                <span className={p.coinName}>{coin.name}</span>
              </span>
              {price.usd !== null ? (
                <span className={p.coinPrice}>
                  <Figure value={priceText(price.usd, lang)} size="s" />
                  {price.dayPct !== null ? (
                    <span className={p.coinChange} data-tone={changeTone(price.dayPct)}>
                      {changeText(price.dayPct, lang)}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <CloseButton label={w.close} onClose={onClose} />
            </div>
            <RiskMark symbol={coin.symbol} risk={risk} wide />
          </div>
        }
      />
    );
  }
  if (act.kind === 'topUp') return <BridgePanel onClose={onClose} closeLabel={w.close} />;
  if (act.kind === 'send') return <SendPanel />;
  if (act.kind === 'clean') return <CleanPanel onClose={onClose} />;
  if (act.kind === 'exit') return <ExitPanel data={data} onClose={onClose} />;
  return <ReceivePanel onClose={onClose} />;
}

function CloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" className={p.close} onClick={onClose} aria-label={label}>
      <Icon name="close" size="s" />
    </button>
  );
}

/** «Receive»: the wallet's own Solana address, whole and as a QR, and one copy. Nothing here signs or sends. */
function ReceivePanel({ onClose }: { onClose: () => void }) {
  const w = useWords(PORTFOLIO);
  const m = useWords(MONEY);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [owner]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!owner) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(owner);
      setCopied(true);
    } catch {
      // The address stands on screen whole either way.
    }
  };
  return (
    <Panel tone="hi" pad="l" gap={14} label={w.receiveTitle}>
      <div className={p.panelHead}>
        <Glyph name="receive" className={p.headGlyph} />
        <Title as="h2" className={p.panelTitle}>
          {w.receiveTitle}
        </Title>
        <CloseButton label={w.close} onClose={onClose} />
      </div>
      <Qr value={owner} label={m.qrSolana} />
      <p className={p.address} translate="no">
        {grouped(owner)}
      </p>
      <div className={p.receiveChips}>
        <Chip>{m.solanaOnly}</Chip>
      </div>
      <p className={p.receiveLine}>{w.receiveFrom}</p>
      <Action size="m" onClick={() => void copy()}>
        {copied ? m.copied : m.copyAddress}
      </Action>
    </Panel>
  );
}

/** A QR of exactly `value`: dark modules on the warm white, which every scanner reads. */
function Qr({ value, label }: { value: string; label: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    void import('qrcode')
      .then((QRCode) => QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 320, color: { dark: '#0b0a14', light: '#ffe7c2' } }))
      .then((url) => live && setData(url))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className={p.qr}>
      {/* A data address drawn here; there is no remote file for an image component. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data ? <img src={data} alt={label} width={160} height={160} /> : <span className={p.qrBone} aria-hidden="true" />}
    </div>
  );
}

/**
 * The phone's panel: a sheet from the bottom over the screen. A tap on the shade or Escape puts it away — never while
 * money is mid-way (the screen's own close refuses then); Tab walks its own controls.
 */
export function ActSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const stops = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], input, [tabindex="0"]') ?? []);
    const before = document.activeElement as HTMLElement | null;
    stops()[0]?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = stops();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : at === all.length - 1 ? 0 : at + 1;
      event.preventDefault();
      all[next]?.focus();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <>
      <div className={p.scrim} aria-hidden="true" onClick={() => close.current()} />
      <div ref={sheet} className={p.sheet} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}
