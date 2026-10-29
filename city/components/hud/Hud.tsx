'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { BRAND } from '@/city/lib/brand';
import { requestFrame } from '@/city/lib/capture';
import { isStale } from '@/city/lib/city/events';
import { hotTower } from '@/city/lib/city/hot';
import { useCity, useCityEvents, type CityEvent } from '@/city/lib/city/store';
import { hydrateFeed, useFeed } from '@/city/lib/feed/store';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { useHall } from '@/city/lib/launch/hall-store';
import { isNamed, towerFigure, type District, type Tower } from '@/city/lib/market/types';
import { MomentsButton, useFilming } from '@/city/lib/moments/MomentsLayer';
import { cancelFilming, useMoments } from '@/city/lib/moments/stage';
import { useLaunch } from '@/city/lib/launch/district';
import { BUSY, useTrade } from '@/city/lib/trade/store';
import { RUN_OPEN } from '@/city/lib/run/flag';
import { useRun } from '@/city/lib/run/store';
import { composeTowerCard, shareImage } from '@/city/lib/share';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { useAgent } from '@/city/lib/agent/store';
import { cityAccount } from '@/city/lib/quarter/account-live';
import { quarterStore } from '@/city/lib/quarter/store';
import { coinLink } from '@/city/lib/share/coin-link';
import { howStore } from '@/city/lib/art/how';
import { AgentCard, useAgentCard } from '../agent/AgentCard';
import { DistrictArt } from '../art/DistrictArt';
import { ChartAction, chartOpen, useChartOpen } from '../chart/ChartAction';
import { LiveFeed } from '../feed/LiveFeed';
import { LaunchSlot, useLaunchDistrict } from '../launch/LaunchSlot';
import { QuarterCard } from '../quarter/QuarterCard';
import { WalletChip } from '../quarter/WalletChip';
import { RunHud } from '../run/RunHud';
import { ExchangeDockItem } from '../exchange/ExchangeDockItem';
import { FuturesAction } from '../exchange/FuturesAction';
import { CitySearch } from '../search/CitySearch';
import { AssistantButton } from '../assistant/AssistantLayer';
import { TradeAction } from '../trade/TradeAction';
import { BeaconAction } from '../beacon/BeaconAction';
import { VaultDockItem } from '../vault/VaultDockItem';
import { HallDockItem } from '../launch/HallDockItem';
import { PredictDockItem } from '../districts/PredictDockItem';
import { compact, formatPrice, money, sym, TokenIcon } from './bits';
import { AgentGlyph, CloseGlyph, HarborGlyph, HomeGlyph, LaunchGlyph, LockGlyph, MarketGlyph, RunGlyph } from './glyphs';
import { HoverLabel } from './HoverLabel';
import { Mark } from './Mark';
import { CityMenu } from './Menu';
import { useWindowOpen } from './useWindowOpen';
import s from './hud.module.css';

const DISTRICT: Record<District, string> = {
  core: 'Sol Core',
  heights: 'DeFi Heights',
  strip: 'Meme Strip',
  avenue: 'Stock Avenue',
  docks: 'Launch Docks',
};

const ACCENT: Record<CityEvent['kind'], string> = { pump: 'var(--mint)', flare: 'var(--flare)', launch: 'var(--mint)' };

/** The districts that open with the next steps of the city (launch, agents, the harbor): each says what it will be. */
type Locked = 'launch' | 'harbor' | 'agents';
const LOCKED: Record<Locked, { name: string; line: string }> = {
  launch: { name: 'Launch Docks', line: 'Raise your own tower: a picture, a name, a ticker and one signature.' },
  harbor: { name: 'Harbor', line: 'The pools and yields of Solana, moored in one place.' },
  agents: { name: 'Agents', line: 'Give an agent a rule. It hunts, you sign every buy.' },
};

/** One line per district for the dock's hover hint on a desktop: what it does. */
const HINT = {
  launch: 'Raise your own coin as a tower',
  harbor: 'Pools and yields, in one place',
  market: 'Fly past the towers moving most today',
  agents: 'An agent hunts by your rule, you sign',
  home: 'Your own quarter of the city',
  run: 'The Skyline Run, under a minute',
} as const;

/** The first-visit hint is shown once per browser: gone after its close or the first tower tapped. */
const HINT_KEY = 'ryntra.city.firstHint';

type Play = (from: 'home' | 'city') => void;

/**
 * Ryntra's home over the live city (decision 70): the top bar, one card above the dock — the hot tower, a
 * challenge, or a district that opens soon — the district dock, and the tower card when a tower is picked.
 * A run owns the whole screen.
 */
export function Hud({ onPlay, onSound }: { onPlay: Play; onSound: (on: boolean) => void }) {
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const selectedId = useCity((st) => st.selectedId);
  const [locked, setLocked] = useState<Locked | null>(null);
  // The menu (☰) and the settings opened from it are the one card while either is open.
  const menu = useHudPanels((st) => st.menu);
  const settings = useHudPanels((st) => st.settings);
  const closeMenu = useCallback(() => useHudPanels.setState({ menu: false, settings: false }), []);
  // While any window or panel is open the HUD's own pieces give way: the feed, the moments, the hint and the card.
  const windowOpen = useWindowOpen();
  // A challenge link opens on its card; read after mount, so the server's page and the first paint agree.
  const [challenge, setChallenge] = useState<{ beat: number } | null>(null);
  useEffect(() => setChallenge(RUN_OPEN ? useRun.getState().challenge : null), []);
  // The scout's card, once its flag is open: its rule, its status, or a find.
  const agentCard = useAgentCard() && AGENTS_OPEN;
  const hall = useHall((state) => state.panel);
  useEffect(() => {
    if (!locked) return;
    const timer = setTimeout(() => setLocked(null), 4200);
    return () => clearTimeout(timer);
  }, [locked]);
  // The Launch district owns the card slot while its sheet is open or a launch's tower is picked.
  const launch = useLaunchDistrict();
  // The trade sheet owns the bottom of the screen while it is open: the tower card under it steps aside, so no control
  // hides under the sheet (CITY-6a). The tower's chart takes the card's place the same way (CITY-5a).
  const trading = useTrade((st) => st.open);
  const charting = useChartOpen();
  // A tower picked from the city closes the menu, so two cards never stack on a phone.
  useEffect(() => {
    if (selectedId || launch.showing) closeMenu();
  }, [selectedId, launch.showing, closeMenu]);

  // The logo: back to the city's overview from anywhere — every panel shut, the camera on the skyline, the address `/`.
  const home = useCallback(() => {
    closeMenu();
    setLocked(null);
    goHome();
  }, [closeMenu]);

  // Escape closes the top-most panel. The trade card, the Harbor, the search, the wallet's menu, the moments' sheets
  // and the tower's chart close themselves; the rest close here, one per press.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (useTrade.getState().open || useHarbor.getState().open || useMoments.getState().sheet || howStore.getState().open || chartOpen()) return;
      // A window on the whole screen takes this Escape back from the whole screen itself (city/components/window).
      if (document.querySelector('[data-window-full]')) return;
      if (document.querySelector('[data-city-top] [aria-expanded="true"]:not([data-city-menu] *)')) return;
      // A beacon's editor closes itself first; the tower card under it stays (city/components/beacon).
      if (document.querySelector('[data-beacon-sheet]')) return;
      if (menu || settings) return closeMenu();
      if (locked) return setLocked(null);
      const sheet = useLaunch.getState();
      if (sheet.sheet && closable(sheet.phase)) return sheet.closeSheet();
      if (useCity.getState().selectedId) return useCity.getState().select(null);
      if (useAgent.getState().panel !== 'none') return useAgent.getState().closePanel();
    };
    // Capture: decided before the panels' own handlers change what is open.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, settings, locked, closeMenu]);

  if (running) return <RunHud onSound={onSound} />;
  // While a clip is filmed the screen shows what the clip shows, but the way home stays: the logo, and beside it the
  // filming bar with its Cancel (city/lib/moments).
  if (filming) {
    return (
      <div className={`${s.layer} ${s.layerFilming}`}>
        <div className={s.top} data-city-top="">
          <Brand onHome={home} />
        </div>
      </div>
    );
  }
  return (
    // `data-window`: the pieces styled elsewhere (the moments' button on a narrow phone) give way by CSS as well.
    <div className={s.layer} data-window={windowOpen ? '' : undefined}>
      {/* First, so the top bar's menus and the cut-in stand over it (CITY-66). */}
      <LiveFeed hidden={windowOpen} />
      <TopBar onSound={onSound} onHome={home} />
      <CutIn hidden={windowOpen} />
      <HoverLabel />
      <FirstHint hidden={windowOpen || trading || !!selectedId || launch.showing} />
      {trading || charting ? null : launch.showing ? (
        <LaunchSlot />
      ) : selectedId ? (
        <TowerCard />
      ) : (
        <>
          {/* One panel at a time: the Hall's sheet stands where the card would (CITY-9); an open window keeps the
              home's own card out of its way. */}
          {menu || settings || hall ? null : agentCard ? (
            <AgentCard />
          ) : locked ? (
            <LockedCard id={locked} />
          ) : windowOpen ? null : challenge ? (
            <ChallengeCard beat={challenge.beat} onPlay={() => onPlay('home')} onLater={() => setChallenge(null)} />
          ) : (
            <QuarterCard hot={<HotCard />} />
          )}
          <Dock
            locked={locked}
            onLocked={(id) => {
              closeMenu();
              useAgent.getState().closePanel();
              useHarbor.getState().hide();
              // The district's card stands where the Predictions window would: one panel at a time.
              usePredict.getState().hide();
              setLocked((now) => (now === id ? null : id));
            }}
            onAgent={() => {
              closeMenu();
              setLocked(null);
              // One panel at a time: the Harbor gives way, unless it is waiting on the wallet or sending.
              useHarbor.getState().hide();
              if (useHarbor.getState().open) return;
              useAgent.getState().toggle();
            }}
            onHome={() => {
              closeMenu();
              setLocked(null);
              useAgent.getState().closePanel();
              useHarbor.getState().hide();
              usePredict.getState().hide();
              useCity.getState().select(null);
              // Your quarter: fly in to it; no quarter yet, the Arrivals card opens on the wallet and the claim — asked
              // for, so it shows for this visit even with its switch off.
              const quarter = quarterStore.getState();
              if (quarter.status === 'resident') quarter.enter();
              else {
                quarterStore.setState({ later: false, asked: true });
                void cityAccount.getState().begin('claim', 'card');
              }
            }}
            onPlay={() => onPlay('city')}
          />
        </>
      )}
    </div>
  );
}

/** The launch sheet closes unless a launch is under way (between the upload and the send). */
const closable = (phase: ReturnType<typeof useLaunch.getState>['phase']) => !phase || phase.step === 'done' || phase.step === 'failed';

/**
 * Home, from anywhere: every panel of the city shut (a trade or a Harbor deposit under a signature keeps its card),
 * the quarter left, nothing picked, the camera flying back to the overview and the address back to `/` — no reload.
 */
export function goHome() {
  cancelFilming();
  useMoments.setState({ sheet: null });
  const trade = useTrade.getState();
  if (trade.open && !BUSY.has(trade.phase)) trade.close();
  useHarbor.getState().hide();
  useAgent.getState().closePanel();
  const sheet = useLaunch.getState();
  if (sheet.sheet && closable(sheet.phase)) sheet.closeSheet();
  const quarter = quarterStore.getState();
  if (quarter.mode !== 'city') quarter.leave();
  useCity.getState().home();
  if (typeof window !== 'undefined' && `${location.pathname}${location.search}${location.hash}` !== '/') {
    // The same page under its home address: `/c/<mint>` and the rest become `/`, without loading anything again.
    history.replaceState(history.state, '', '/');
  }
}

/** The mark and the wordmark: a button home. */
function Brand({ onHome }: { onHome: () => void }) {
  return (
    <button className={s.brand} aria-label="Ryntra home" onClick={onHome}>
      <Mark size={32} />
      <span className={`${s.display} ${s.brandName}`} aria-hidden="true">
        {BRAND.name}
      </span>
    </button>
  );
}

function TopBar({ onSound, onHome }: { onSound: (on: boolean) => void; onHome: () => void }) {
  const snapshot = useCity((st) => st.snapshot);
  const onCloseMenu = useCallback(() => useHudPanels.setState({ menu: false, settings: false }), []);
  // Re-check freshness every half minute, so a stalled feed says so instead of looking live.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const read = snapshot.towers.length > 0;
  const live = snapshot.source === 'live' && !isStale(snapshot.fetchedAt);
  const at = new Date(snapshot.fetchedAt);
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const status = snapshot.source !== 'live' ? 'Snapshot' : live ? 'Live' : 'Delayed';
  // A narrow phone names what is not live by the age of its data: the read's time, or the saved city's day.
  const short = snapshot.source !== 'live' ? at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : live ? 'Live' : time;
  return (
    <div className={s.top} data-city-top="">
      <Brand onHome={onHome} />
      {read && (
        <span className={`${s.panel} ${s.chip} ${s.liveChip}`}>
          <span className={`${s.dot} ${live ? '' : s.dotOff}`} />
          <span className={s.chipLong}>{status}</span>
          <span className={s.chipShort}>{short}</span>
          {snapshot.source === 'live' && <span className={s.chipTime}>{time}</span>}
        </span>
      )}
      <CitySearch />
      <AssistantButton />
      <WalletChip />
      <MomentsButton onOpen={onCloseMenu} />
      <CityMenu onSound={onSound} />
    </div>
  );
}

/** Once per browser, the one thing to know: a tower opens with a tap. */
function FirstHint({ hidden }: { hidden: boolean }) {
  const [show, setShow] = useState(false);
  const tapped = useRef(0);
  const done = useCallback(() => {
    setShow(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Storage refused (a private window): the hint simply goes for this visit.
    }
  }, []);
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen) return;
    const timer = setTimeout(() => setShow(true), 1800);
    // A tower tapped on the canvas is the hint learned; one opened by a link or the dock is not.
    const onUp = (event: PointerEvent) => {
      if (event.target instanceof HTMLCanvasElement) tapped.current = performance.now();
    };
    window.addEventListener('pointerup', onUp, true);
    const unsubscribe = useCity.subscribe((st, before) => {
      if (st.selectedId && st.selectedId !== before.selectedId && performance.now() - tapped.current < 500) done();
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', onUp, true);
      unsubscribe();
    };
  }, [done]);
  if (!show || hidden) return null;
  return (
    <div className={`${s.panel} ${s.firstHint}`} role="status" data-city-hint="">
      <span>Tap any tower to see it. Buy in one tap.</span>
      <button className={s.firstHintClose} aria-label="Got it" onClick={done}>
        <CloseGlyph />
      </button>
    </div>
  );
}

/** The hot tower: the day's best mover among the coins people know, and one tap to fly to it. */
function HotCard() {
  const layout = useCity((st) => st.layout);
  const select = useCity((st) => st.select);
  // Off on a phone until the person turns it on in «Show on home»; nothing shows before the kept choice is read.
  const on = useFeed((st) => st.ready && st.settings.hot);
  useEffect(() => hydrateFeed(), []);
  const hot = useMemo(() => hotTower(layout), [layout]);
  if (!hot || !on) return null;
  const t = hot.tower;
  return (
    <div className={`${s.panel} ${s.slot}`} key={t.id}>
      <DistrictArt id="market" />
      <div className={s.kicker}>
        <span className={s.pulse} aria-hidden="true" />
        Hot now
      </div>
      <div className={s.hotRow}>
        <TokenIcon t={t} className={s.hotIcon} />
        <span className={`${s.display} ${s.hotSym}`}>{sym(t)}</span>
        {/* The card picks what rose this hour, so it states the hour's move. */}
        <span className={`${s.hotChange} ${t.change1h >= 0 ? s.up : s.down}`}>
          {t.change1h >= 0 ? '+' : '−'}
          {Math.abs(t.change1h).toFixed(1)}% <small>1H</small>
        </span>
      </div>
      <div className={s.hotLine}>
        <b>{compact(t.traders1h)}</b> traders this hour · <b>{money(t.liquidity)}</b> liquidity
      </div>
      <button className={`${s.display} ${s.action}`} onClick={() => select(t.id)}>
        Fly to {sym(t)}
      </button>
    </div>
  );
}

/** A challenge link: the time to beat, and the run one tap away. */
function ChallengeCard({ beat, onPlay, onLater }: { beat: number; onPlay: () => void; onLater: () => void }) {
  return (
    <div className={`${s.panel} ${s.slot}`}>
      <div className={s.kicker}>
        <span className={s.pulse} aria-hidden="true" />
        Challenge
      </div>
      <div className={`${s.display} ${s.slotTitle}`}>Beat {beat.toFixed(1)} s</div>
      <div className={s.hotLine}>Run the live Solana skyline. Under a minute, free.</div>
      <div className={s.pair}>
        <button className={`${s.display} ${s.action}`} onClick={onPlay}>
          Run
        </button>
        <button className={s.quiet} onClick={onLater}>
          Later
        </button>
      </div>
    </div>
  );
}

/** A district that opens with a next step of the city: what it will be, and nothing to press. */
function LockedCard({ id }: { id: Locked }) {
  const d = LOCKED[id];
  return (
    <div className={`${s.panel} ${s.slot} ${s.slotLocked}`} key={id} role="status">
      <DistrictArt id={id} tone="warm" />
      <div className={`${s.kicker} ${s.kickerSoon}`}>
        <span className={s.kickerLock} aria-hidden="true">
          <LockGlyph />
        </span>
        Opens soon
      </div>
      <div className={`${s.display} ${s.slotTitle}`}>{d.name}</div>
      <div className={s.hotLine}>{d.line}</div>
    </div>
  );
}

/**
 * The district dock instead of a menu. Market, the way to earn, stands in the centre and tours the towers; the run is
 * free fun at the edge; the rest open soon.
 */
function Dock({ locked, onLocked, onAgent, onHome, onPlay }: { locked: Locked | null; onLocked: (id: Locked) => void; onAgent: () => void; onHome: () => void; onPlay: () => void }) {
  const layout = useCity((st) => st.layout);
  const agentOn = useAgent((st) => st.on || st.panel !== 'none');
  const select = useCity((st) => st.select);
  const launch = useLaunchDistrict();
  const [step, setStep] = useState(0);
  // The towers worth seeing now: the day's biggest movers first, then the tallest.
  const tour = useMemo(() => {
    const named = layout.towers.filter((t) => isNamed(t.tower) && t.tower.district !== 'docks');
    const movers = [...named].sort((a, b) => Math.abs(b.tower.change24h) - Math.abs(a.tower.change24h)).slice(0, 6);
    const tallest = [...named].sort((a, b) => b.height - a.height).filter((t) => !movers.includes(t)).slice(0, 4);
    return [...movers, ...tallest];
  }, [layout]);
  const tick = () => {
    if (useCity.getState().sound) playTick();
  };
  const market = () => {
    if (!tour.length) return;
    tick();
    const t = tour[step % tour.length]!;
    setStep((n) => n + 1);
    select(t.tower.id);
  };
  const lockedItem = (id: Locked, label: string, glyph: ReactNode) => (
    <DockItem
      label={label}
      glyph={glyph}
      hint={HINT[id]}
      on={locked === id}
      soon
      onClick={() => {
        tick();
        onLocked(id);
      }}
    />
  );
  return (
    <nav className={s.dock} aria-label="Districts">
      {launch.open ? <DockItem label="Launch" glyph={<LaunchGlyph />} hint={HINT.launch} onClick={() => (tick(), launch.start())} /> : lockedItem('launch', 'Launch', <LaunchGlyph />)}
      {HARBOR_OPEN ? (
        <DockItem
          label="Harbor"
          glyph={<HarborGlyph />}
          hint={HINT.harbor}
          onClick={() => {
            tick();
            useAgent.getState().closePanel();
            useHarbor.getState().show();
          }}
        />
      ) : (
        lockedItem('harbor', 'Harbor', <HarborGlyph />)
      )}
      <DockItem label="Market" glyph={<MarketGlyph />} hint={HINT.market} center on={!locked && !(AGENTS_OPEN && agentOn)} onClick={market} />
      {AGENTS_OPEN ? (
        <DockItem
          label="Agents"
          glyph={<AgentGlyph />}
          hint={HINT.agents}
          on={agentOn}
          onClick={() => {
            tick();
            onAgent();
          }}
        />
      ) : (
        lockedItem('agents', 'Agents', <AgentGlyph />)
      )}
      <VaultDockItem />
      <HallDockItem />
      <PredictDockItem />
      <ExchangeDockItem />
      <DockItem
        label="Home"
        glyph={<HomeGlyph />}
        hint={HINT.home}
        onClick={() => {
          tick();
          onHome();
        }}
      />
      {RUN_OPEN && <DockItem label="Run" glyph={<RunGlyph />} hint={HINT.run} onClick={onPlay} />}
    </nav>
  );
}

function DockItem({ label, glyph, hint, on, soon, center, onClick }: { label: string; glyph: ReactNode; hint: string; on?: boolean; soon?: boolean; center?: boolean; onClick: () => void }) {
  const cls = [s.dockItem, center && s.dockCenter, on && s.dockOn, soon && s.dockLocked].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={onClick} aria-label={soon ? `${label}, opens soon` : label} data-hint={soon ? `${hint} · soon` : hint}>
      <span className={s.dockGlyph}>{center ? <span className={s.diamond}>{glyph}</span> : glyph}</span>
      {soon && (
        <span className={s.dockSoon} aria-hidden="true">
          Soon
        </span>
      )}
      <span className={s.dockLabel}>{label}</span>
    </button>
  );
}

/** The cut-in: one full-width slab per moment, in like a fighting-game call-out, then gone. Never over an open window. */
function CutIn({ hidden }: { hidden: boolean }) {
  const [event, setEvent] = useState<CityEvent | null>(null);
  const selectedId = useCity((st) => st.selectedId);
  useCityEvents((e) => setEvent(e));
  useEffect(() => {
    if (!event) return;
    const timer = setTimeout(() => setEvent(null), 2300);
    return () => clearTimeout(timer);
  }, [event]);
  // An open tower card owns the frame. «Flashing effects» off (CITY-66) keeps the slab, still (hud.module.css).
  if (!event || selectedId || hidden) return null;
  return (
    <div className={s.cutin} key={event.id}>
      <div className={s.cutinSlab} style={{ ['--accent' as string]: ACCENT[event.kind] }}>
        <div className={s.cutinKind}>{event.title}</div>
        <div className={s.cutinMain}>
          <span className={`${s.display} ${s.cutinSymbol}`}>{event.symbol ? `$${event.symbol.replace(/^\$/, '')}` : 'New pool'}</span>
          <span className={s.cutinValue}>{event.value}</span>
        </div>
      </div>
    </div>
  );
}

function TowerCard() {
  const selectedId = useCity((st) => st.selectedId);
  const layout = useCity((st) => st.layout);
  const select = useCity((st) => st.select);
  const [sharing, setSharing] = useState<'idle' | 'busy' | 'done'>('idle');
  const [why, setWhy] = useState(false);
  const placed = useMemo(() => layout.towers.find((t) => t.tower.id === selectedId) ?? null, [layout, selectedId]);
  const rank = useMemo(() => (placed ? [...layout.towers].sort((a, b) => b.height - a.height).indexOf(placed) + 1 : 0), [layout, placed]);
  useEffect(() => {
    setSharing('idle');
    setWhy(false);
  }, [selectedId]);
  if (!placed) return null;
  const t: Tower = placed.tower;
  if (!isNamed(t)) return <UnverifiedCard tower={t} onClose={() => select(null)} />;
  const up = t.change24h >= 0;
  const accent = up ? 'var(--mint)' : 'var(--flare)';

  const share = async () => {
    setSharing('busy');
    // Let the camera finish its flight before taking the frame.
    await new Promise((r) => setTimeout(r, 120));
    const frame = await requestFrame();
    const blob = await composeTowerCard(frame, t, rank, layout.towers.length);
    if (blob) await shareImage(blob, `${t.symbol.replace(/[^a-z0-9]/gi, '')}-tower.png`, `$${t.symbol.replace(/^\$/, '')} is tower #${rank} in the skyline. ${coinLink(t.id)}`);
    setSharing('done');
  };

  return (
    <div className={`${s.panel} ${s.card}`} style={{ ['--accent' as string]: accent }}>
      <div className={s.cardHead}>
        <TokenIcon t={t} className={s.cardIcon} />
        <div className={s.cardTitle}>
          <div className={`${s.display} ${s.cardSymbol}`}>{sym(t)}</div>
          <div className={s.cardName}>
            <span>{t.name}</span>
            <span className={s.tag}>{DISTRICT[t.district]}</span>
            {t.verified ? (
              <button className={`${s.tag} ${s.tagOk} ${s.tagButton}`} onClick={() => setWhy((v) => !v)} aria-expanded={why}>
                Verified <span aria-hidden="true">ⓘ</span>
              </button>
            ) : (
              <span className={`${s.tag} ${s.tagWarn}`}>Unverified</span>
            )}
          </div>
        </div>
        <BeaconAction tower={t} />
        <button className={s.close} aria-label="Close" onClick={() => select(null)}>
          <CloseGlyph />
        </button>
      </div>
      {why && <div className={s.why}>Jupiter lists this mint as the project&apos;s own token. It is not a safety rating.</div>}
      <div className={s.priceRow}>
        <span className={`${s.display} ${s.price}`}>{towerFigure(t, 'price', formatPrice)}</span>
        <span className={`${s.change} ${up ? s.up : s.down}`}>
          {up ? '+' : '−'}
          {Math.abs(t.change24h).toFixed(1)}% <small>24H</small>
        </span>
        <ChartAction tower={t} />
      </div>
      <div className={s.grid}>
        <Cell label="Market cap" value={towerFigure(t, 'mcap', money)} />
        <Cell label="Liquidity" value={towerFigure(t, 'liquidity', money)} />
        <Cell label="Traders 1h" value={towerFigure(t, 'traders1h', compact)} />
        <Cell label="Rank" value={`#${rank}`} />
      </div>
      <div className={s.actions}>
        <TradeAction tower={t} className={`${s.display} ${s.primary}`} />
        <button className={s.secondary} onClick={share} disabled={sharing === 'busy'}>
          {sharing === 'busy' ? 'Making card…' : sharing === 'done' ? 'Share again' : 'Share tower'}
        </button>
      </div>
      <FuturesAction tower={t} />
    </div>
  );
}

/** A new, unverified pool: no name, no logo, nothing to share — just what it is. */
function UnverifiedCard({ tower: t, onClose }: { tower: Tower; onClose: () => void }) {
  return (
    <div className={`${s.panel} ${s.card}`} style={{ ['--accent' as string]: 'var(--amber)' }}>
      <div className={s.cardHead}>
        <div className={s.cardIcon} />
        <div className={s.cardTitle}>
          <div className={`${s.display} ${s.cardSymbol}`}>New pool</div>
          <div className={s.cardName}>
            <span className={s.tag}>{DISTRICT[t.district]}</span>
            <span className={`${s.tag} ${s.tagWarn}`}>Unverified</span>
          </div>
        </div>
        <button className={s.close} aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </div>
      <div className={`${s.grid} ${s.gridLoose}`}>
        <Cell label="Market cap" value={towerFigure(t, 'mcap', money)} />
        <Cell label="Liquidity" value={towerFigure(t, 'liquidity', money)} />
        <Cell label="Traders 1h" value={towerFigure(t, 'traders1h', compact)} />
        <Cell label="Organic" value={towerFigure(t, 'organic', (v) => `${Math.round(v)}/100`)} />
      </div>
      <div className={s.note}>A pool that opened in the last hours and is not verified by Jupiter. The city shows it without a name: most launches fade within hours.</div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.cell}>
      <div className={s.cellLabel}>{label}</div>
      <div className={s.cellValue}>{value}</div>
    </div>
  );
}
