'use client';

import { useEffect } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { flowLive } from '@/city/lib/money/flag';
import { useMoney } from '@/city/lib/money/open';
import { useMoneyStore } from '@/city/lib/money/store';
import { Bridge } from './Bridge';
import { Send } from './Send';
import { MONEY } from './words';
import s from './money.module.css';

/** An address on an EVM network: Send takes it to the other network by itself. */
const EVM = /^0x[0-9a-fA-F]{40}$/;

/**
 * Send: to a Solana address, or to another network — the Bridge's own engine
 * (`/api/solana/cross-swap/*`, USDC to a `0x` address). A `0x` address put in Send's field moves there by itself.
 * Nothing here signs: each way keeps its own review and its one signature.
 */
export function SendWays({ owner }: { owner: string }) {
  const w = useWords(MONEY);
  const way = useMoney((st) => st.way);
  const busy = useMoney((st) => st.busy);
  const to = useMoneyStore((st) => st.send.to);
  const networks = flowLive('bridge');
  const shown = networks ? way : 'solana';

  useEffect(() => {
    const text = to.trim();
    if (!networks || !EVM.test(text)) return;
    useMoneyStore.getState().setBridgeTo(text);
    useMoneyStore.getState().setTo('');
    useMoney.getState().setWay('network');
  }, [to, networks]);

  return (
    <section className={s.tabBody} aria-label={w.send}>
      {networks ? (
        <div className={s.segment} role="tablist" aria-label={w.whereTo}>
          <button type="button" role="tab" aria-selected={shown === 'solana'} className={shown === 'solana' ? s.segmentOn : ''} onClick={() => useMoney.getState().setWay('solana')} disabled={busy}>
            {w.toSolana}
          </button>
          <button type="button" role="tab" aria-selected={shown === 'network'} className={shown === 'network' ? s.segmentOn : ''} onClick={() => useMoney.getState().setWay('network')} disabled={busy}>
            {w.toNetwork}
          </button>
        </div>
      ) : null}
      {shown === 'network' ? <Bridge /> : <Send owner={owner} />}
    </section>
  );
}
