"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MENU_DESTINATIONS } from "@/app/shell/domains";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { launchWords } from "./launch-words";
import styles from "./launch.module.css";

/**
 * Launch's two pages, one tap apart: «Запустити токен» · «Мої лаунчі». The
 * menu has one row for Launch, so the place's own pages are named here, at the
 * top of each, on a desk and on a phone alike.
 */
export function LaunchTabs({ locale }: { locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const pathname = usePathname() ?? "";
  const tabs = [
    { href: "/app/launch/new", label: word("title") },
    { href: "/app/launch/mine", label: word("mineTitle") },
  ];
  return (
    <nav className={styles.placeTabs} aria-label={MENU_DESTINATIONS.launch.label[locale]}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={styles.placeTab} aria-current={pathname === tab.href ? "page" : undefined} prefetch={false}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
