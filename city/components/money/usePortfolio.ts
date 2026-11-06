'use client';

import { useEffect, useMemo, useState } from 'react';
import { readAgentView, type AgentView } from '@/city/lib/autopilot/store';
import { syncAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET, useMandate, type MandateStatus } from '@/city/lib/bots/mandate';
import { readStatus } from '@/city/lib/bots/mandate-sign';
import { CARE_MODE, useCare } from '@/city/lib/earn/care';
import { DOLLAR_ASSETS, DOLLAR_DECIMALS, DOLLAR_MINT } from '@/city/lib/earn/dollar';
import { DOLLAR_OPEN } from '@/city/lib/earn/dollar-gate';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { LIMIT_MODE } from '@/city/lib/earn/limit-gate';
import { useLimit } from '@/city/lib/earn/limit-store';
import { useDollar } from '@/city/lib/earn/dollar-store';
import { useEarnData } from '@/city/lib/earn/store';
import { collateralOf } from '@/city/lib/exchange/account';
import { EXCHANGE_SHOWN } from '@/city/lib/exchange/flag';
import { useExchange } from '@/city/lib/exchange/store';
import { useWords } from '@/city/lib/i18n/dict';
import { portfolioView, type OrderInput, type PortfolioView, type ReadState } from '@/city/lib/money/portfolio';
import { useMoneyStore } from '@/city/lib/money/store';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { useSpot } from '@/city/lib/trade/spot-store';
import { useWallet } from '@/city/lib/trade/wallet';
import { PORTFOLIO, PORTFOLIO_ROWS } from './words';

const loaded = (status: string | undefined): ReadState => (status === 'ready' ? 'ready' : status === 'error' || status === 'failed' ? 'failed' : 'loading');

/**
 * Every engine read the portfolio needs, started when the window opens for a wallet and shared with the windows that
 * own them — the same stores Earn, the trade card and the agent use, so a figure never disagrees between two windows.
 */
export function usePortfolio(): Readonly<{ owner: string | null; view: PortfolioView | null }> {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const pw = useWords(PORTFOLIO);
  const rowWords = useWords(PORTFOLIO_ROWS);
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const dollar = useDollar((st) => st.surface);
  const positions = useEarnData((st) => st.positions);
  const cares = useCare((st) => st.cares);
  const spotOrders = useSpot((st) => st.orders);
  const poolOrders = useLimit((st) => st.orders);
  const records = useMandate((st) => st.records);
  const account = useExchange((st) => (owner && st.owner === owner && st.account.value?.wallet === owner ? st.account.value : null));
  const [agent, setAgent] = useState<Readonly<{ owner: string; status: MandateStatus | null; view: AgentView | null; done: boolean }> | null>(null);

  const record = owner ? (records[owner] ?? null) : null;

  useEffect(() => {
    if (!owner) return;
    const earn = useEarnData.getState();
    if (earn.positions?.owner !== owner) void earn.loadPositions(owner);
    if (DOLLAR_OPEN) void useDollar.getState().load(owner);
    if (CARE_MODE !== 'closed') void useCare.getState().load(owner);
    void useSpot.getState().readOrders();
    if (EARN_OPEN && LIMIT_MODE !== 'closed') void useLimit.getState().loadOrders(owner);
    if (EXCHANGE_SHOWN) {
      useExchange.getState().follow(owner);
      void useExchange.getState().loadAccount();
    }
    useMandate.getState().hydrate();
    /* CITY-207: the wallet's agents from the engine — the browser's note is only a cache of them. */
    if (MANDATE_NET || CARE_MODE !== 'closed') void syncAgents(owner);
  }, [owner]);

  useEffect(() => {
    if (!owner || !record) return;
    let live = true;
    void Promise.all([readStatus(record), readAgentView(record)]).then(([status, view]) => {
      if (live) setAgent({ owner, status, view, done: true });
    });
    return () => {
      live = false;
    };
  }, [owner, record]);

  const view = useMemo(() => {
    if (!owner) return null;
    const assets = wallet && wallet.owner === owner ? wallet.assets : [];
    const walletState: ReadState = wallet && wallet.owner === owner ? 'ready' : walletRead === 'failed' ? 'failed' : 'loading';

    const lendRows = dollar.status === 'ready' && dollar.value.owner === owner
      ? DOLLAR_ASSETS.flatMap((asset) => {
          const position = dollar.value.positions[asset];
          return position ? [{ asset, mint: DOLLAR_MINT[asset], decimals: DOLLAR_DECIMALS[asset], worthRaw: position.worthRaw, earnedRaw: position.earnedRaw }] : [];
        })
      : [];
    const lendState: ReadState = !DOLLAR_OPEN ? 'off' : dollar.status === 'ready' ? 'ready' : dollar.status === 'error' ? 'failed' : 'loading';

    const mine = positions && positions.owner === owner ? positions.value : null;
    const pierRows = mine && mine.status === 'ready'
      ? mine.value.map((p) => ({ address: p.address, name: p.name, inRange: p.rangeState === 'in_range', lower: p.lower, upper: p.upper, valueUsd: p.valueUsd, unclaimedUsd: p.unclaimedUsd, lockedBps: p.lockedBps }))
      : [];
    const careRows = (cares ?? []).filter((c) => c.status !== 'stopped').map((c) => ({ key: c.key, pool: c.pool, name: null, inRange: c.inRange === true, usd: c.valueUsd ?? null, unclaimedUsd: c.unclaimedUsd ?? null }));

    const ordersRead = spotOrders && spotOrders.owner === owner ? spotOrders : null;
    const spotRows: OrderInput[] = (ordersRead?.list ?? [])
      .filter((o) => o.state === 'OPEN' || o.state === 'PARTIAL')
      .map((o) => {
        const token = ordersRead?.tokens[o.inputMint];
        const base = ordersRead?.tokens[o.baseMint]?.symbol ?? `${o.baseMint.slice(0, 4)}…`;
        const left = BigInt(o.makingRaw || '0') - BigInt(o.filledInputRaw || '0');
        return { key: o.key, venue: o.venue, order: o.order, title: `${o.side === 'buy' ? pw.buy : pw.sell} ${base}`, inputMint: o.inputMint, leftRaw: left > 0n ? left : 0n, decimals: token?.decimals ?? null, canCancel: o.canCancel, pool: false };
      });
    const seen = new Set(spotRows.map((o) => o.order));
    const pool = poolOrders && poolOrders.owner === owner && poolOrders.value.status === 'ready' ? poolOrders.value.value : [];
    const poolRows: OrderInput[] = pool
      .filter((o) => !seen.has(o.address) && o.status !== 'filled')
      .map((o) => {
        const token = o.side === 'ask' ? o.tokenX : o.tokenY;
        return { key: o.address, venue: o.venue, order: o.address, title: o.side === 'ask' ? pw.sellAt : pw.buyAt, inputMint: token.mint, leftRaw: /^\d+$/.test(o.unfilled.units) ? BigInt(o.unfilled.units) : 0n, decimals: token.decimals, canCancel: true, pool: true };
      });
    /* Two order books, each behind its own switch: the place is read when every open one answered. */
    const spotState: ReadState = !SPOT_OPEN ? 'off' : ordersRead ? (ordersRead.status === 'failed' ? 'failed' : ordersRead.status === 'ready' ? 'ready' : 'loading') : 'loading';
    const poolState: ReadState = !(EARN_OPEN && LIMIT_MODE !== 'closed') ? 'off' : poolOrders && poolOrders.owner === owner ? loaded(poolOrders.value.status) : 'loading';
    const states = [spotState, poolState].filter((state) => state !== 'off');
    const ordersState: ReadState = states.length === 0 ? 'off' : states.includes('failed') ? 'failed' : states.includes('loading') ? 'loading' : 'ready';

    const agentState: ReadState = !record ? 'ready' : agent && agent.owner === owner && agent.done ? (agent.status ? 'ready' : 'failed') : 'loading';
    const agentRow = record && agent && agent.owner === owner && agent.done
      ? {
          vaultLamports: agent.status?.budgetLamports && /^\d+$/.test(agent.status.budgetLamports) ? BigInt(agent.status.budgetLamports) : null,
          mainnet: MANDATE_NET === 'mainnet',
          working: agent.status?.active === true && (agent.view?.status ?? 'working') === 'working',
          netLamports: agent.view?.net?.netRaw && /^-?\d+$/.test(agent.view.net.netRaw) ? BigInt(agent.view.net.netRaw) : null,
          trades: agent.view?.result.trades ?? null,
          symbol: agent.view?.symbol ?? null,
        }
      : null;

    const collateral = collateralOf(account);
    const phoenixState: ReadState = !EXCHANGE_SHOWN ? 'off' : account ? 'ready' : 'loading';
    const phoenixUsd = collateral && collateral.collateralUsd !== null && collateral.collateralUsd >= 0.01 ? collateral.collateralUsd : null;

    return portfolioView({
      assets,
      walletState,
      lend: { state: lendState, rows: lendRows },
      piers: { state: mine ? loaded(mine.status) : 'loading', rows: pierRows },
      care: { state: CARE_MODE === 'closed' ? 'off' : cares ? 'ready' : 'loading', rows: careRows },
      agent: { state: agentState, row: agentRow },
      orders: { state: ordersState, rows: [...spotRows, ...poolRows] },
      phoenix: { state: phoenixState, usd: phoenixUsd },
      words: rowWords,
    });
  }, [owner, wallet, walletRead, dollar, positions, cares, spotOrders, poolOrders, record, agent, account, pw, rowWords]);

  return { owner, view };
}
