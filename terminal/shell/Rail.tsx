'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react';
import { Mark } from '@/city/components/hud/Mark';
import { BRAND } from '@/city/lib/brand';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { flowLive } from '@/city/lib/money/flag';
import { botDoors } from '@/terminal/bots/kinds';
import { Icon } from '@/terminal/ui';
import { useAddressTail } from './address';
import { useBotsWorking } from './bots-count';
import { closePanel, togglePanel, useFrame, useWhere } from './frame';
import { MARKET_ITEM, isOuter, itemAt, itemHref, itemShown, menuShown, type MenuGate, type MenuGroup, type MenuItem, type MenuItemId } from './menu';
import { groupOpen, toggleGroup, useMenuChoice } from './menu-fold';
import { MenuIcon } from './menu-icons';
import { More } from './More';
import { usePoolKind } from './pool-kind';
import { setRailFolded, useRailFolded } from './rail-fold';
import { CITY_PATH, KIT_PATH, POOL_PATH, type View } from './shelves';
import { useDismiss } from './useDismiss';
import { MENU_WORDS, SHELL } from './words';
import s from './shell.module.css';

/**
 * The engine's doors an item waits for on this deployment: the money flows (the bridge stands where a move between
 * networks does) and the bots' engines, as their screens open (`terminal/bots/kinds.ts` `botDoors`).
 */
export const engineDoor = (gate: MenuGate): boolean => {
  if (gate === 'trader' || gate === 'ladder' || gate === 'pilot') return botDoors()[gate];
  if (gate === 'bridge') return flowLive('bridge') || flowLive('deposit');
  return flowLive(gate);
};

/** A desk between a phone and 1360 px: the rail stands on its icons by itself. */
const ICONS_DESK = '(min-width: 768px) and (max-width: 1359px)';

function subscribeDesk(change: () => void): () => void {
  const query = window.matchMedia(ICONS_DESK);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** Whether the rail stands on its icons: the person folded it, or the desk is narrow. */
function useRailIcons(): boolean {
  const folded = useRailFolded();
  const narrow = useSyncExternalStore(
    subscribeDesk,
    () => window.matchMedia(ICONS_DESK).matches,
    () => false,
  );
  return folded || narrow;
}

/** What the menu shows here, and the item the person is at. */
export function useMenu(): Readonly<{ view: View; groups: MenuGroup[]; marketOn: boolean; at: MenuItemId | null }> {
  const { view, pathname } = useWhere();
  const tail = useAddressTail();
  const groups = menuShown(view, engineDoor);
  const marketOn = itemShown(MARKET_ITEM, view, engineDoor);
  const poolKind = usePoolKind(pathname.startsWith(`${POOL_PATH}/`) ? (pathname.slice(POOL_PATH.length + 1).split('/')[0] ?? null) : null);
  return { view, groups, marketOn, at: itemAt(pathname, tail, groups, marketOn, poolKind) };
}

/**
 * A press on an item, before the router moves: an item for the top of the screen already in front (another tab of it,
 * its overview) brings the top into view, as a new screen would open. A press that opens a new tab or window changes
 * nothing here.
 */
export function handTo(item: MenuItem, view: View, event?: MouseEvent): void {
  if (isOuter(item) || view !== 'live') return;
  if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
  const path = item.href.split(/[?#]/)[0];
  if (!item.href.includes('#') && path === window.location.pathname) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * The rail: the mark, the Market, the menu's groups — each with its items, open by default and folded with the arrow by
 * its name (the browser remembers) — and at its foot «City», «More» and the button that folds the rail to its icons.
 * Folded (or on a desk narrower than 1360 px), each group is one icon, and its items open beside it. A long menu scrolls
 * inside the rail; the page never moves for it.
 */
export function Rail() {
  const { view, groups, marketOn, at } = useMenu();
  const w = useWords(SHELL);
  const names = useWords(MENU_WORDS);
  const home = view === 'preview' ? KIT_PATH : marketOn ? itemHref(MARKET_ITEM, view) : null;
  const moreOpen = useFrame((st) => st.panel === 'more');
  const folded = useRailFolded();
  const icons = useRailIcons();
  const moreWrap = useRef<HTMLDivElement>(null);
  useDismiss(moreOpen, moreWrap, () => closePanel('more'));
  const [fly, setFly] = useState<MenuGroup['id'] | null>(null);
  const { pathname } = useWhere();
  const tail = useAddressTail();
  // Another place, or the rail open again: the group's items beside it go — and with a window that changes its size.
  useEffect(() => setFly(null), [pathname, tail, icons]);
  useEffect(() => {
    if (!fly) return;
    const away = () => setFly(null);
    window.addEventListener('resize', away);
    return () => window.removeEventListener('resize', away);
  }, [fly]);
  const bots = useBotsWorking();
  return (
    <nav className={s.rail} data-terminal="rail" data-fly={fly ?? undefined} aria-label={w.sections}>
      {home ? (
        <Link className={s.brand} href={home} aria-label={w.home}>
          <Mark size={30} glow={false} />
          <b className={s.brandWord} aria-hidden="true">
            {BRAND.name}
          </b>
        </Link>
      ) : (
        <span className={s.brand} aria-label={w.home} role="img">
          <Mark size={30} glow={false} />
          <b className={s.brandWord} aria-hidden="true">
            {BRAND.name}
          </b>
        </span>
      )}
      {/* The rail hides to the side with the arrow at its edge, by the mark; its name says what a press does. */}
      <button type="button" className={`${s.iconBtn} ${s.railFold}`} data-terminal="rail-fold" title={folded ? w.railOpen : w.railFold} aria-label={folded ? w.railOpen : w.railFold} onClick={() => setRailFolded(!folded)}>
        <Icon name="chevron" size="s" />
      </button>
      <div className={s.railMenu} data-terminal="menu" onScroll={() => setFly(null)}>
        {marketOn ? (
          <Link className={s.nav} href={itemHref(MARKET_ITEM, view)} aria-current={at === 'market' ? 'page' : undefined} title={names.market}>
            <MenuIcon name="market" />
            <span className={s.quietName}>{names.market}</span>
          </Link>
        ) : null}
        {groups.map((group) => (
          <Group
            key={group.id}
            group={group}
            view={view}
            at={at}
            icons={icons}
            fly={fly === group.id}
            count={group.count === 'bots' ? bots : 0}
            onFly={(open) => setFly((now) => (open ? group.id : now === group.id ? null : now))}
          />
        ))}
      </div>
      <div className={s.railSep} />
      {/* The city is its own view: a page of its own, loaded whole. */}
      <a className={s.nav} href={CITY_PATH} title={w.city}>
        <Icon name="city" />
        <span className={s.quietName}>{w.city}</span>
      </a>
      <div className={s.railMore} ref={moreWrap}>
        <button type="button" className={s.nav} data-terminal="more" aria-expanded={moreOpen} aria-haspopup="dialog" title={w.more} onClick={() => togglePanel('more')}>
          <Icon name="more" />
          <span className={s.quietName}>{w.more}</span>
        </button>
        {moreOpen ? (
          <div className={`${s.pop} ${s.popUp}`} role="dialog" aria-label={w.more}>
            <More />
          </div>
        ) : null}
      </div>
    </nav>
  );
}

/** How long the pointer may leave a group and its items before they close; how long it rests before they open. */
const LEAVE_MS = 220;
const REST_MS = 90;
/** The items beside the rail keep this far from the window's top and foot. */
const EDGE = 12;

/**
 * One group: its name with the arrow that folds it, and its items. On the folded rail the name is the group's icon, and
 * a press — or the mouse resting on it — opens the items beside the rail, kept inside the window.
 */
function Group({
  group,
  view,
  at,
  icons,
  fly,
  count,
  onFly,
}: {
  group: MenuGroup;
  view: View;
  at: MenuItemId | null;
  icons: boolean;
  fly: boolean;
  count: number;
  onFly: (open: boolean) => void;
}) {
  const names = useWords(MENU_WORDS);
  const lang = useLang();
  const choice = useMenuChoice();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  // Opened by a resting mouse: the click that usually follows keeps it open rather than closing it.
  const byHover = useRef(false);
  const [top, setTop] = useState<number | null>(null);
  useDismiss(fly, box, () => onFly(false));
  const lit = group.items.some((item) => item.id === at);
  const open = groupOpen(group.id, lit, choice);
  const list = `menu-${group.id}`;
  const working = count > 0 ? names.working(digits(String(count), lang)) : null;

  // Beside the rail, level with the group's icon, and never past the window's foot.
  useLayoutEffect(() => {
    if (!fly || !icons) return setTop(null);
    const button = head.current?.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    if (!button) return;
    setTop(Math.max(EDGE, Math.min(button.top - 10, window.innerHeight - height - EDGE)));
  }, [fly, icons]);
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), []);

  const later = (open: boolean, ms: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      byHover.current = open;
      onFly(open);
    }, ms);
  };
  const mouse = (event: PointerEvent) => icons && event.pointerType === 'mouse';

  return (
    <div
      ref={box}
      className={s.group}
      data-group={group.id}
      data-lit={lit ? '' : undefined}
      data-open={fly ? '' : undefined}
      onPointerEnter={(event) => mouse(event) && later(true, REST_MS)}
      onPointerLeave={(event) => mouse(event) && later(false, LEAVE_MS)}
      onBlur={(event) => {
        // The keyboard went past the group's last item: its items close behind it.
        if (fly && !box.current?.contains(event.relatedTarget as Node | null)) onFly(false);
      }}
    >
      <button
        ref={head}
        type="button"
        className={s.gh}
        aria-expanded={icons ? fly : open}
        aria-controls={list}
        aria-label={[names[group.id], working].filter(Boolean).join(', ')}
        aria-current={icons && lit ? 'true' : undefined}
        onClick={() => {
          if (timer.current !== null) window.clearTimeout(timer.current);
          if (icons && fly && byHover.current) {
            byHover.current = false;
            return;
          }
          byHover.current = false;
          if (icons) onFly(!fly);
          else toggleGroup(group.id, lit);
        }}
      >
        <span className={s.ghIcon}>
          <MenuIcon name={`group-${group.id}`} />
          {count > 0 ? <i className={`${s.live} ${s.ghDot}`} aria-hidden="true" /> : null}
        </span>
        <span className={s.ghName}>{names[group.id]}</span>
        {count > 0 ? (
          <span className={s.run} aria-hidden="true">
            <i className={s.live} />
            {digits(String(count), lang)}
          </span>
        ) : null}
        <span className={s.ghArrow}>
          <Icon name="chevron" size="s" />
        </span>
      </button>
      <div className={s.items} id={list} style={top !== null ? { top } : undefined}>
        <div ref={panel} className={s.itemsIn} role="group" aria-label={names[group.id]}>
          <span className={s.flyHead} aria-hidden="true">
            {names[group.id]}
          </span>
          {group.items.map((item) => (
            <Item key={item.id} item={item} view={view} on={item.id === at} name={names[item.id]} elsewhere={names.elsewhere(names[item.id])} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Item({ item, view, on, name, elsewhere }: { item: MenuItem; view: View; on: boolean; name: string; elsewhere: string }) {
  if (isOuter(item)) {
    return (
      <a className={`${s.nav} ${s.item}`} href={item.out} target="_blank" rel="noopener noreferrer" aria-label={elsewhere} title={elsewhere}>
        <MenuIcon name={item.id} />
        <span className={s.itemName}>{name}</span>
        <span className={s.outMark}>
          <MenuIcon name="out" small />
        </span>
      </a>
    );
  }
  return (
    <Link className={`${s.nav} ${s.item}`} href={itemHref(item, view)} aria-current={on ? 'page' : undefined} title={name} onClick={(event) => handTo(item, view, event)}>
      <MenuIcon name={item.id} />
      <span className={s.itemName}>{name}</span>
    </Link>
  );
}
