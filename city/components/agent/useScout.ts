'use client';

import { useEffect } from 'react';
import { BROUGHT_MS, useAgent, type ScoutPhase } from '@/city/lib/agent/store';
import { usdOfBuy } from '@/city/lib/agent/scout';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import { useRun } from '@/city/lib/run/store';
import { SOL, USDC } from '@/city/lib/trade/tiles';
import { choiceOf, useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';

/** How long the drone flies between looks: a short patrol after launch or a skip, longer when nothing fit. */
const GAP_MS: Record<ScoutPhase, number> = { off: Infinity, found: Infinity, patrol: 6_000, quiet: 20_000, waiting: 20_000, resting: 60_000 };

/**
 * The scout's clock: it looks over the city between patrols, waits while a run or a tower card owns the screen, and
 * counts the person's own buys of a coin it brought against the week's budget. It reads; it never trades.
 */
export function useScout() {
  useEffect(() => useAgent.getState().hydrate(), []);

  useEffect(() => {
    const timer = setInterval(() => {
      // A find's figures go old: after a few minutes it is dropped, card or not, and the scout looks again.
      useAgent.getState().expire();
      const agent = useAgent.getState();
      if (!agent.on || Date.now() - agent.lookedAt < GAP_MS[agent.phase]) return;
      const city = useCity.getState();
      if (useRun.getState().phase !== 'off' || city.selectedId) return;
      const live = city.snapshot.source === 'live' && !isStale(city.snapshot.fetchedAt);
      agent.look(city.snapshot.towers, live);
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  // A finished buy of the coin the scout brought, in the person's own wallet, counts against the week.
  useEffect(
    () =>
      useTrade.subscribe((trade, before) => {
        const done = trade.done;
        if (!done || done === before.done || done.side !== 'buy') return;
        const brought = useAgent.getState().brought;
        const now = Date.now();
        if (!brought || brought.mint !== done.tower.mint || now - brought.at > BROUGHT_MS) return;
        const inputMint = done.trade.inputMint || done.pay.mint;
        // A receipt without amounts: the amount on the card is what was spent.
        const spent = trade.tower ? choiceOf(trade.tower, 'buy', useWallet.getState().holdings, { pay: trade.pay, other: trade.other, typed: trade.typed }).amountRaw : null;
        const inputRaw = done.trade.inputRaw ?? spent;
        const decimals = done.decimals[inputMint] ?? done.pay.decimals;
        const sol = useCity.getState().snapshot.towers.find((t) => t.id === SOL.mint)?.price ?? null;
        const usd = usdOfBuy({ inputMint, inputRaw, decimals }, { solMint: SOL.mint, usdcMint: USDC.mint, sol });
        if (usd !== null) useAgent.getState().record({ at: now, mint: done.tower.mint, usd });
      }),
    [],
  );
}
