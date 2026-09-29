"use client";

/**
 * The phone's primary navigation, which did not exist before this file.
 *
 * The shell rendered the *identical* rail on a phone and hid it behind a
 * drawer — `hidden={mobile && !drawer}` — so every destination cost a tap to
 * open the drawer, a read, a tap to choose, and the drawer closing over the
 * thing you came to see. On a money product that is the difference between
 * checking a balance and deciding not to bother.
 *
 * **Головна · Ринки · Ryntra · Портфель · Ще** (canon v5.3 В28, v5.4 В30).
 * Four places and one opener: the four a person reaches for stay in the bar,
 * and «Ще» opens the menu's sections — the same list, with the same captions,
 * a desk shows on its rail.
 *
 * «Ще» is a button rather than a link on purpose. It opens the rail itself,
 * driven by the shell's one drawer state, so the bar and the menu cannot
 * disagree about whether the menu is showing; a sixth *route* here would be a
 * second navigation system, which is the one thing this bar must not become.
 *
 * The bar is not a second navigation list either. It renders entries projected
 * from the same registry as the rail, in the same order, so there is no second
 * array to forget to update.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import type { MobileNavEntry } from "./domains";

export function ProductMobileNav({
  entries,
  activeHref,
  label,
  icons,
  moreLabel,
  moreOpen,
  onMore,
  onNavigate,
}: {
  entries: readonly MobileNavEntry[];
  /** The single active destination the shell has already resolved. */
  activeHref: string | null;
  label: string;
  icons: Readonly<Record<string, ReactNode>>;
  /** The accessible name of the opener, which the shell already translates. */
  moreLabel: string;
  moreOpen: boolean;
  onMore: () => void;
  /**
   * A place was pressed. The menu «Ще» opened stands above the page, and a
   * press on the place the person is already on changes no route, so the
   * shell is told to close it rather than waiting for a navigation.
   */
  onNavigate?: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <nav className="rs-mobilenav" aria-label={label}>
      <ul className="rs-mobilenav-list">
        {entries.map((entry) => {
          const icon = (
            <span className="rs-mobilenav-icon" aria-hidden>
              {icons[entry.icon] ?? null}
            </span>
          );
          const text = <span className="rs-mobilenav-label">{entry.label}</span>;

          /* The opener. It carries no `aria-current`, because a drawer is not a
             place a person is; it says whether it is expanded instead. In
             «Простий» it is lit on the pages it holds, so a person on Send can
             see that Send lives in «Ще». */
          if (entry.href === null) {
            const holdsCurrent = activeHref !== null && entry.matches.includes(activeHref);
            return (
              <li key={entry.id} className="rs-mobilenav-item">
                <button
                  type="button"
                  className="rs-mobilenav-link"
                  data-active={moreOpen || holdsCurrent ? "true" : "false"}
                  aria-expanded={moreOpen}
                  aria-controls="workspace-navigation"
                  aria-label={moreOpen ? undefined : moreLabel}
                  onClick={onMore}
                >
                  {icon}
                  {text}
                </button>
              </li>
            );
          }

          /* Against the landing hrefs the column stands for, resolved by the
             registry — usually its own, and both of Money's, because that
             column is a group of two pages drawn as one. Never a prefix match,
             which would light more than one column at a time. */
          const current = activeHref !== null && entry.matches.includes(activeHref);
          return (
            <li key={entry.id} className="rs-mobilenav-item">
              <Link
                href={entry.href}
                className="rs-mobilenav-link"
                data-active={current && !moreOpen ? "true" : "false"}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
              >
                {icon}
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
