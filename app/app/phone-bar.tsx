"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { ArrowLineDown, ArrowLineRight, ChartLineUp, ChartPieSlice, ClockCounterClockwise, House, List, Path, PlusCircle, Wallet } from "@phosphor-icons/react";
import { MONEY_ACTIONS, NAV_WORDS, PHONE_BAR, groupOf, type NavItemId, type PhoneBarPlace } from "@ryntra/core/nav";
import type { BottomBarMenu } from "@ryntra/core/ui";

import { MENU_SECTIONS, PHONE_PLACES as PLACE_ROW, type MenuSectionId } from "@/app/shell/domains";

const PLACE_ICON = { home: House, trading: ChartLineUp, money: Wallet, portfolio: ChartPieSlice, menu: List } as const;
const ACTION_ICON: Readonly<Partial<Record<NavItemId, typeof PlusCircle>>> = { deposit: PlusCircle, send: ArrowLineRight, receive: ArrowLineDown, bridge: Path };

/**
 * The phone's bottom bar of Menu 3: Головна · Торгівля · Гроші ·
 * Портфель · Меню — the core's `PHONE_BAR`. «Гроші» opens its four large actions — Поповнити · Надіслати · Отримати ·
 * Між мережами (the core's `MONEY_ACTIONS`) — and History under them, so sending or receiving is two presses from any
 * page; «Меню» opens the core's own sheet, the same Menu 3 as on a desk (`menu`). The core's `bottomBar` (A14; SOL-C11):
 * the core pins it below 1024 px, where it has no rail, and keeps a page's pinned action above it (UX-900).
 */
export function PhoneBar({ locale, row, onNavigate, menu }: { locale: "en" | "uk"; row: MenuSectionId | null; onNavigate: (href: string) => void; menu: BottomBarMenu }) {
  const words = NAV_WORDS[locale];
  const [money, setMoney] = useState(false);
  const sheetId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const moneyButton = useRef<HTMLButtonElement>(null);
  const close = useCallback((focusBack: boolean) => {
    setMoney(false);
    if (focusBack) moneyButton.current?.focus();
  }, []);

  useEffect(() => {
    if (!money) return;
    sheet.current?.querySelector<HTMLElement>("a[href]")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!sheet.current?.contains(target) && !moneyButton.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", keys);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", keys);
      document.removeEventListener("pointerdown", outside);
    };
  }, [money, close]);

  const current = (place: PhoneBarPlace) => {
    if (!row) return false;
    /* A row of Автоматика or Заробіток lives in «Меню». */
    if (place === "menu") return groupOf(row) === "automation" || groupOf(row) === "earning";
    if (place === "trading" || place === "money") return groupOf(row) === place && !(place === "money" && row === "portfolio");
    return PLACE_ROW[place] === row;
  };

  const go = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMoney(false);
    onNavigate(href);
  };

  return (
    <nav className="sol-phonebar" aria-label={locale === "uk" ? "Швидкі місця" : "Quick places"}>
      {money ? (
        <div
          className="sol-phonebar-sheet"
          id={sheetId}
          ref={sheet}
          role="dialog"
          aria-label={words.groups.money}
          /* The focus leaving the sheet (Tab past its last action) closes it, so it never stays open behind the bar. */
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && !sheet.current?.contains(next) && !moneyButton.current?.contains(next)) close(false);
          }}
        >
          <ul className="sol-phonebar-actions" role="list">
            {MONEY_ACTIONS.map((id) => {
              const Icon = ACTION_ICON[id] ?? Wallet;
              const href = MENU_SECTIONS[id as MenuSectionId].href;
              return (
                <li key={id}>
                  <Link className="sol-phonebar-action" href={href} prefetch={false} onClick={go(href)} aria-current={row === id ? "page" : undefined}>
                    <Icon size={24} weight="bold" aria-hidden="true" />
                    <span>{words.items[id]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link className="sol-phonebar-history" href={MENU_SECTIONS.history.href} prefetch={false} onClick={go(MENU_SECTIONS.history.href)} aria-current={row === "history" ? "page" : undefined}>
            <ClockCounterClockwise size={18} weight="bold" aria-hidden="true" />
            <span>{words.items.history}</span>
          </Link>
        </div>
      ) : null}
      <ul className="sol-phonebar-places" role="list">
        {PHONE_BAR.map((place) => {
          const Icon = PLACE_ICON[place];
          const label = place === "trading" || place === "money" ? words.groups[place] : place === "menu" ? words.menu : words.items[place];
          if (place === "money") {
            return (
              <li key={place}>
                <button
                  type="button"
                  ref={moneyButton}
                  className="sol-phonebar-place"
                  aria-expanded={money}
                  aria-controls={money ? sheetId : undefined}
                  data-current={current(place) || undefined}
                  onClick={() => setMoney((open) => !open)}
                >
                  <Icon size={22} weight="bold" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              </li>
            );
          }
          if (place === "menu") {
            return (
              <li key={place}>
                <button
                  type="button"
                  className="sol-phonebar-place"
                  aria-haspopup="dialog"
                  aria-expanded={menu.open}
                  aria-controls={menu.controls}
                  data-current={current(place) || undefined}
                  onClick={() => {
                    setMoney(false);
                    menu.onOpen();
                  }}
                >
                  <Icon size={22} weight="bold" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              </li>
            );
          }
          const href = MENU_SECTIONS[PLACE_ROW[place]].href;
          return (
            <li key={place}>
              <Link className="sol-phonebar-place" href={href} prefetch={false} onClick={go(href)} aria-current={current(place) ? "page" : undefined}>
                <Icon size={22} weight="bold" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
