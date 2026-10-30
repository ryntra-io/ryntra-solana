'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND } from '@/city/lib/brand';
import { isStale } from '@/city/lib/city/events';
import { useCity, useCityEvents, type CityEvent } from '@/city/lib/city/store';
import { useChrome } from '@/city/lib/deck/chrome';
import { useFeedPanel } from '@/city/lib/feed/panel';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { useHall } from '@/city/lib/launch/hall-store';
import { isNamed, towerFigure, type District, type Tower } from '@/city/lib/market/types';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { cancelFilming, useMoments } from '@/city/lib/moments/stage';
import { useLaunch } from '@/city/lib/launch/district';
import { BUSY, useTrade } from '@/city/lib/trade/store';
import { RUN_OPEN } from '@/city/lib/run/flag';
import { useRun } from '@/city/lib/run/store';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { useAgent } from '@/city/lib/agent/store';
import { PLAY_OPEN } from '@/city/lib/game/flag';
import { useLayer } from '@/city/lib/game/layer';
import { quarterStore } from '@/city/lib/quarter/store';
import { howStore } from '@/city/lib/art/how';
import { AgentCard, useAgentCard } from '../agent/AgentCard';
import { chartOpen, useChartOpen } from '../chart/ChartAction';
import { EventsBell } from '../feed/EventsBell';
import { LiveFeed } from '../feed/LiveFeed';
import { LensBar } from '../lens/LensBar';
import { LaunchSlot, useLaunchDistrict } from '../launch/LaunchSlot';
import { WalletChip } from '../quarter/WalletChip';
import { RunHud } from '../run/RunHud';
import { CitySearch } from '../search/CitySearch';
import { AssistantButton } from '../assistant/AssistantLayer';
import { BrandWithLayers } from '../game/LayerSwitch';
import { GameDock, GameSlot } from '../game/GameDock';
import { playEscape } from '../game/play';
import { Deck, TopHandle } from '../deck/Deck';
import { compact, money } from './bits';
import { CloseGlyph } from './glyphs';
import { HoverLabel } from './HoverLabel';
import { Mark } from './Mark';
import { CityMenu } from './Menu';
import { useWindowOpen } from './useWindowOpen';
import { HUD } from './words';
import { dateText, digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import { retellLaunchMoment } from '@/city/lib/launch/words';
import s from './hud.module.css';

type HudText = TextKey<typeof HUD>;

const DISTRICT: Record<District, HudText> = {
  core: 'districtCore',
  heights: 'districtHeights',
  strip: 'districtStrip',
  avenue: 'districtAvenue',
  docks: 'districtDocks',
};

const ACCENT: Record<CityEvent['kind'], string> = { pump: 'var(--mint)', flare: 'var(--flare)', launch: 'var(--mint)' };

/** The first-visit hint is shown once per browser: gone after its close or the first tower tapped. */
const HINT_KEY = 'ryntra.city.firstHint';

type Play = (from: 'home' | 'city') => void;

/**
 * Ryntra's home over the live city (decision 70): the top bar, one card above the dock — the hot tower or a
 * challenge — and the district dock. A tower picked opens its one window, the trade card (CITY-78, `TradeLayer`); only a
 * pool without a name keeps a small card here. A run owns the whole screen. In the Play layer (CITY-81) the dock and the
 * card are the game's: your quarter, the Ring, the Vault, the Hall, the Run, the Map.
 */
export function Hud({ onPlay, onSound }: { onPlay: Play; onSound: (on: boolean) => void }) {
  const running = useRun((st) => st.phase !== 'off');
  const topShown = useChrome((st) => st.top);
  // The events live under the top bar's bell: nothing of them on the city until it is open.
  const feedOpen = useFeedPanel((st) => st.open);
  const filming = useFilming();
  const selectedId = useCity((st) => st.selectedId);
  const play = useLayer((st) => st.layer === 'play');
  // Play's own dock only behind its switch (decision 86): otherwise the Deck stays the one menu, in Play's places too.
  const playDock = play && PLAY_OPEN;
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
  // The Launch district owns the card slot while its sheet is open or a launch's tower is picked.
  const launch = useLaunchDistrict();
  // The tower's window owns the bottom of the screen while it is open (CITY-78): nothing of the home stands under it.
  // The tower's chart takes its place the same way (CITY-5a).
  const trading = useTrade((st) => st.open);
  const charting = useChartOpen();
  // A tower picked from the city closes the menu, so two cards never stack on a phone.
  useEffect(() => {
    if (selectedId || launch.showing) closeMenu();
  }, [selectedId, launch.showing, closeMenu]);

  // The logo: back to the city's overview from anywhere — every panel shut, the camera on the skyline, the address `/`.
  const home = useCallback(() => {
    closeMenu();
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
      const sheet = useLaunch.getState();
      if (sheet.sheet && closable(sheet.phase)) return sheet.closeSheet();
      if (useCity.getState().selectedId) return useCity.getState().select(null);
      if (useAgent.getState().panel !== 'none') return useAgent.getState().closePanel();
      // Last, the Play layer: its Map and Hall, then back to City (CITY-81).
      playEscape();
    };
    // Capture: decided before the panels' own handlers change what is open.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, settings, closeMenu]);

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
    <div className={s.layer} data-window={windowOpen ? '' : undefined} data-top-hidden={topShown ? undefined : ''}>
      {/* First, so the top bar's menus and the cut-in stand over it (CITY-66). */}
      {feedOpen && <LiveFeed panel hidden={windowOpen} />}
      <TopBar onSound={onSound} onHome={home} windowOpen={windowOpen} />
      <TopHandle />
      <CutIn hidden={windowOpen} />
      <HoverLabel />
      <FirstHint hidden={windowOpen || trading || !!selectedId || launch.showing} />
      {trading || charting ? null : launch.showing ? (
        <LaunchSlot />
      ) : selectedId ? (
        <PoolCard />
      ) : (
        <>
          {/* One panel at a time: the Hall's sheet stands where the card would (CITY-9); an open window keeps the
              home's own card out of its way. */}
          {menu || settings || hall ? null : agentCard ? (
            <AgentCard />
          ) : windowOpen ? null : challenge ? (
            <ChallengeCard beat={challenge.beat} onPlay={() => onPlay('home')} onLater={() => setChallenge(null)} />
          ) : play ? (
            <GameSlot />
          ) : null}
          {playDock && <GameDock onRun={() => onPlay('city')} />}
        </>
      )}
      {/* The menu stays under every window of the frame and under a picked tower (30.10): Spot stands as the Exchange
          does. A launch's sheet and Play's own dock, where its switch is open, keep the bottom for themselves. */}
      {!playDock && !launch.showing && (
        <Deck
          onAgent={() => {
            closeMenu();
            // One panel at a time: the Harbor gives way, unless it is waiting on the wallet or sending.
            useHarbor.getState().hide();
            if (useHarbor.getState().open) return;
            useAgent.getState().toggle();
          }}
        />
      )}
    </div>
  );
}

/** The launch sheet closes unless a launch is under way (between the upload and the send). */
export const closable = (phase: ReturnType<typeof useLaunch.getState>['phase']) => !phase || phase.step === 'done' || phase.step === 'failed';

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
  // Without Play's switch there is no way back by it: home is the City (decision 86).
  if (!PLAY_OPEN) useLayer.getState().set('city');
  useCity.getState().home();
  if (typeof window !== 'undefined' && `${location.pathname}${location.search}${location.hash}` !== '/') {
    // The same page under its home address: `/c/<mint>` and the rest become `/`, without loading anything again.
    history.replaceState(history.state, '', '/');
  }
}

/** The mark and the wordmark: a button home. */
function Brand({ onHome }: { onHome: () => void }) {
  const w = useWords(HUD);
  return (
    <button className={s.brand} aria-label={w.home} onClick={onHome}>
      <Mark size={32} />
      <span className={`${s.display} ${s.brandName}`} aria-hidden="true">
        {BRAND.name}
      </span>
    </button>
  );
}

function TopBar({ onSound, onHome, windowOpen }: { onSound: (on: boolean) => void; onHome: () => void; windowOpen: boolean }) {
  const snapshot = useCity((st) => st.snapshot);
  const w = useWords(HUD);
  // Re-check freshness every half minute, so a stalled feed says so instead of looking live.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const read = snapshot.towers.length > 0;
  const live = snapshot.source === 'live' && !isStale(snapshot.fetchedAt);
  const at = new Date(snapshot.fetchedAt);
  const time = dateText(at, { hour: '2-digit', minute: '2-digit' });
  const status = snapshot.source !== 'live' ? w.snapshot : live ? w.live : w.delayed;
  // A narrow phone names what is not live by the age of its data: the read's time, or the saved city's day.
  const short = snapshot.source !== 'live' ? dateText(at, { day: 'numeric', month: 'short' }) : live ? w.live : time;
  return (
    <div className={s.top} data-city-top="">
      <BrandWithLayers onHome={onHome}>
        <Brand onHome={onHome} />
      </BrandWithLayers>
      <LensBar />
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
      <EventsBell hidden={windowOpen} />
      <CityMenu onSound={onSound} />
    </div>
  );
}

/** Once per browser, the one thing to know: a tower opens with a tap. */
function FirstHint({ hidden }: { hidden: boolean }) {
  const w = useWords(HUD);
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
      <span>{w.firstHint}</span>
      <button className={s.firstHintClose} aria-label={w.gotIt} onClick={done}>
        <CloseGlyph />
      </button>
    </div>
  );
}

/** A challenge link: the time to beat, and the run one tap away. */
function ChallengeCard({ beat, onPlay, onLater }: { beat: number; onPlay: () => void; onLater: () => void }) {
  const w = useWords(HUD);
  return (
    <div className={`${s.panel} ${s.slot}`}>
      <div className={s.kicker}>
        <span className={s.pulse} aria-hidden="true" />
        {w.challenge}
      </div>
      <div className={`${s.display} ${s.slotTitle}`}>{w.beat(digits(beat.toFixed(1)))}</div>
      <div className={s.hotLine}>{w.challengeLine}</div>
      <div className={s.pair}>
        <button className={`${s.display} ${s.action}`} onClick={onPlay}>
          {w.run}
        </button>
        <button className={s.quiet} onClick={onLater}>
          {w.later}
        </button>
      </div>
    </div>
  );
}

/* A moment is written once in English (city/lib/city/events.ts — the X drafts read it too); the slab says it in the
   language on screen. */
const CUT_TITLE: Readonly<Record<string, HudText>> = { PUMP: 'cutPump', 'SOLAR FLARE': 'cutFlare', 'NEW TOWER': 'cutNewTower' };

function cutTitle(title: string, w: (typeof HUD)['en'], lang: Lang): string {
  const key = CUT_TITLE[title];
  return key ? w[key] : (retellLaunchMoment(title, lang) ?? title);
}

function cutValue(value: string, w: (typeof HUD)['en'], lang: Lang): string {
  if (value === 'UNVERIFIED') return w.cutUnverified;
  const launch = retellLaunchMoment(value, lang);
  if (launch) return digits(launch, lang);
  return digits(value.replace(/(\d+)([MHD])$/, (_, n: string, unit: string) => w.cutWindow(n, unit)), lang);
}

/** The cut-in: one full-width slab per moment, in like a fighting-game call-out, then gone. Never over an open window. */
function CutIn({ hidden }: { hidden: boolean }) {
  const [event, setEvent] = useState<CityEvent | null>(null);
  const selectedId = useCity((st) => st.selectedId);
  const w = useWords(HUD);
  const lang = useLang();
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
        <div className={s.cutinKind}>{cutTitle(event.title, w, lang)}</div>
        <div className={s.cutinMain}>
          <span className={`${s.display} ${s.cutinSymbol}`}>{event.symbol ? `$${event.symbol.replace(/^\$/, '')}` : w.newPool}</span>
          <span className={s.cutinValue}>{cutValue(event.value, w, lang)}</span>
        </div>
      </div>
    </div>
  );
}

/** A picked tower without a name: its small card. A named tower opens its window instead (`TradeLayer`). */
function PoolCard() {
  const selectedId = useCity((st) => st.selectedId);
  const layout = useCity((st) => st.layout);
  const select = useCity((st) => st.select);
  const placed = useMemo(() => layout.towers.find((t) => t.tower.id === selectedId) ?? null, [layout, selectedId]);
  if (!placed || isNamed(placed.tower)) return null;
  return <UnverifiedCard tower={placed.tower} onClose={() => select(null)} />;
}

/** A new, unverified pool: no name, no logo, nothing to share — just what it is. */
function UnverifiedCard({ tower: t, onClose }: { tower: Tower; onClose: () => void }) {
  const w = useWords(HUD);
  return (
    <div className={`${s.panel} ${s.card}`} style={{ ['--accent' as string]: 'var(--amber)' }}>
      <div className={s.cardHead}>
        <div className={s.cardIcon} />
        <div className={s.cardTitle}>
          <div className={`${s.display} ${s.cardSymbol}`}>{w.newPool}</div>
          <div className={s.cardName}>
            <span className={s.tag}>{w[DISTRICT[t.district]]}</span>
            <span className={`${s.tag} ${s.tagWarn}`}>{w.unverified}</span>
          </div>
        </div>
        <button className={s.close} aria-label={w.close} onClick={onClose}>
          <CloseGlyph />
        </button>
      </div>
      <div className={`${s.grid} ${s.gridLoose}`}>
        <Cell label={w.marketCap} value={towerFigure(t, 'mcap', money)} />
        <Cell label={w.liquidity} value={towerFigure(t, 'liquidity', money)} />
        <Cell label={w.traders1h} value={towerFigure(t, 'traders1h', compact)} />
        <Cell label={w.organic} value={towerFigure(t, 'organic', (v) => `${Math.round(v)}/100`)} />
      </div>
      <div className={s.note}>{w.unverifiedNote}</div>
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
