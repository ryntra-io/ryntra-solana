"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check, Globe, List, Moon, Sun, X } from "@phosphor-icons/react";

import { applyThemePref, readResolvedTheme, watchResolvedTheme, type ThemePref } from "@/app/app/theme";
import { siteMenu, type SiteMenu } from "@/lib/site/homepage-copy";
import {
  PUBLIC_LANGUAGES,
  landingHref,
  publicLanguage,
  readPublicLocaleClient,
  writePublicLocaleCookie,
  type PublicLocale,
} from "@/lib/site/locale";
import { languageSwitchHref, pagePath } from "@/lib/site/localized";
import { publicCopy, type PublicCopy } from "@/lib/site/public-copy";

import styles from "./chrome.module.css";

/**
 * The one public header.
 *
 * Locale follows the Hub cookie so a language chosen here is the language a
 * workspace opens in. Theme follows `app/app/theme.ts` — one writer.
 *
 * One menu (Owner, 2026-09-14): the landing's five ways in across the middle
 * of the bar and one *Open Ryntra* on the right — on the landing, on the
 * documentation, on every public page — in place of the Product ·
 * Documentation pair the other pages used to carry. The words come from the
 * landing's copy in the reader's language. The language and theme switches
 * stand beside the button on every page but the landing, which is English
 * and dark by the Owner's decision of 2026-09-13; the language switch is a
 * menu of every public language, since more are coming than a pair can show.
 */
export function PublicHeader({
  mainId = "main",
  locale: localeProp,
  controls = true,
  landing = false,
  ctaTone = "primary",
  languageHrefs,
  homeHref,
}: {
  mainId?: string;
  locale?: PublicLocale;
  /** The locale and theme switches. The landing shows neither: it is English
   *  and dark, by the Owner's decision of 2026-09-13. */
  controls?: boolean;
  /** The landing's look: the bar lets the ground through and the menu is
   *  drawn in the landing's mist rather than the theme's ink. */
  landing?: boolean;
  /**
   * *Open the app* in the brand's orange, or quiet where the page below has
   * its own one orange action — the landing's «Відкрити застосунок», the reviewer
   * page's *Verify a receipt* — so a screen never shows two (canon v5.0 §2,
   * rule 1; RYN-FIRST-SCREEN-001).
   */
  ctaTone?: "primary" | "quiet";
  /**
   * Where each language lives, when the page names it — the landing, `/` and
   * `/uk` (plan of `RYN-SITE-V5-001` §4). Every page offered to the index has
   * the same pair without naming it (`/docs` and `/uk/docs`,
   * `lib/site/localized.ts`); choosing a language goes to that address, the
   * cookie written on the way. A page with one address for both asks the
   * server for it again in the cookie's language.
   */
  languageHrefs?: Readonly<Record<PublicLocale, string>>;
  /** Where the wordmark leads: the landing in the page's language by default. */
  homeHref?: string;
}) {
  const pathname = usePathname() ?? "/";
  const [locale, setLocale] = useState<PublicLocale>(localeProp ?? "en");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (localeProp) {
      writePublicLocaleCookie(localeProp);
      setLocale(localeProp);
      return;
    }
    setLocale(readPublicLocaleClient());
  }, [localeProp]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
  }, [locale]);

  const copy = publicCopy(locale);
  const menu = siteMenu(locale);
  const quiet = ctaTone === "quiet" ? ` ${styles.openAppQuiet}` : "";
  const home = homeHref ?? landingHref(locale);

  return (
    <header className={`${styles.nav} ${landing ? styles.navLanding : styles.navSite}`} onKeyDown={(event) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <a className={styles.skip} href={`#${mainId}`}>
        {copy.skip}
      </a>
      <div className={`${styles.wrap} ${styles.navInner}`}>
        <Link className={styles.brand} href={home}>
          <img
            src="/brand/ryntra-wordmark-dark.svg"
            alt=""
            width={118}
            height={30}
            className={`${styles.brandLogo} ${styles.logoDark}`}
          />
          <img
            src="/brand/ryntra-wordmark-light.svg"
            alt=""
            width={118}
            height={30}
            className={`${styles.brandLogo} ${styles.logoLight}`}
          />
          <span className={styles.srOnly}>{copy.brandHome}</span>
        </Link>

        <nav className={`${styles.navLinks} ${styles.navDesktop} ${styles.menuLinks}`} aria-label={menu.nav}>
          <MenuLinks menu={menu} pathname={pathname} />
        </nav>
        <div className={`${styles.navTools} ${styles.navDesktop}`}>
          {controls ? <LocaleMenu locale={locale} copy={copy} onChange={setLocale} hrefs={languageHrefs} /> : null}
          {controls ? <ThemeControl copy={copy} /> : null}
          <Link className={`${styles.openApp}${quiet}`} href={menu.open.href} prefetch={false}>
            {menu.open.label}
          </Link>
        </div>

        {/* The narrow bar holds what the page has beside the menu button: the
            landing its button, every other page its two switches — the button
            then stands at the foot of the sheet. */}
        <div className={styles.navMobileTools}>
          {controls ? (
            <>
              <LocaleMenu locale={locale} copy={copy} onChange={setLocale} hrefs={languageHrefs} />
              <ThemeControl copy={copy} />
            </>
          ) : (
            <Link className={`${styles.openApp} ${styles.openAppBar}${quiet}`} href={menu.open.href} prefetch={false}>
              {menu.open.label}
            </Link>
          )}
          <button
            ref={menuButton}
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={20} aria-hidden /> : <List size={20} aria-hidden />}
            <span className={styles.srOnly}>{menuOpen ? copy.menuClose : copy.menuOpen}</span>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className={styles.mobileSheet} id={menuId}>
          <div className={styles.wrap}>
            <nav className={styles.mobileNav} aria-label={menu.nav}>
              <MenuLinks menu={menu} pathname={pathname} stacked />
              {controls ? (
                <Link className={`${styles.openApp} ${styles.openAppSheet}${quiet}`} href={menu.open.href} prefetch={false}>
                  {menu.open.label}
                </Link>
              ) : null}
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}

/** The documentation link is current on every documentation page; the product
 *  links on their exact page — at either language's address. */
function isCurrent(pathname: string, href: string): boolean {
  const page = pagePath(pathname);
  const path = pagePath(href.split("?")[0]);
  return page === path || (path === "/docs" && page.startsWith("/docs/"));
}

function MenuLinks({ menu, pathname, stacked = false }: { menu: SiteMenu; pathname: string; stacked?: boolean }) {
  const className = stacked ? styles.mobileLink : styles.navLink;
  return (
    <>
      {menu.links.map((item) => (
        <Link
          key={item.href}
          className={className}
          href={item.href}
          prefetch={false}
          aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

/**
 * The language menu: the current language's code on the bar, every public
 * language by its own name in the list. Outside pointer, Escape and leaving
 * by keyboard close it; the arrows walk it; choosing writes the cookie, tells
 * the page in place and asks the server for the page in that language — or,
 * where each language has its own address (`hrefs`, the landing), goes there.
 */
function LocaleMenu({
  locale,
  copy,
  onChange,
  hrefs,
}: {
  locale: PublicLocale;
  copy: PublicCopy;
  onChange: (next: PublicLocale) => void;
  hrefs?: Readonly<Record<PublicLocale, string>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const current = publicLanguage(locale);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const items = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
  const focusItem = (index: number) => {
    const list = items();
    if (list.length) list[(index + list.length) % list.length]?.focus();
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const choose = (next: PublicLocale) => {
    close(true);
    if (next === locale) return;
    writePublicLocaleCookie(next);
    /* A page with an address in each language goes to the chosen one's —
       `/docs` and `/uk/docs`, the landing's `/` and `/uk`; a page with one
       address for both is asked for again in the cookie's language. */
    const here = window.location.pathname + window.location.search;
    const target = hrefs?.[next] ?? languageSwitchHref(window.location.pathname, window.location.search, next);
    if (target && target !== here) {
      router.push(target);
      return;
    }
    onChange(next);
    window.dispatchEvent(new CustomEvent<PublicLocale>("ryntra:public-locale", { detail: next }));
    router.refresh();
  };

  return (
    <div
      className={styles.langMenu}
      ref={root}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close(true);
          return;
        }
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() => focusItem(event.key === "ArrowDown" ? 0 : -1));
            return;
          }
          focusItem(at < 0 ? (event.key === "ArrowDown" ? 0 : -1) : at + (event.key === "ArrowDown" ? 1 : -1));
        } else if (open && event.key === "Home") {
          event.preventDefault();
          focusItem(0);
        } else if (open && event.key === "End") {
          event.preventDefault();
          focusItem(-1);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.langButton}
        aria-label={`${copy.langSwitch}: ${current.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <Globe size={16} weight="bold" aria-hidden />
        <span className={styles.langCode}>{current.code}</span>
        <CaretDown size={12} weight="bold" aria-hidden className={styles.langCaret} />
      </button>
      {open ? (
        <div
          className={styles.langList}
          id={listId}
          role="menu"
          aria-label={copy.langSwitch}
          /* A press on an item must not move focus off the trigger before the
             click lands, or the blur above would close the list under it. */
          onMouseDown={(event) => event.preventDefault()}
        >
          {PUBLIC_LANGUAGES.map((language) => {
            const selected = language.locale === locale;
            return (
              <button
                key={language.locale}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                lang={language.locale}
                className={styles.langItem}
                onClick={() => choose(language.locale)}
              >
                <span className={styles.langItemCode}>{language.code}</span>
                <span className={styles.langItemName}>{language.name}</span>
                {selected ? <Check size={14} weight="bold" aria-hidden className={styles.langCheck} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ThemeControl({ copy }: { copy: PublicCopy }) {
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => watchResolvedTheme(setPref), []);

  const current = pref ?? "dark";
  const next: ThemePref = current === "dark" ? "light" : "dark";
  const Icon = next === "light" ? Sun : Moon;
  const label = next === "light" ? copy.themeLight : copy.themeDark;

  return (
    <button
      type="button"
      className={styles.themeToggle}
      aria-label={`${copy.themeSwitch}: ${label}`}
      disabled={pref === null}
      onClick={() => {
        const next: ThemePref = readResolvedTheme() === "dark" ? "light" : "dark";
        applyThemePref(next);
        setPref(next);
      }}
    >
      <Icon size={16} weight="bold" aria-hidden />
      <span className={styles.themeLabel}>{label}</span>
    </button>
  );
}

export { PublicFooter } from "./public-footer";
