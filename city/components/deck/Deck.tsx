'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { GARAGE_OPEN } from '@/city/lib/agent/garage/flag';
import { toggleGarage } from '@/city/lib/agent/garage/show';
import { useGarage } from '@/city/lib/agent/garage/store';
import { useAgent } from '@/city/lib/agent/store';
import { HACK_OPEN } from '@/city/lib/arena/hack/view/flag';
import { toggleHack, useHack } from '@/city/lib/arena/hack/view/live';
import { openExternal } from '@/city/lib/app-bridge/page';
import { playTick } from '@/city/lib/audio/engine';
import { useBackPanel } from '@/city/lib/back/panels';
import { closeBots, openBots, useBotsWindow } from '@/city/lib/bots/open';
import { useCity } from '@/city/lib/city/store';
import { openTradeCard } from '@/city/lib/coin/open';
import { useChrome } from '@/city/lib/deck/chrome';
import { CENTER, LEFT, RIGHT, doorOpen, doorsHint, doorsOf, futuresWay, isTray, placeOpen, type Door, type Place, type Switches, type Tray } from '@/city/lib/deck/items';
import { trayCentre } from '@/city/lib/deck/tray';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { closeEarn, openEarn, useEarn } from '@/city/lib/earn/open';
import { EXCHANGE_EXIT, EXCHANGE_MODE, EXCHANGE_SHOWN } from '@/city/lib/exchange/flag';
import { marketForTower } from '@/city/lib/exchange/markets';
import { DEFAULT_SYMBOL, useExchange } from '@/city/lib/exchange/store';
import { GUARD_OPEN } from '@/city/lib/guard/flag';
import { useGuard } from '@/city/lib/guard/store';
import { useWords } from '@/city/lib/i18n/dict';
import { isNamed } from '@/city/lib/market/types';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { openMoney, useMoney } from '@/city/lib/money/open';
import { toggleArena, useArena } from '@/city/lib/ring/arena';
import { RING_OPEN } from '@/city/lib/ring/flag';
import { RXN_OPEN, RXN_URL } from '@/city/lib/rxn/flag';
import { SPOT_OPEN, TRADE_OPEN } from '@/city/lib/trade/gates';
import { BUSY, useTrade, type View } from '@/city/lib/trade/store';
import { SOL } from '@/city/lib/trade/tiles';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { useVault, vaultStore } from '@/city/lib/vault/store';
import { RingGlyph } from '../game/glyphs';
import { installPlay } from '../game/play';
import { LaunchGlyph } from '../hud/glyphs';
import { useLaunchDistrict } from '../launch/LaunchSlot';
import { VaultGlyph } from '../vault/glyphs';
import {
  AgentsGlyph,
  ArenaGlyph,
  BotGlyph,
  ChevronGlyph,
  EarnGlyph,
  FuturesGlyph,
  GarageGlyph,
  GuardGlyph,
  HackGlyph,
  HangarGlyph,
  MoneyGlyph,
  OutGlyph,
  SpotGlyph,
  SwapGlyph,
  TradeGlyph,
} from './glyphs';
import { DECK } from './words';
import s from './deck.module.css';

type Words = (typeof DECK)['en'];

const GLYPH: Readonly<Record<Place, () => ReactNode>> = {
  launch: LaunchGlyph,
  spot: TradeGlyph,
  earn: EarnGlyph,
  agents: AgentsGlyph,
  arena: ArenaGlyph,
  guard: GuardGlyph,
  money: MoneyGlyph,
};

const DOOR_GLYPH: Readonly<Record<Door, () => ReactNode>> = {
  swap: SwapGlyph,
  spot: SpotGlyph,
  futures: FuturesGlyph,
  hangar: HangarGlyph,
  bots: BotGlyph,
  garage: GarageGlyph,
  ring: RingGlyph,
  hack: HackGlyph,
  vault: VaultGlyph,
};

const PLACE_HINT = {
  launch: 'hintLaunch',
  spot: 'hintSpot',
  earn: 'hintEarn',
  agents: 'hintAgents',
  arena: 'hintArena',
  guard: 'hintGuard',
  money: 'hintMoney',
} as const satisfies Record<Place, keyof Words>;

const DOOR_WORD = {
  swap: 'swap',
  spot: 'spotDoor',
  futures: 'futures',
  hangar: 'hangar',
  bots: 'bots',
  garage: 'garage',
  ring: 'ring',
  hack: 'hack',
  vault: 'vault',
} as const satisfies Record<Door, keyof Words>;

const DOOR_HINT = {
  swap: 'hintSwap',
  spot: 'hintSpotDoor',
  futures: 'hintFutures',
  hangar: 'hintHangar',
  bots: 'hintBots',
  garage: 'hintGarage',
  ring: 'hintRing',
  hack: 'hintHack',
  vault: 'hintVault',
} as const satisfies Record<Door, keyof Words>;

/** How long «Soon» stands over a place tapped before it opens. */
const SOON_MS = 1600;
/** The air between the Deck's top edge and its open tray. */
const TRAY_LIFT = 26;

function tick(): void {
  if (useCity.getState().sound) playTick();
}

/** The coin a door opens on: the trade window's, the tower picked in the city, or SOL — as the plain swap or as spot. */
function openTrade(view: View): void {
  const trade = useTrade.getState();
  if (trade.open && trade.tower) return trade.setView(view);
  const id = useCity.getState().selectedId;
  const placed = id ? useCity.getState().layout.towers.find((t) => t.tower.id === id) : null;
  if (placed && isNamed(placed.tower)) return trade.openFor(placed.tower, 'buy', { view });
  useExchange.getState().hide();
  openTradeCard({ mint: SOL.mint, symbol: SOL.symbol, name: SOL.name ?? SOL.symbol, icon: SOL.icon ?? null });
  useTrade.getState().setView(view);
}

/**
 * Futures on Phoenix: closing out, on the market of the wallet's first position; else the coin's own perpetual, or
 * SOL-PERP. The spot window steps aside unless a signature holds it.
 */
function openFutures(): void {
  const trade = useTrade.getState();
  const exchange = useExchange.getState();
  const held = EXCHANGE_EXIT ? exchange.account.value?.positions[0]?.symbol : null;
  const id = trade.open && trade.tower ? trade.tower.mint : useCity.getState().selectedId;
  const tower = id ? (useCity.getState().layout.towers.find((t) => t.tower.id === id)?.tower ?? null) : null;
  const markets = exchange.markets.value?.markets ?? [];
  const symbol = held || (tower && marketForTower(tower, markets)?.symbol) || DEFAULT_SYMBOL;
  if (trade.open && !BUSY.has(trade.phase) && !trade.held) trade.close();
  exchange.show(symbol);
}

/** The Vault's room: the camera flies to its door; a second tap leaves it. */
function openVault(): void {
  if (vaultStore.getState().open) return vaultStore.getState().leave();
  useCity.getState().select(null);
  void vaultStore.getState().enter();
}

/** The hangar: your agent on the Arena's «Agent» tab, made right there when there is none yet (CITY-217). */
const openHangar = () => toggleArena('agent');

/**
 * The Deck, the city's menu: Launch · Spot · Earn, the Agents diamond, Arena · Guard · Money
 * — every place on its spot, the ones not open yet with «Soon». Spot, Agents and the Arena open a tray of their doors;
 * Futures in Spot's tray leads to RXN once it is live, or to Phoenix while the wallet still holds something there. An
 * arrow on its edge hides it; another brings it back. Nothing here signs or moves money: each place opens its own window
 * — Agents' «Bots» the bots window (CITY-134), where the scout is one of the bots, and «Garage» the garage agent's window
 * (CITY-29).
 */
export function Deck() {
  const w = useWords(DECK);
  const launch = useLaunchDistrict();
  const shown = useChrome((st) => st.bottom);
  const toggle = useChrome((st) => st.toggle);
  const [tray, setTray] = useState<Tray | null>(null);
  const [soon, setSoon] = useState<Place | null>(null);
  const ref = useRef<HTMLElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  // The open tray's place on the screen (CITY-242): its middle over the place pressed, its foot where it always stood
  // over the Deck. Null until it is measured.
  const [trayAt, setTrayAt] = useState<Readonly<{ x: number; bottom: number }> | null>(null);
  // The tray stands in a layer of its own over the city's windows (CITY-242), as the wallet's and the events' panels
  // do: a window as tall as the workspace stood over it. Drawn into the city's own root, where its tokens are.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setRoot(ref.current?.closest('main') ?? document.body), []);

  const trading = useTrade((st) => st.open);
  const exchanging = useExchange((st) => st.open);
  const moneyOpen = useMoney((st) => st.open);
  const scouting = useAgent((st) => st.on || st.panel !== 'none');
  const botsWindow = useBotsWindow((st) => st.open);
  const garageWindow = useGarage((st) => st.open || st.away);
  const harboring = useHarbor((st) => st.open);
  const earnWindow = useEarn((st) => st.open);
  const earning = EARN_OPEN ? earnWindow : harboring;
  const vaulting = useVault((st) => st.open);
  const dueling = useArena((st) => st.open);
  const hacking = useHack((st) => st.open);
  const guarding = useGuard((st) => st.open);

  const on: Switches = {
    launch: launch.open,
    // Earn's own window (CITY-92) where its switch is open; until then the Harbor stands in for it.
    earn: EARN_OPEN || HARBOR_OPEN,
    // «Охорона» (CITY-152): the pre-sign check's window, behind its own switch until the operator opens it.
    guard: GUARD_OPEN,
    money: MONEY_OPEN,
    trade: TRADE_OPEN,
    spot: SPOT_OPEN,
    // Futures are off (30.10): the door stands only as the way out to RXN; a holding closes out from Money.
    futures: futuresWay(EXCHANGE_MODE, RXN_OPEN, false),
    hangar: RING_OPEN,
    bots: AGENTS_OPEN,
    // The garage agent (CITY-29): a character without money — reports, heads-ups and advice; behind its own switch.
    garage: GARAGE_OPEN,
    // The Ring (CITY-217): the Arena's window — the fight where the duels' own switch is open too, the agent, the board.
    ring: RING_OPEN,
    // Hack (CITY-227): the Arena's third door, behind its own switch until it is opened.
    hack: HACK_OPEN,
    vault: VAULT_OPEN,
  };
  const lit: Readonly<Record<Place, boolean>> = {
    launch: launch.showing,
    spot: trading || exchanging || tray === 'spot',
    earn: earning,
    agents: botsWindow || scouting || tray === 'agents' || garageWindow,
    arena: vaulting || dueling || hacking || tray === 'arena',
    guard: guarding,
    money: moneyOpen,
  };

  // The places of play the menu opens — the hangar, the Vault — keep the layer's watchers, with or without Play's switch.
  useEffect(() => installPlay(), []);

  useEffect(() => {
    if (!soon) return;
    const timer = setTimeout(() => setSoon(null), SOON_MS);
    return () => clearTimeout(timer);
  }, [soon]);

  // The tray folds away on Escape, on a phone's «Back», on a tap anywhere else, and when the Deck hides.
  useBackPanel('tray', tray !== null, () => setTray(null));
  useEffect(() => {
    if (!tray) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // The keyboard goes back to the place that opened the tray: the tray stands apart from the Deck in the page.
      if (trayRef.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>(`[data-deck-place='${tray}']`)?.focus({ preventScroll: true });
      setTray(null);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !trayRef.current?.contains(target)) setTray(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [tray]);
  useEffect(() => {
    if (!shown) setTray(null);
  }, [shown]);
  // The tray stands over the place that opened it, kept whole on the screen; measured before it is painted, and again
  // when the screen changes.
  useLayoutEffect(() => {
    if (!tray) return setTrayAt(null);
    const place = () => {
      const deck = ref.current;
      const box = trayRef.current;
      const item = deck?.querySelector<HTMLElement>(`[data-deck-place='${tray}']`);
      if (!deck || !box || !item) return;
      const at = deck.getBoundingClientRect();
      const pressed = item.getBoundingClientRect();
      const x = at.left + trayCentre(at.left, pressed.left + pressed.width / 2, box.offsetWidth, window.innerWidth, Math.min(at.left, 16));
      setTrayAt({ x, bottom: Math.round(window.innerHeight - at.top + TRAY_LIFT) });
    };
    place();
    // Opened from the keyboard (the place still has the focus), the keyboard goes on into the tray's first door.
    const pressed = ref.current?.querySelector<HTMLElement>(`[data-deck-place='${tray}']`);
    if (pressed && document.activeElement === pressed) trayRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [tray]);
  // Spot's tray: the Phoenix markets, so Futures lands on the coin's own perpetual (kept for a minute by the store), and
  // while closing out the wallet's account again.
  const toPhoenix = on.futures === 'exchange';
  useEffect(() => {
    if (tray !== 'spot' || !EXCHANGE_SHOWN) return;
    if (toPhoenix) void useExchange.getState().loadMarkets();
    if (EXCHANGE_EXIT && useExchange.getState().owner) void useExchange.getState().loadAccount();
  }, [tray, toPhoenix]);

  const go = (place: Place) => {
    if (!placeOpen(place, on)) {
      tick();
      return setSoon(place);
    }
    if (isTray(place)) {
      // One open door is the place itself: no tray to pick from.
      const only = doorsOf(place, on);
      if (only.length === 1) return enter(only[0]);
      tick();
      return setTray((open) => (open === place ? null : place));
    }
    tick();
    setTray(null);
    switch (place) {
      case 'launch':
        return launch.start();
      case 'earn':
        useAgent.getState().closePanel();
        if (EARN_OPEN) return useEarn.getState().open ? closeEarn() : openEarn();
        return useHarbor.getState().open ? useHarbor.getState().hide() : useHarbor.getState().show();
      case 'guard':
        return useGuard.getState().open ? useGuard.getState().close() : useGuard.getState().show();
      case 'money':
        return useMoney.getState().open ? useMoney.getState().close() : openMoney();
    }
  };

  const enter = (door: Door) => {
    tick();
    if (!doorOpen(door, on)) return;
    setTray(null);
    switch (door) {
      case 'swap':
        return openTrade('swap');
      case 'spot':
        return openTrade('spot');
      case 'futures':
        return on.futures === 'rxn' ? openExternal(RXN_URL) : openFutures();
      case 'hangar':
        return openHangar();
      case 'bots':
        return useBotsWindow.getState().open ? closeBots() : openBots();
      case 'garage':
        return toggleGarage();
      case 'ring':
        return toggleArena('fight');
      case 'hack':
        return toggleHack();
      case 'vault':
        return openVault();
    }
  };

  const item = (place: Place) => {
    const open = placeOpen(place, on);
    const label = w[place];
    const Glyph = GLYPH[place];
    const center = place === CENTER;
    return (
      <button
        key={place}
        type="button"
        className={[s.item, center && s.center, place === 'money' && s.quiet, lit[place] && s.on, !open && s.shut].filter(Boolean).join(' ')}
        aria-label={open ? label : w.opensSoon(label)}
        aria-pressed={!isTray(place) && open ? lit[place] : undefined}
        aria-expanded={isTray(place) && open && doorsOf(place, on).length > 1 ? tray === place : undefined}
        data-hint={place === 'arena' ? (doorsHint(doorsOf('arena', on).map((door) => w[DOOR_WORD[door]]), w.and) ?? w.hintArena) : w[PLACE_HINT[place]]}
        data-deck-place={place}
        onClick={() => go(place)}
      >
        {/* A place not open yet is dimmed, no tag: a tap says «opens soon» (CITY-188). */}
        {soon === place && <span className={s.bubble}>{w.opensSoon(label)}</span>}
        {center ? (
          <span className={s.diamondBox}>
            <span className={s.diamond}>
              <Glyph />
            </span>
          </span>
        ) : (
          <span className={s.glyph}>
            <Glyph />
          </span>
        )}
        <span className={s.label}>{label}</span>
      </button>
    );
  };

  const door = (id: Door) => {
    const out = id === 'futures' && on.futures === 'rxn';
    const label = w[DOOR_WORD[id]];
    const Glyph = DOOR_GLYPH[id];
    return (
      <button
        key={id}
        type="button"
        className={s.door}
        aria-label={out ? w.futuresOnRxn : label}
        data-hint={w[out ? 'hintRxn' : DOOR_HINT[id]]}
        data-deck-door={id}
        data-deck-out={out ? '' : undefined}
        onClick={() => enter(id)}
      >
        {out && (
          <span className={s.outTag}>
            {w.rxn}
            <OutGlyph />
          </span>
        )}
        <span className={s.doorGlyph}>
          <Glyph />
        </span>
        <span className={s.label}>{label}</span>
      </button>
    );
  };

  const doors = tray ? doorsOf(tray, on) : [];
  return (
    <>
      <nav ref={ref} className={[s.deck, !shown && s.away].filter(Boolean).join(' ')} aria-label={w.menu} aria-hidden={!shown} inert={!shown} data-city-deck="">
        <button type="button" className={s.handle} aria-label={w.hideMenu} onClick={() => toggle('bottom')}>
          <ChevronGlyph />
        </button>
        {LEFT.map(item)}
        {item(CENTER)}
        {RIGHT.map(item)}
      </nav>
      {tray &&
        root &&
        createPortal(
          <div className={s.trayLayer}>
            <div
              key={`tray-${tray}`}
              ref={trayRef}
              className={s.tray}
              style={{ ['--doors' as string]: doors.length, ...(trayAt === null ? { visibility: 'hidden' } : { left: trayAt.x, bottom: trayAt.bottom }) }}
              role="group"
              aria-label={w[tray]}
              data-deck-tray={tray}
            >
              {doors.map(door)}
            </div>
          </div>,
          root,
        )}
      {!shown && (
        <button type="button" className={`${s.handle} ${s.restore}`} aria-label={w.showMenu} onClick={() => toggle('bottom')} data-deck-restore="">
          <ChevronGlyph />
        </button>
      )}
    </>
  );
}

/** The top bar's own arrow: at the top edge, in the middle; it hides the bar and brings it back. */
export function TopHandle() {
  const w = useWords(DECK);
  const shown = useChrome((st) => st.top);
  const toggle = useChrome((st) => st.toggle);
  useEffect(() => useChrome.getState().hydrate(), []);
  return (
    <button
      type="button"
      className={[s.topHandle, !shown && s.topAway].filter(Boolean).join(' ')}
      aria-label={shown ? w.hideTop : w.showTop}
      aria-expanded={shown}
      onClick={() => toggle('top')}
      data-top-handle=""
    >
      <ChevronGlyph />
    </button>
  );
}
