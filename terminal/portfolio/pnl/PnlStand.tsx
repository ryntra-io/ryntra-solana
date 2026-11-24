'use client';

import { useMemo, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { ActionBody, Kick, Page, PageHead } from '@/terminal/ui';
import { PnlBlock } from './PnlPanel';
import { standWallets } from './stand';
import { PNL_STAND } from './words';
import p from './pnl.module.css';

/**
 * The kit's stand of «Result» (`/terminal/kit/pnl`, `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` only): every state
 * the eyes check, each from wallets of trades counted by `portfolioPnl` itself — the live result, a read that does not
 * reach the period's start, too little known, no trades, another wallet, reading, a read that failed, and «Share» on its
 * way and with no sale. People never see it.
 */
export function PnlStand() {
  const w = useWords(PNL_STAND);
  const wallets = useMemo(() => standWallets(Math.floor(Date.now() / 1000)), []);
  const ready = (pnl: typeof wallets.live) => ({ status: 'ready' as const, pnl });
  return (
    <Page>
      <PageHead title={w.title} />
      <ActionBody>
        <div className={p.stand}>
          <State id="live" name={w.live}>
            <PnlBlock read={ready(wallets.live)} own share={{ status: 'idle' }} onShare={() => undefined} />
          </State>
          <State id="older" name={w.older}>
            <PnlBlock read={ready(wallets.older)} own share={{ status: 'idle' }} onShare={() => undefined} />
          </State>
          <State id="partial" name={w.partial}>
            <PnlBlock read={ready(wallets.partial)} own share={{ status: 'idle' }} onShare={() => undefined} start={90} />
          </State>
          <State id="making" name={w.making}>
            <PnlBlock read={ready(wallets.live)} own share={{ status: 'making' }} onShare={() => undefined} start={7} />
          </State>
          <State id="none" name={w.none}>
            <PnlBlock read={ready(wallets.live)} own share={{ status: 'none', days: 7 }} onShare={() => undefined} start={7} />
          </State>
          <State id="other" name={w.other}>
            <PnlBlock read={ready(wallets.live)} own={false} share={null} start={90} />
          </State>
          <State id="empty-own" name={w.emptyOwn}>
            <PnlBlock read={ready(wallets.empty)} own share={{ status: 'idle' }} onShare={() => undefined} />
          </State>
          <State id="empty-other" name={w.emptyOther}>
            <PnlBlock read={ready(wallets.empty)} own={false} share={null} />
          </State>
          <State id="reading" name={w.reading}>
            <PnlBlock read={{ status: 'reading' }} own share={null} />
          </State>
          <State id="failed" name={w.failed}>
            <PnlBlock read={{ status: 'failed' }} own share={null} onReread={() => undefined} />
          </State>
        </div>
      </ActionBody>
    </Page>
  );
}

function State({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <section className={p.state} data-pnl-state={id} aria-label={name}>
      <Kick>{name}</Kick>
      {children}
    </section>
  );
}
