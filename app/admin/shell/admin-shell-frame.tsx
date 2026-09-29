"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { List, X } from "@phosphor-icons/react";

import { ADMIN_NAV, ADMIN_NAV_GROUPS, type AdminNavId } from "./nav";
import styles from "./admin-shell.module.css";
import { ReverifyHost } from "../reverify";

export function AdminShellFrame({
  active,
  env,
  children,
}: {
  active: AdminNavId;
  env: "PRODUCTION" | "LOCAL";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = useCallback(() => setOpen(false), []);

  /* A route change closes the drawer; Escape closes it too. */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const activeLabel = ADMIN_NAV.find((item) => item.id === active)?.label ?? "Огляд";

  return (
    <div className={`${styles.root} ${open ? styles.rootOpen : ""}`} lang="uk">
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls="admin-nav"
          aria-label={open ? "Закрити меню" : "Відкрити меню"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} weight="bold" aria-hidden /> : <List size={20} weight="bold" aria-hidden />}
        </button>
        <Link href="/admin" className={styles.brand}>
          <em className={styles.brandMark}>Ryntra</em> Admin
        </Link>
        <span className={styles.env}>{env}</span>
        <span className={styles.section} aria-hidden>
          {activeLabel}
        </span>
        <span className={styles.topbarSpacer} />
        {/* Full document navigation so Set-Cookie from logout applies. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={styles.logout} href="/api/session?logout=1">
          Вийти
        </a>
      </header>
      <button
        type="button"
        className={styles.backdrop}
        aria-hidden={!open}
        tabIndex={-1}
        onClick={close}
      />
      <nav id="admin-nav" className={styles.sidebar} aria-label="Адмінка" aria-hidden={!open ? undefined : false}>
        {ADMIN_NAV_GROUPS.map((group) => {
          const items = ADMIN_NAV.filter((item) => item.group === group.id);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className={styles.group}>
              <p className={styles.groupLabel}>{group.label}</p>
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`${styles.link} ${item.id === active ? styles.linkActive : ""}`}
                  aria-current={item.id === active ? "page" : undefined}
                  onClick={close}
                >
                  {item.label}
                  {item.later ? <span className={styles.later}>пізніше</span> : null}
                </Link>
              ))}
              {group.id === "internal" ? (
                <>
                  <Link href="/app" className={styles.link} onClick={close}>
                    Кабінет
                  </Link>
                  <a className={styles.link} href="https://ryntra.io" target="_blank" rel="noreferrer">
                    Сайт
                  </a>
                </>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className={styles.canvas}>
        <div className={styles.canvasInner}>{children}</div>
      </div>
      <ReverifyHost />
    </div>
  );
}
