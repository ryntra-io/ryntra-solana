'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useCity } from '@/city/lib/city/store';
import { launchTowerIn, useLaunch } from '@/city/lib/launch/district';
import { isNamed } from '@/city/lib/market/types';
import { moduleForKind } from '@/city/lib/quarter/modules';
import { useQuarter } from '@/city/lib/quarter/store';
import { formatPrice, money, signed, sym, TokenIcon } from './bits';
import { bindHoverLabel, useHover } from './hover';
import s from './hud.module.css';

type Words = { title: string; name: string | null; figure: string | null; move: { text: string; up: boolean } | null };

/**
 * The name beside the cursor: the tower's icon, ticker and name with its price and the hour's move, a Ryntra launch by
 * its name, a new pool as just that, a building of my quarter by its kind. Only figures the city's read carries; a
 * figure it does not have is left out, never shown as zero.
 */
export function HoverLabel() {
  const target = useHover((st) => st.target);
  const layout = useCity((st) => st.layout);
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const me = useQuarter((st) => st.me);
  const ref = useRef<HTMLDivElement>(null);

  const view = useMemo(() => {
    if (!target) return null;
    if (target.kind === 'building') {
      const b = me?.buildings.find((x) => x.slot === target.slot);
      if (!b) return null;
      const words: Words = { title: moduleForKind(b.kind)?.name ?? 'Building', name: `Your quarter · level ${b.level}`, figure: null, move: null };
      return { words, tower: null };
    }
    const tower = layout.towers.find((p) => p.tower.id === target.id)?.tower ?? null;
    if (!tower) return null;
    const launch = launchTowerIn({ feed, mine }, tower.id);
    if (launch) {
      const cap = launch.marketCapUsd;
      const words: Words = { title: sym(launch), name: launch.name, figure: cap ? `${money(cap)} cap` : 'Launched on Ryntra', move: null };
      return { words, tower: null };
    }
    if (!isNamed(tower)) {
      // Unverified pools stand without a name (the city never promotes a coin nobody vetted).
      const words: Words = { title: 'New pool', name: 'Unverified', figure: tower.liquidity > 0 ? `${money(tower.liquidity)} liquidity` : null, move: null };
      return { words, tower: null };
    }
    const words: Words = {
      title: sym(tower),
      name: tower.name,
      figure: tower.price > 0 ? formatPrice(tower.price) : null,
      move: Number.isFinite(tower.change1h) ? { text: `${signed(tower.change1h)} 1H`, up: tower.change1h >= 0 } : null,
    };
    return { words, tower };
  }, [target, layout, feed, mine, me]);

  // The label tells the cursor's mover its size whenever its words change, so it can stay on the screen.
  useLayoutEffect(() => {
    bindHoverLabel(view ? ref.current : null);
  }, [view]);
  useLayoutEffect(() => () => bindHoverLabel(null), []);

  if (!view) return null;
  const { words, tower } = view;
  return (
    <div ref={ref} className={s.hover} role="tooltip" aria-hidden="true">
      {tower && <TokenIcon t={tower} className={s.hoverIcon} />}
      <div className={s.hoverText}>
        <div className={s.hoverHead}>
          <span className={`${s.display} ${s.hoverSym}`}>{words.title}</span>
          {words.name && <span className={s.hoverName}>{words.name}</span>}
        </div>
        {(words.figure || words.move) && (
          <div className={s.hoverFigures}>
            {words.figure && <span>{words.figure}</span>}
            {words.move && <span className={words.move.up ? s.up : s.down}>{words.move.text}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
