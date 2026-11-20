'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Ticket } from '@/terminal/coin/Ticket';
import { BridgePanel } from '@/terminal/swap/Bridge';
import { CoinLogo, Figure, Icon, changeText, changeTone } from '@/terminal/ui';
import { CleanPanel, RiskMark } from './CleanBlock';
import { ExitPanel } from './ExitPanel';
import { useClean } from './clean';
import { riskMap } from './clean-view';
import { coinPrice, logoFor, logosFor } from './Groups';
import type { Act } from './state';
import type { AllData } from './useAll';
import { PORTFOLIO } from './words';
import p from './portfolio.module.css';

/**
 * The one panel the screen acts in: the ticket on a coin (the coin screen's own, `terminal/coin/Ticket.tsx`), the top-up
 * (the Swap screen's own panel, `terminal/swap/**`), the wallet's clean, the exit. Each closes by its own
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
              <CoinLogo src={logoFor(coin.id)} also={logosFor(coin.id).slice(1)} symbol={coin.symbol} size="l" />
              <span className={p.coinWords}>
                <span className={p.coinSym}>{coin.symbol}</span>
                <span className={p.coinName}>{coin.name}</span>
              </span>
              {price.usd !== null ? (
                <span className={p.coinPrice}>
                  <Figure value={coinPrice(price.usd, lang)} size="s" />
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
  if (act.kind === 'clean') return <CleanPanel onClose={onClose} />;
  if (act.kind === 'exit') return <ExitPanel data={data} onClose={onClose} />;
  // «Send» and «Receive» are «Money»'s: the screen leads there and draws no panel of its own.
  return null;
}

function CloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" className={p.close} onClick={onClose} aria-label={label}>
      <Icon name="close" size="s" />
    </button>
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
