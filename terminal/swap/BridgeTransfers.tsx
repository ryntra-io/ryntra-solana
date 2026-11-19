'use client';

import { locale, digits, useWords } from '@/city/lib/i18n/dict';
import { formatUnits } from '@/city/lib/trade/format';
import { Kick, Panel } from '@/terminal/ui';
import type { TransferState } from './bridge-form';
import { openTransfer, useBridge } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import { CoinMark } from './BridgePick';
import b from './bridge.module.css';

function toneOf(state: TransferState): 'up' | 'warn' | 'down' | undefined {
  if (state === 'done') return 'up';
  if (state === 'failed' || state === 'reverted') return 'down';
  if (state === 'refunded' || state === 'cancelled' || state === 'slow' || state === 'waiting' || state === 'expired' || state === 'unconfirmed') return 'warn';
  return undefined;
}

/**
 * «My transfers» beside the form (the page template's side column): the transfers made from this device,
 * newest first, each with where it stands — followed until it settles, after a reload too. A press opens it on the form.
 */
export function BridgeTransfers() {
  const w = useWords(RELAY_BRIDGE);
  const transfers = useBridge((st) => st.transfers);
  // A word each, short enough to stand beside the amount without cutting it.
  const word: Readonly<Record<TransferState, string>> = { sign: w.listMoving, sent: w.sent, bridging: w.listMoving, done: w.done, refunded: w.listBack, failed: w.listFailed, slow: w.listMoving, cancelled: w.listCancelled, waiting: w.listWaiting, expired: w.listNotSent, reverted: w.listFailed, unconfirmed: w.listUnconfirmed };
  const when = (at: number) => new Date(at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <Panel pad="m" gap={8} edge label={w.transfers} className={b.side}>
      <Kick>{w.transfers}</Kick>
      {transfers.length ? (
        <div className={b.moves}>
          {transfers.map((entry) => (
            <button key={entry.requestId} type="button" className={b.move} onClick={() => openTransfer(entry.requestId)} data-bridge-transfer={entry.state}>
              <span className={b.pair}>
                <CoinMark coin={{ chainId: entry.from.chainId, address: entry.from.address ?? '', symbol: entry.from.symbol, logo: entry.from.logo === true }} size="s" />
                <CoinMark coin={{ chainId: entry.to.chainId, address: entry.to.address ?? '', symbol: entry.to.symbol, logo: entry.to.logo === true }} size="s" />
              </span>
              <span className={b.moveNames}>
                <b>
                  {digits(formatUnits(entry.from.amountRaw, entry.from.decimals))} {entry.from.symbol} → {entry.to.symbol}
                </b>
                <span>{when(entry.at)}</span>
              </span>
              <span className={b.moveState} data-tone={toneOf(entry.state)}>
                {word[entry.state]}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className={b.blank}>{w.noTransfers}</p>
      )}
    </Panel>
  );
}
