"use client";

import { usePathname } from "next/navigation";

import { languageSwitchHref, pagePath, type AddressLocale } from "./localized.ts";

/**
 * After the language cookie is written: the open page at the chosen
 * language's address where it has one (`/uk/app/markets` ↔ `/app/markets` —
 * asking `/uk/…` again would answer in Ukrainian whatever the cookie says),
 * else the same page asked for again in the cookie's language.
 */
export function showPageInLanguage(router: Readonly<{ push(href: string): void; refresh(): void }>, next: AddressLocale): void {
  const { pathname, search } = window.location;
  const target = languageSwitchHref(pathname, search, next);
  if (target && target !== pathname + search) router.push(target);
  else router.refresh();
}

/**
 * The open page's own path — `/app/markets` whether the bar reads
 * `/app/markets` or its Ukrainian address `/uk/app/markets` (`middleware.ts`).
 * The router keeps the address the person typed, so a menu that marks the
 * current page by its path asks this instead of `usePathname()`.
 */
export function usePagePath(): string {
  return pagePath(usePathname() ?? "/");
}
