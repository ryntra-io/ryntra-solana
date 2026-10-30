'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { useAgent } from '@/city/lib/agent/store';
import { openExternal } from '@/city/lib/app-bridge/page';
import { playTick } from '@/city/lib/audio/engine';
import { useBackPanel } from '@/city/lib/back/panels';
import { useCity } from '@/city/lib/city/store';
import { openTradeCard } from '@/city/lib/coin/open';
import { useChrome } from '@/city/lib/deck/chrome';
import { CENTER, LEFT, RIGHT, doorOpen, doorsOf, futuresWay, isTray, placeOpen, type Door, type Place, type Switches, type Tray } from '@/city/lib/deck/items';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { EXCHANGE_EXIT, EXCHANGE_MODE, EXCHANGE_SHOWN } from '@/city/lib/exchange/flag';
import { marketForTower } from '@/city/lib/exchange/markets';
import { DEFAULT_SYMBOL, useExchange } from '@/city/lib/exchange/store';
import { useLayer } from '@/city/lib/game/layer';
import { useWords } from '@/city/lib/i18n/dict';
import { isNamed } from '@/city/lib/market/types';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { openMoney, useMoney } from '@/city/lib/money/open';
import { RING_OPEN } from '@/city/lib/ring/flag';
import { RXN_OPEN, RXN_URL } from '@/city/lib/rxn/flag';
import { SPOT_OPEN, TRADE_OPEN } from '@/city/lib/trade/gates';
import { BUSY, useTrade, type View } from '@/city/lib/trade/store';
import { SOL } from '@/city/lib/trade/tiles';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { useVault, vaultStore } from '@/city/lib/vault/store';
import { RingGlyph } from '../game/glyphs';
import { goRing, installPlay } from '../game/play';
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
  ring: 'hintRing',
  hack: 'hintHack',
  vault: 'hintVault',
} as const satisfies Record<Door, keyof Words>;

/** How long «Soon» stands over a place tapped before it opens. */
const SOON_MS = 1600;

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

/** The hangar: into your quarter, on the garage where your agent lives — the claim first when there is no quarter yet. */
function openHangar(): void {
  useLayer.getState().set('play');
  goRing();
}

/**
 * The Deck, the city's menu: Launch · Spot · Earn, the Agents diamond, Arena · Guard · Money
 * — every place on its spot, the ones not open yet with «Soon». Spot, Agents and the Arena open a tray of their doors;
 * Futures in Spot's tray leads to RXN once it is live, or to Phoenix while the wallet still holds something there. An
 * arrow on its edge hides it; another brings it back. Nothing here signs or moves money: each place opens its own window.
 */
export function Deck({ onAgent }: { onAgent: () => void }) {
  const w = useWords(DECK);
  const launch = useLaunchDistrict();
  const shown = useChrome((st) => st.bottom);
  const toggle = useChrome((st) => st.toggle);
  const [tray, setTray] = useState<Tray | null>(null);
  const [soon, setSoon] = useState<Place | Door | null>(null);
  const ref = useRef<HTMLElement>(null);

  const trading = useTrade((st) => st.open);
  const exchanging = useExchange((st) => st.open);
  const moneyOpen = useMoney((st) => st.open);
  const botsOn = useAgent((st) => st.on || st.panel !== 'none');
  const earning = useHarbor((st) => st.open);
  const vaulting = useVault((st) => st.open);

  const on: Switches = {
    launch: launch.open,
    earn: HARBOR_OPEN,
    guard: false,
    money: MONEY_OPEN,
    trade: TRADE_OPEN,
    spot: SPOT_OPEN,
    // Futures are off (30.10): the door stands only as the way out to RXN; a holding closes out from Money.
    futures: futuresWay(EXCHANGE_MODE, RXN_OPEN, false),
    hangar: RING_OPEN,
    bots: AGENTS_OPEN,
    ring: false,
    hack: false,
    vault: VAULT_OPEN,
  };
  const lit: Readonly<Record<Place, boolean>> = {
    launch: launch.showing,
    spot: trading || exchanging || tray === 'spot',
    earn: earning,
    agents: botsOn || tray === 'agents',
    arena: vaulting || tray === 'arena',
    guard: false,
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
      setTray(null);
    };
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setTray(null);
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
  // Spot's tray: the Phoenix markets, so Futures lands on the coin's own perpetual (kept for a minute by the store), and
  // while closing out the wallet's account again.
  const toPhoenix = on.futures === 'exchange';
  useEffect(() => {
    if (tray !== 'spot' || !EXCHANGE_SHOWN) return;
    if (toPhoenix) void useExchange.getState().loadMarkets();
    if (EXCHANGE_EXIT && useExchange.getState().owner) void useExchange.getState().loadAccount();
  }, [tray, toPhoenix]);

  const go = (place: Place) => {
    tick();
    if (isTray(place)) return setTray((open) => (open === place ? null : place));
    if (!placeOpen(place, on)) return setSoon(place);
    setTray(null);
    switch (place) {
      case 'launch':
        return launch.start();
      case 'earn':
        useAgent.getState().closePanel();
        return useHarbor.getState().open ? useHarbor.getState().hide() : useHarbor.getState().show();
      case 'money':
        return useMoney.getState().open ? useMoney.getState().close() : openMoney();
    }
  };

  const enter = (door: Door) => {
    tick();
    if (!doorOpen(door, on)) return setSoon(door);
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
        return onAgent();
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
        aria-label={open || isTray(place) ? label : w.opensSoon(label)}
        aria-pressed={!isTray(place) && open ? lit[place] : undefined}
        aria-expanded={isTray(place) ? tray === place : undefined}
        data-hint={w[PLACE_HINT[place]]}
        data-deck-place={place}
        onClick={() => go(place)}
      >
        {/* A tray always opens — its doors say «Soon» themselves; a place of its own says it here. */}
        {!open && !isTray(place) && <span className={s.soonTag}>{w.soon}</span>}
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
    const open = doorOpen(id, on);
    const out = id === 'futures' && on.futures === 'rxn';
    const label = w[DOOR_WORD[id]];
    const Glyph = DOOR_GLYPH[id];
    return (
      <button
        key={id}
        type="button"
        className={[s.door, !open && s.shut].filter(Boolean).join(' ')}
        aria-label={out ? w.futuresOnRxn : open ? label : w.opensSoon(label)}
        data-hint={w[out ? 'hintRxn' : DOOR_HINT[id]]}
        data-deck-door={id}
        data-deck-out={out ? '' : undefined}
        onClick={() => enter(id)}
      >
        {!open && <span className={s.soonTag}>{w.soon}</span>}
        {out && (
          <span className={s.outTag}>
            {w.rxn}
            <OutGlyph />
          </span>
        )}
        {soon === id && <span className={s.bubble}>{w.opensSoon(label)}</span>}
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
        {tray && (
          <div key={tray} className={s.tray} style={{ ['--doors' as string]: doors.length }} role="group" aria-label={w[tray]} data-deck-tray={tray}>
            {doors.map(door)}
          </div>
        )}
      </nav>
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
