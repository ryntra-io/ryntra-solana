"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { pageActiveHref, placePages, PLACE_LABELS } from "@/app/shell/domains";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";

import styles from "./portfolio-tabs.module.css";

/**
 * Portfolio's pages, one tap apart (canon v5.3 В28, §3): Позиції · Стратегії
 * · Результати · Історія — the positions, the full plans with their versions
 * and journal, what the plans did, and every operation with its receipt.
 * Drawn from the registry (`PLACE_PAGES`), at the top of each of the four, so
 * a person always sees where they stand inside the place and the rail keeps
 * five rows.
 */
export function PortfolioTabs({ locale }: { locale: WorkspaceLocale }) {
  const pathname = usePathname() ?? "";
  const pages = placePages("portfolio", PRODUCT_ROUTES, locale);
  /* A tab is current on every route of its page — a plan's own page lights Стратегії. */
  const current = pageActiveHref(
    pathname,
    pages.map((page) => ({ href: page.href, match: PRODUCT_ROUTES.find((route) => route.id === page.id)?.match ?? [page.href] })),
  );
  return (
    <nav className={styles.tabs} aria-label={PLACE_LABELS.portfolio[locale]}>
      {pages.map((page) => (
        <Link key={page.id} href={page.href} className={styles.tab} aria-current={current === page.href ? "page" : undefined} prefetch={false}>
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
