'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { SOL } from '@/city/lib/trade/tiles';
import { shelfHref, shelfOn } from '@/terminal/shell/shelves';
import { useMarket } from '@/terminal/shell/useMarket';
import { CoinLogo, Icon, changeText, changeTone, priceText } from '@/terminal/ui';
import { useDayMove } from './day-move';
import { DEPTH } from './depth-words';
import { Turn } from './glyphs';
import d from './depth.module.css';

type Feed = Readonly<{ lsts?: readonly Readonly<{ id: string; apyPct: number | null }>[] }>;

/** The staking rate the engine reads (`/api/city/earn`): JupSOL's, else JitoSOL's — a named rate, never the best of several. */
function useStakeRate(on: boolean): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch('/api/city/earn', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<Feed>) : null))
      .then((feed) => {
        if (!live || !feed?.lsts) return;
        const rates = feed.lsts.filter((l) => typeof l.apyPct === 'number' && l.apyPct > 0 && l.apyPct < 50);
        const pick = rates.find((l) => l.id === 'jupsol') ?? rates.find((l) => l.id === 'jitosol');
        setRate(pick?.apyPct ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [on]);
  return rate;
}

/** «Bots» — the rules a person sets (decision 109: a bot is a rule): the section's own address, its first bot. */
const BOTS_HREF = '/bots';

/**
 * Five doors under the agent's panel: Trade with SOL's price and its day, Bots, Agents, Earn
 * with the staking rate the engine reads, Launch. A tile is a link to its section; it stands only when that section's
 * screen is on. A phone shows all five: Trade across the row, the other four two by two.
 *
 * Every tile is built alike (EYES 19.11: a figure without an arrow on two, an arrow without a figure on three): its
 * icon, its name with the arrow, its line; a live figure, where the engine gives one, stands beside the icon.
 */
export function Tiles({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const live = useMarket().source === 'live';
  const earnOn = shelfOn('earn');
  const rate = useStakeRate(earnOn);
  const sol = live ? (towers.find((t) => t.id === SOL.mint) ?? null) : null;
  // SOL's day as every screen says it: the newest read of it.
  const solDay = useDayMove(SOL.mint) ?? sol?.change24h ?? null;
  const tiles: { id: string; href: string; icon: ReactNode; title: string; sub: string; figure?: ReactNode }[] = [];
  if (shelfOn('swap'))
    tiles.push({
      id: 'trade',
      href: shelfHref('swap', 'live'),
      icon: <Icon name="swap" />,
      title: w.tileTrade,
      sub: w.tileTradeSub,
      figure: sol ? (
        <span className={d.tileFig}>
          <CoinLogo src={`/api/icon/${sol.id}`} symbol="SOL" size="s" />
          {/* A phone names whose price it is (EYES 19.11: «$72.90» alone); a desk's tile has no room, its logo says it. */}
          <span className={d.tileSym}>SOL</span>
          <b>{priceText(sol.price, lang)}</b>
          {solDay !== null ? <i data-tone={changeTone(solDay)}>{changeText(solDay, lang)}</i> : null}
        </span>
      ) : null,
    });
  if (shelfOn('agents')) tiles.push({ id: 'bots', href: BOTS_HREF, icon: <Turn />, title: w.tileBots, sub: w.tileBotsSub });
  if (shelfOn('agents')) tiles.push({ id: 'agents', href: shelfHref('agents', 'live'), icon: <Icon name="agents" />, title: w.tileAgents, sub: w.tileAgentsSub });
  if (earnOn)
    tiles.push({
      id: 'earn',
      href: shelfHref('earn', 'live'),
      icon: <Icon name="earn" />,
      title: w.tileEarn,
      sub: w.tileEarnSub,
      figure:
        rate !== null ? (
          <span className={d.tileFig}>
            <b data-tone="up">{digits(`${rate.toFixed(2)}%`, lang)}</b>
            <i>{w.yearly}</i>
          </span>
        ) : null,
    });
  if (shelfOn('launch')) tiles.push({ id: 'launch', href: shelfHref('launch', 'live'), icon: <Icon name="launch" />, title: w.tileLaunch, sub: w.tileLaunchSub });
  if (!tiles.length) return null;
  return (
    <nav className={d.tiles} aria-label={w.sections} data-terminal="tiles">
      {tiles.map((tile) => (
        <Link key={tile.id} href={tile.href} className={d.tile} data-tile={tile.id}>
          <span className={d.tileTop}>
            <span className={d.tileIcon}>{tile.icon}</span>
            {tile.figure ?? null}
          </span>
          <span className={d.tileWords}>
            <span className={d.tileName}>
              <b>{tile.title}</b>
              <span className={d.tileGo}>
                <Icon name="arrow" size="s" />
              </span>
            </span>
            <span className={d.tileSub}>{tile.sub}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
