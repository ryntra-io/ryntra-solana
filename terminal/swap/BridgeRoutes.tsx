'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { RELAY_SOLANA_CHAIN_ID } from '@/lib/relay/chains';
import { Icon, Kick, Panel } from '@/terminal/ui';
import { popularRoutes } from './bridge-form';
import { pickCoin, useBridge } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import { CoinMark } from './BridgePick';
import b from './bridge.module.css';

/**
 * Under «My transfers»: the popular ways into Solana (eyes pass 20.11, №19 — the side column stood empty under one
 * line). A tap puts the way on the form — its two coins, as a pick in the form's own lists would; nothing is asked of a
 * wallet and nothing moves. Not drawn while the networks are not read, nor while a transfer is under way on the form.
 */
export function BridgeRoutes() {
  const w = useWords(RELAY_BRIDGE);
  const chains = useBridge((st) => st.chains);
  const from = useBridge((st) => st.from);
  const to = useBridge((st) => st.to);
  const busy = useBridge((st) => st.run !== null);
  const routes = popularRoutes(chains, { from, to }, RELAY_SOLANA_CHAIN_ID);
  if (!routes.length || busy) return null;
  const solana = chains?.find((chain) => chain.id === RELAY_SOLANA_CHAIN_ID)?.label ?? 'Solana';
  return (
    <Panel pad="m" gap={8} edge label={w.routes} className={b.side}>
      <Kick>{w.routes}</Kick>
      <div className={b.moves}>
        {routes.map((route) => (
          <button
            key={route.from.chainId}
            type="button"
            className={b.move}
            onClick={() => {
              pickCoin('from', route.from);
              pickCoin('to', route.to);
            }}
            aria-label={w.routeTo(route.from.symbol, route.network, route.to.symbol)}
            data-bridge-route={route.from.chainId}
          >
            <span className={b.pair}>
              <CoinMark coin={route.from} size="s" />
              <CoinMark coin={route.to} size="s" />
            </span>
            <span className={b.moveNames}>
              <b>
                {route.from.symbol} → {route.to.symbol}
              </b>
              <span>
                {route.network} → {solana}
              </span>
            </span>
            <Icon name="chevron" size="s" className={b.routeGo} />
          </button>
        ))}
      </div>
    </Panel>
  );
}
