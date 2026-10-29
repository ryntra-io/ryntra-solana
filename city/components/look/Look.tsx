'use client';

import { useEffect, useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import type { PlacedTower } from '@/city/lib/city/layout';
import { hotTower } from '@/city/lib/city/hot';
import type { Look as LookMode } from '@/city/lib/look';
import type { Tower } from '@/city/lib/market/types';
import { Mark } from '../hud/Mark';
import s from './look.module.css';

/**
 * Ryntra City, the concept: the new interface drawn over the live city for review. Real towers and prices;
 * wallets, amounts and agents are illustrative, and the screen says CONCEPT.
 */
export function Look({ mode }: { mode: LookMode }) {
  const layout = useCity((st) => st.layout);
  const hot = useMemo(() => hotTower(layout), [layout]);
  const dock = useMemo(() => layout.towers.find((t) => t.tower.district === 'docks') ?? null, [layout]);
  const sol = useMemo(() => layout.towers.find((t) => /^w?SOL$/i.test(t.tower.symbol))?.tower.price ?? 180, [layout]);

  useEffect(() => {
    const city = useCity.getState();
    city.enter();
    // Buying and the agent fly to the tower; "you're in" and the win stay wide so your tower glows in the skyline.
    const focus: PlacedTower | null = mode === 'rising' ? dock : mode === 'buy' || mode === 'bought' || mode === 'agent' ? hot : null;
    city.select(focus?.tower.id ?? null);
    if (mode !== 'rising' || !dock) return;
    // A launch in the docks: the light column and the sparkle fountain, again every few seconds.
    const fire = () => city.play({ kind: 'launch', towerId: dock.tower.id, symbol: 'KITE', value: 'T+00:42', title: 'Rising' });
    const first = setTimeout(fire, 2600);
    const again = setInterval(fire, 6500);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [mode, hot, dock]);

  const t = hot?.tower ?? null;
  return (
    <div className={s.layer}>
      <Top connected={mode !== 'home'} />
      {mode === 'home' && t && <Home t={t} />}
      {mode === 'buy' && t && <Buy t={t} sol={sol} />}
      {mode === 'bought' && t && <Bought t={t} sol={sol} />}
      {mode === 'win' && <Win />}
      {mode === 'launch' && <Launch />}
      {mode === 'rising' && <Rising />}
      {mode === 'agent' && <Agent />}
      {(mode === 'home' || mode === 'bought' || mode === 'rising' || mode === 'agent') && <Dock active={mode === 'rising' ? 'launch' : mode === 'agent' ? 'agents' : 'market'} />}
    </div>
  );
}

const sym = (t: Tower) => `$${t.symbol.replace(/^\$/, '')}`;

function Top({ connected }: { connected: boolean }) {
  return (
    <div className={s.top}>
      <div className={s.brand}>
        <Mark size={30} />
        <span className={s.word}>Ryntra</span>
      </div>
      <span className={s.concept}>Concept</span>
      {connected ? (
        <span className={s.wallet} aria-label="2.41 SOL">
          <i className={s.avatar} aria-hidden="true" />
          <b>◎ 2.41</b>
        </span>
      ) : (
        <button className={s.connect}>Connect</button>
      )}
    </div>
  );
}

function Home({ t }: { t: Tower }) {
  return (
    <div className={s.hot}>
      <div className={s.kicker}>
        <span className={s.pulse} />
        Hot now
      </div>
      <div className={s.hotRow}>
        <Icon t={t} />
        <span className={s.sym}>{sym(t)}</span>
        <Change v={t.change24h} />
      </div>
      <div className={s.hotLine}>
        {compact(t.traders1h)} traders this hour · {money(t.liquidity)} liquidity
      </div>
      <button className={s.action}>Buy {sym(t)}</button>
    </div>
  );
}

function Buy({ t, sol }: { t: Tower; sol: number }) {
  const pay = 0.5;
  const get = ((pay * sol) / t.price) * 0.99;
  return (
    <div className={s.sheet}>
      <div className={s.sheetHead}>
        <Icon t={t} />
        <div>
          <div className={s.sym}>{sym(t)}</div>
          <div className={s.sheetPrice}>
            {price(t.price)} <Change v={t.change24h} />
          </div>
        </div>
        <button className={s.close} aria-label="Close">
          ×
        </button>
      </div>
      <div className={s.label}>You pay</div>
      <div className={s.tiles}>
        {[0.1, 0.5, 1, 5].map((v) => (
          <button key={v} className={v === pay ? `${s.tile} ${s.tileOn}` : s.tile}>
            {v}
            <small>SOL</small>
          </button>
        ))}
      </div>
      <div className={s.label}>You get</div>
      <div className={s.get}>
        {amount(get)} <span>{sym(t)}</span>
      </div>
      <div className={s.fine}>
        Fee 1% · best route · at least {amount(get * 0.985)} <span className={s.i}>i</span>
      </div>
      <button className={`${s.action} ${s.actionBig}`}>Buy {sym(t)}</button>
    </div>
  );
}

function Bought({ t, sol }: { t: Tower; sol: number }) {
  const got = ((0.5 * sol) / t.price) * 0.99;
  return (
    <>
      <div className={s.youre}>
        <div className={s.youreKicker}>You&apos;re in</div>
        <div className={s.youreMain}>
          {amount(got)} {sym(t)} at {price(t.price)}
        </div>
        <div className={s.youreSub}>Your tower glows in your colour. We ping you at x2.</div>
      </div>
      <div className={s.mine}>
        <span>Your towers</span>
        <b>4</b>
        <span className={s.up}>+12.4% today</span>
      </div>
    </>
  );
}

function Win() {
  return (
    <div className={s.winWrap}>
      <div className={s.winCard}>
        <div className={s.winBrand}>
          <Mark size={22} glow={false} />
          Ryntra City
        </div>
        <div className={s.winX}>x37</div>
        <div className={s.winSym}>$KITE</div>
        <div className={s.winLine}>In at $0.000041 · now $0.00152 · 3 days</div>
        <div className={s.winBy}>Caught by @hunter</div>
      </div>
      <div className={s.winActions}>
        <button className={`${s.action} ${s.actionBig}`}>Post to X</button>
        <button className={s.quiet}>Save</button>
      </div>
    </div>
  );
}

function Launch() {
  return (
    <div className={s.sheet}>
      <div className={s.sheetTitle}>Raise your tower</div>
      <div className={s.launchRow}>
        <div className={s.pic}>
          <b>+</b>
          <span>Picture</span>
        </div>
        <div className={s.fields}>
          <div className={s.field}>
            <span>Name</span>
            <b>Kite</b>
          </div>
          <div className={s.field}>
            <span>Ticker</span>
            <b>$KITE</b>
          </div>
        </div>
      </div>
      <div className={s.rules}>
        <span>Bots pay 50% → 1% in the first 10 min</span>
        <span>Liquidity locked forever at $75K</span>
        <span>32% of every fee is yours</span>
      </div>
      <button className={`${s.action} ${s.actionBig}`}>Launch $KITE</button>
      <div className={s.fineCenter}>One signature in your wallet</div>
    </div>
  );
}

function Rising() {
  return (
    <div className={s.hot}>
      <div className={s.kicker}>
        <span className={s.pulse} />
        Rising now · T+00:42
      </div>
      <div className={s.hotRow}>
        <span className={s.sym}>$KITE</span>
        <span className={s.holders}>37 holders</span>
      </div>
      <div className={s.bar}>
        <div className={s.barFill} style={{ width: '25%' }} />
      </div>
      <div className={s.hotLine}>
        <b>$18.4K</b> of $75K to the skyline
      </div>
      <div className={s.pair}>
        <button className={s.action}>Buy early</button>
        <button className={s.quiet}>Share</button>
      </div>
    </div>
  );
}

function Agent() {
  return (
    <div className={s.agent}>
      <div className={s.agentHead}>
        <span className={s.agentAvatar}>
          <AgentGlyph />
        </span>
        <div className={s.agentWho}>
          <div className={s.agentName}>Scout-7</div>
          <div className={s.agentRule}>Hunts launches near the skyline</div>
        </div>
        <div className={s.agentBudget}>
          <b>0.80</b>
          <span>of 1 SOL left</span>
        </div>
      </div>
      <div className={s.found}>
        <div className={s.foundKicker}>Found</div>
        <div className={s.foundMain}>$KITE · 82% to the skyline · 41 holders</div>
        <div className={s.pair}>
          <button className={s.action}>Approve 0.1 SOL</button>
          <button className={s.quiet}>Skip</button>
        </div>
      </div>
      <div className={s.agentLog}>Yesterday: bought $MOTH · now x2.1</div>
    </div>
  );
}

function Dock({ active }: { active: string }) {
  const items = [
    { id: 'market', label: 'Market', glyph: <MarketGlyph /> },
    { id: 'launch', label: 'Launch', glyph: <LaunchGlyph /> },
    { id: 'run', label: 'Run', glyph: <RunGlyph />, center: true },
    { id: 'harbor', label: 'Harbor', glyph: <HarborGlyph /> },
    { id: 'agents', label: 'Agents', glyph: <AgentGlyph /> },
  ];
  return (
    <nav className={s.dock} aria-label="Districts">
      {items.map((it) => (
        <button key={it.id} className={`${s.dockItem} ${it.center ? s.dockCenter : ''} ${active === it.id ? s.dockOn : ''}`}>
          <span className={s.dockGlyph}>{it.glyph}</span>
          <span className={s.dockLabel}>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** A real move with its window: mint up, red down. */
function Change({ v }: { v: number }) {
  return (
    <span className={v >= 0 ? s.up : s.down}>
      {v >= 0 ? '+' : '−'}
      {Math.abs(v).toFixed(1)}% <small>24H</small>
    </span>
  );
}

function Icon({ t }: { t: Tower }) {
  // eslint-disable-next-line @next/next/no-img-element
  return t.icon ? <img className={s.icon} src={`/api/icon/${t.id}`} alt="" /> : <span className={s.icon} />;
}

function money(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function compact(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

function amount(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return v.toFixed(v >= 10 ? 1 : 3);
}

function price(p: number) {
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  const digits = Math.max(2, -Math.floor(Math.log10(p)) + 2);
  return `$${p.toFixed(Math.min(digits, 10))}`;
}

const MarketGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20V11h4v9M10 20V5h4v15M16 20v-7h4v7M2 20h20" />
  </svg>
);
const LaunchGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l3 7v11H9V9z" />
    <path d="M9 14l-3 3v3h3M15 14l3 3v3h-3" />
  </svg>
);
const RunGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13l18-8-6 16-3-7z" />
  </svg>
);
const HarborGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M2 15c2.5 2 5 2 7 0s4.5-2 7 0 4.5 2 6 0M2 20c2.5 2 5 2 7 0s4.5-2 7 0 4.5 2 6 0M12 3v9M8 8h8" />
  </svg>
);
const AgentGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4l7 5-7 11-7-11z" />
    <path d="M2 9h5M17 9h5" />
  </svg>
);
