"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CaretDown,
  EnvelopeSimple,
  Globe,
  List,
  X,
  XLogo,
} from "@phosphor-icons/react";

import { track } from "@/lib/analytics";
import { RyntraBrand } from "@/app/brand/ryntra-brand";
import { PUBLIC_LOCALES } from "@/app/i18n";
import type { Lang } from "@/app/config/features";

/*
 * The chrome brings its own stylesheet.
 *
 * `.lp-header`, `.lp-nav`, `.lp-skip-link` and the footer rules live in the
 * landing stylesheet, which only the landing used to import. Sharing the markup
 * without the styles is how methodology first rendered this header unstyled —
 * wordmark and links stacked in the corner, the skip link permanently visible.
 * Importing it here means any page that mounts the chrome gets the chrome,
 * whole, and cannot forget half of it.
 */
import "@/app/landing/landing.css";
import { CONTACTS } from "@/lib/site/contacts";

/**
 * The site header and footer, shared by every public page.
 *
 * They used to be written twice: the landing had a wordmark, four section
 * links, a beta button and a full footer, while methodology had a boxed "R"
 * logo, a different four links and a footer of its own. Two chromes on one
 * domain read as two products, and the second one always drifts — the version a
 * visitor met first stopped matching the one they landed on next.
 *
 * So the chrome lives here and the pages supply only what genuinely differs:
 * the link targets. On the landing those are in-page anchors; on methodology
 * they point back at the landing's sections. Everything else — the wordmark,
 * the beta call to action, the mobile sheet, the locale control, the legal row
 * — is one implementation.
 */

/* The retired public Telegram channel used to sit here beside X and the
   address. This chrome serves `/[lang]`, which is parked rather than deleted —
   `PUBLIC_LOCALE_CODES` is `["en"]`, so every sub-locale currently redirects to
   `/` and nothing here renders. Cleaned anyway: unparking a locale should not
   be the act that republishes a channel the founder retired. The identities
   come from the one module now. */
const X_URL = CONTACTS.companyX;
const EMAIL = CONTACTS.email;

export type ChromeLink = { href: string; label: string };

function Wordmark() {
  return <RyntraBrand size={22} />;
}

export function SiteHeader({
  lang,
  homeHref,
  betaHref,
  nav,
  labels,
  /** Marks the current page in the nav, e.g. the methodology link on /methodology. */
  activeHref,
  /** Analytics placement suffix, so header CTAs from different pages stay separable. */
  page,
}: {
  lang: Lang;
  homeHref: string;
  betaHref: string;
  nav: readonly ChromeLink[];
  labels: { beta: string; primary: string; menu: string; language: string; skip: string };
  activeHref?: string;
  page: string;
}) {
  const router = useRouter();
  const langRef = useRef<HTMLDivElement>(null);
  const langTriggerRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [langOpen, setLangOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLabel = nav.map((item) => item.label).join(" / ");

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (langRef.current && !langRef.current.contains(event.target as Node)) {
        setLangOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setLangOpen((open) => {
        if (open) langTriggerRef.current?.focus();
        return false;
      });
      setMobileOpen((open) => {
        if (open) menuButtonRef.current?.focus();
        return false;
      });
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function switchLang(nextLang: Lang) {
    setLangOpen(false);
    setMobileOpen(false);
    router.push(nextLang === "en" ? "/" : `/${nextLang}`);
  }

  return (
    <>
      <a className="lp-skip-link" href="#main-content">
        {labels.skip}
      </a>

      <header className="header lp-header">
        <div className="container lp-header-inner">
          <a href={homeHref} className="lp-logo-link">
            <Wordmark />
          </a>

          <nav className="nav lp-nav" aria-label={navLabel}>
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={item.href === activeHref ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="header-right">
            {/* The language control renders only while more than one locale is
                public. With the list narrowed to English it disappears rather
                than sitting there as a menu with a single entry — and it comes
                back on its own the moment a locale is unparked. */}
            {PUBLIC_LOCALES.length > 1 ? (
              <div className="lp-desktop-controls">
                <div className="lang-menu" ref={langRef}>
                  <button
                    ref={langTriggerRef}
                    className="lang-trigger"
                    type="button"
                    onClick={() => setLangOpen((open) => !open)}
                    aria-expanded={langOpen}
                    aria-controls="lp-lang-popover"
                    aria-label={labels.language}
                  >
                    <Globe size={17} weight="bold" aria-hidden />
                    {PUBLIC_LOCALES.find((item) => item.code === lang)?.shortLabel ?? "EN"}
                    <CaretDown size={13} weight="bold" aria-hidden />
                  </button>
                  {langOpen ? (
                    <div className="lang-popover" id="lp-lang-popover" aria-label={labels.language}>
                      {PUBLIC_LOCALES.map((locale) => (
                        <button
                          key={locale.code}
                          type="button"
                          lang={locale.code}
                          aria-label={locale.label}
                          aria-current={locale.code === lang ? "true" : undefined}
                          className={locale.code === lang ? "active" : ""}
                          onClick={() => switchLang(locale.code as Lang)}
                        >
                          {locale.shortLabel}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <a
              href={betaHref}
              className="btn btn-primary btn-sm lp-header-cta"
              onClick={() => track("telegram_cta_click", `header-${page}`, lang)}
            >
              {labels.beta}
              <ArrowUpRight size={15} weight="bold" aria-hidden />
            </a>

            <button
              ref={menuButtonRef}
              type="button"
              className="icon-btn lp-menu-button"
              aria-label={labels.menu}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? (
                <X size={20} weight="bold" aria-hidden />
              ) : (
                <List size={20} weight="bold" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="lp-mobile-menu" id="mobile-menu">
            <nav aria-label={navLabel}>
              {nav.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMobileOpen(false)}>
                  {item.label}
                </a>
              ))}
            </nav>
            <a
              href={betaHref}
              className="btn btn-primary lp-mobile-cta"
              onClick={() => track("telegram_cta_click", `mobile-menu-${page}`, lang)}
            >
              {labels.primary}
              <ArrowUpRight size={17} weight="bold" aria-hidden />
            </a>

            {PUBLIC_LOCALES.length > 1 ? (
              <div className="lp-mobile-settings">
                <div>
                  <span>{labels.language}</span>
                  <div className="lp-mobile-languages">
                    {PUBLIC_LOCALES.map((locale) => (
                      <button
                        type="button"
                        key={locale.code}
                        aria-label={locale.label}
                        lang={locale.code}
                        className={locale.code === lang ? "active" : ""}
                        aria-pressed={locale.code === lang}
                        onClick={() => switchLang(locale.code as Lang)}
                      >
                        <span aria-hidden="true" dir="ltr">{locale.shortLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
    </>
  );
}

export function SiteFooter({
  tagline,
  fineAdvice,
  boundary,
  terms,
  privacy,
  /** Optional extra link, e.g. the methodology correction address. */
  extra,
}: {
  tagline: string;
  fineAdvice: string;
  boundary: string;
  terms: string;
  privacy: string;
  extra?: ChromeLink;
}) {
  return (
    <footer className="footer lp-footer">
      <div className="container">
        <div className="lp-footer-main">
          <div>
            <Wordmark />
            <p>{tagline}</p>
          </div>
          <div className="footer-social">
            <a className="icon-btn" href={X_URL} target="_blank" rel="noreferrer" aria-label="X">
              <XLogo size={18} weight="bold" aria-hidden />
            </a>
            <a className="icon-btn" href={`mailto:${EMAIL}`} aria-label="Email">
              <EnvelopeSimple size={18} weight="bold" aria-hidden />
            </a>
          </div>
        </div>
        <div className="lp-footer-legal">
          <div>
            <p>{fineAdvice}</p>
            <p>{boundary}</p>
          </div>
          <div>
            <Link href="/legal/terms">{terms}</Link>
            <Link href="/legal/privacy">{privacy}</Link>
            {extra ? <a href={extra.href}>{extra.label}</a> : null}
            <span suppressHydrationWarning>© {new Date().getFullYear()} Ryntra</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
