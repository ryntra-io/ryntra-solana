"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowSquareOut,
  ArrowUpRight,
  CaretDown,
  List,
  X,
  XLogo,
} from "@phosphor-icons/react";

import { track } from "@/lib/analytics";
import { SiteMotion } from "./motion";
import { Wordmark } from "./wordmark";
import {
  BETA_CTA_LABEL,
  BETA_HREF,
  FOOTER_GROUPS,
  PRIMARY_NAV,
  PRODUCT_NAV_GROUPS,
  PRODUCT_PATH_PREFIXES,
  WORKSPACES_CTA_LABEL,
  WORKSPACES_HREF,
  type ProductNavItem,
} from "./nav";

/*
 * The chrome brings the design system with it.
 *
 * Every page on the redesigned site mounts this header and this footer, so
 * importing the stylesheet here means a new route cannot ship half-styled by
 * forgetting one line — which is exactly how the previous methodology page
 * first rendered its header unstyled.
 */
import "./site.css";
/* The legacy module plate. It used to be imported by `parts.tsx`, which put it
   on every migrated page too — where its `.rx-head` grid beat the frozen flex
   one. It belongs with the legacy chrome: exactly the pages that still want it. */
import "./module.css";
import { CONTACTS } from "@/lib/site/contacts";

/**
 * The header and footer for the public site.
 *
 * The version this replaces was a full internal taxonomy rendered twice: five
 * header categories over twenty destinations, then the same twenty repeated in
 * a four-column footer that managed to list `Capability status` and `Security`
 * twice inside itself. Every link had equal weight, so none had any. A visitor
 * could not tell the product from the documentation from the proof artifacts.
 *
 * What is here now: one Workspaces disclosure, two direct links, one action,
 * three footer columns and one legal row. Three decisions worth naming.
 *
 * First, the disclosure is called Workspaces and leads with the doors: the
 * four open workspaces link straight to their workspace routes, the cabinet
 * carries the one honest Beta chip, and the explaining pages come last. The
 * previous "Products" version mixed abstractions with places and never linked
 * the Workspace Map at all, which is how "how do I get into a workspace"
 * became a three-hop guess.
 *
 * Second, there is one primary action and it matches reality: **Open a
 * workspace**, to the map of what opens with no account. `Request beta
 * access` was the header action while beta gated only the cabinet — the
 * loudest button on the site gating its smallest part. Beta keeps the
 * homepage story, the cabinet menu row and the mobile sheet's second button.
 *
 * Third, the mobile sheet exposes the product hierarchy in reading order. No
 * accordions and no hover: opening the sheet is the only reveal interaction.
 */

/* The retired public Telegram channel is gone from here too. This chrome is
   parked rather than deleted, which is exactly why: a surface that can be
   revived carries whatever was left in it. */
const X_URL = CONTACTS.companyX;

/**
 * Whether a nav entry owns the current path.
 *
 * `/` matches only itself — a prefix rule would mark the homepage on every
 * route. Everything else matches its own subtree, so `/docs/faq` marks `Docs`
 * rather than leaving the header blank on the pages a reviewer is sent to most.
 */
function isCurrent(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isProductCurrent(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/") return true;
  return PRODUCT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function ProductDestination({
  item,
  pathname,
  onNavigate,
  mobile = false,
}: {
  item: ProductNavItem;
  pathname: string | null;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const content = (
    <>
      <span className="rx-product-name">
        <span>{item.label}</span>
        {item.stateLabel ? (
          <span className="rx-product-state" data-state={item.state}>
            {item.stateLabel}
          </span>
        ) : null}
      </span>
      <span className="rx-product-note">{item.note}</span>
    </>
  );

  if (!item.href) {
    return (
      <div
        className={mobile ? "rx-sheet-product" : "rx-product-destination"}
        data-disabled="true"
        aria-disabled="true"
      >
        {content}
      </div>
    );
  }

  const current = isCurrent(item.href, pathname);
  return (
    <Link
      className={mobile ? "rx-sheet-product" : "rx-product-destination"}
      href={item.href}
      data-current={current || undefined}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}

export function SiteHeader({
  page,
  /**
   * The id the skip link jumps to. Pages built in this system use `main`;
   * `/methodology` keeps `main-content`, the id its own anchors and tests have
   * always used, and a skip link pointing at an id the page does not mount is
   * the single most common way this control quietly stops working.
   */
  mainId = "main",
}: {
  page: string;
  mainId?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const productsRef = useRef<HTMLDivElement>(null);
  const productsTriggerRef = useRef<HTMLButtonElement>(null);
  /*
   * The active item comes from the URL, not from the `page` prop.
   *
   * The prop is an analytics placement — the homepage passes `home` while the
   * nav entry is `product`, so matching on it left the homepage with nothing
   * marked. Deriving it from the path also gets the deep routes right for free:
   * `/docs/faq` and `/docs/roadmap` mark `Docs`, which a hand-maintained map would
   * have had to be told about one route at a time.
   */
  const pathname = usePathname();
  const onBeta = pathname === BETA_HREF;
  const onMap = pathname === WORKSPACES_HREF;
  const productsCurrent = isProductCurrent(pathname);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (productsRef.current && !productsRef.current.contains(event.target as Node)) {
        setProductsOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setProductsOpen((open) => {
        if (open) productsTriggerRef.current?.focus();
        return false;
      });
      setSheetOpen((open) => {
        if (open) burgerRef.current?.focus();
        return false;
      });
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      {/* Mounted with the chrome so every page in this system gets the same
          reveals, pointer and progress rail without remembering to ask. */}
      <SiteMotion />

      <a className="rx-skip" href={`#${mainId}`}>
        Skip to content
      </a>

      <header className="rx-header">
        <div className="rx-shell rx-header-inner">
          <Link href="/" aria-label="Ryntra — home">
            <Wordmark />
          </Link>

          <nav className="rx-nav" aria-label="Primary">
            <div
              className="rx-products"
              ref={productsRef}
              onBlur={(event) => {
                if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
                  setProductsOpen(false);
                }
              }}
            >
              <button
                ref={productsTriggerRef}
                type="button"
                className="rx-navlink rx-navtrigger"
                data-current={productsCurrent || undefined}
                data-open={productsOpen || undefined}
                aria-expanded={productsOpen}
                aria-controls="rx-products-popover"
                onClick={() => setProductsOpen((open) => !open)}
              >
                Workspaces
                <CaretDown size={13} weight="bold" aria-hidden />
              </button>

              {productsOpen ? (
                <div className="rx-products-popover" id="rx-products-popover" aria-label="Workspaces">
                  {PRODUCT_NAV_GROUPS.map((group) => (
                    <section className="rx-product-group" key={group.id} aria-labelledby={`rx-product-${group.id}`}>
                      <h2 id={`rx-product-${group.id}`}>{group.label}</h2>
                      <div className="rx-product-list">
                        {group.items.map((item) => (
                          <ProductDestination
                            key={item.id}
                            item={item}
                            pathname={pathname}
                            onNavigate={() => setProductsOpen(false)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>

            {PRIMARY_NAV.map((item) => {
              /* `aria-current` and the underline come from the same value, so a
                 page can never look active without announcing it. */
              const current = isCurrent(item.href, pathname);
              return (
                <Link
                  key={item.id}
                  className="rx-navlink"
                  href={item.href}
                  data-current={current || undefined}
                  aria-current={current ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="rx-header-cta">
            {/* The one place the action is withheld: on `/workspaces` itself it
                would point at the page the visitor is already reading. A button
                that goes nowhere is read as a broken control, and the page
                below is the action. */}
            {onMap ? null : (
              <a
                className="rx-btn rx-btn--primary rx-btn--sm"
                href={WORKSPACES_HREF}
                onClick={() => track("workspace_cta_click", `header-${page}`, "en")}
              >
                {WORKSPACES_CTA_LABEL}
                <ArrowUpRight size={14} weight="bold" aria-hidden />
              </a>
            )}
            <button
              ref={burgerRef}
              type="button"
              className="rx-burger"
              aria-label={sheetOpen ? "Close menu" : "Open menu"}
              aria-expanded={sheetOpen}
              aria-controls="rx-sheet"
              onClick={() => setSheetOpen((open) => !open)}
            >
              {sheetOpen ? <X size={18} weight="bold" aria-hidden /> : <List size={18} weight="bold" aria-hidden />}
            </button>
          </div>
        </div>

        {/* One reveal, then the complete hierarchy in reading order. */}
        <div className="rx-sheet" id="rx-sheet" data-open={sheetOpen}>
          <nav className="rx-sheet-nav" aria-label="Primary — mobile">
            <div className="rx-sheet-products" aria-labelledby="rx-sheet-products-label">
              <h2 id="rx-sheet-products-label">Workspaces</h2>
              {PRODUCT_NAV_GROUPS.map((group) => (
                <section className="rx-sheet-product-group" key={group.id} aria-labelledby={`rx-sheet-${group.id}`}>
                  <h3 id={`rx-sheet-${group.id}`}>{group.label}</h3>
                  <div>
                    {group.items.map((item) => (
                      <ProductDestination
                        key={item.id}
                        item={item}
                        pathname={pathname}
                        mobile
                        onNavigate={() => setSheetOpen(false)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                data-current={isCurrent(item.href, pathname) || undefined}
                aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
                onClick={() => setSheetOpen(false)}
              >
                {item.label}
                {item.note ? <span>{item.note}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="rx-sheet-actions">
            {onMap ? null : (
              <a
                className="rx-btn rx-btn--primary"
                href={WORKSPACES_HREF}
                onClick={() => {
                  setSheetOpen(false);
                  track("workspace_cta_click", `sheet-${page}`, "en");
                }}
              >
                {WORKSPACES_CTA_LABEL}
                <ArrowUpRight size={15} weight="bold" aria-hidden />
              </a>
            )}
            {/* Beta keeps an honest second place here: full-width sheets have
                room for two truths — the doors that are open, and the cabinet
                that needs one Telegram confirmation. */}
            {onBeta ? null : (
              <a
                className="rx-btn rx-btn--ghost"
                href={BETA_HREF}
                onClick={() => {
                  setSheetOpen(false);
                  track("telegram_cta_click", `sheet-${page}`, "en");
                }}
              >
                {BETA_CTA_LABEL}
              </a>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="rx-footer">
      <div className="rx-shell">
        <div className="rx-footer-grid">
          <div className="rx-footer-brand">
            <Wordmark />
            <p className="rx-fine">
              Risk, Strategy &amp; Evidence OS for programmable assets. One Evidence Kernel, two product
              surfaces.
            </p>
            {/* The two social destinations, and only those. An email icon sat
                here too, which made `mailto:hello@ryntra.io` the one duplicated
                link in a footer whose whole point was to stop repeating itself.
                Contact lives in the Company column, where a reader looks for
                it. */}
            <div className="rx-footer-social">
              <a href={X_URL} target="_blank" rel="noreferrer" aria-label="X">
                <XLogo size={16} weight="bold" aria-hidden />
              </a>
            </div>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <div className="rx-footer-col" key={group.id}>
              <h3>{group.label}</h3>
              {group.items.map((item) =>
                item.external ? (
                  <a
                    key={item.href + item.label}
                    href={item.href}
                    target={item.href.startsWith("mailto:") ? undefined : "_blank"}
                    rel={item.href.startsWith("mailto:") ? undefined : "noreferrer"}
                  >
                    {item.label}
                    {item.href.startsWith("mailto:") ? null : (
                      <ArrowSquareOut size={11} weight="bold" aria-hidden />
                    )}
                  </a>
                ) : (
                  <Link key={item.href + item.label} href={item.href}>
                    {item.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>

        {/*
          * One sentence, not a disclaimer wall. The four paragraphs that used
          * to sit here restated the custody and evidence boundaries the
          * Handbook owns — maintained in two places, which is how one of them
          * goes stale. The boundary is linked, not duplicated.
          */}
        <div className="rx-footer-legal">
          <p>
            Ryntra is not an exchange, broker, custodian or adviser. It never holds funds, never asks for a
            seed phrase or private key, and never signs on your behalf.{" "}
            <Link href="/security">Custody and security boundaries →</Link>
          </p>
          <div className="rx-footer-meta">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <span suppressHydrationWarning>© {new Date().getFullYear()} Ryntra</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
