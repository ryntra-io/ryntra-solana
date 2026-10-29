"use client";

import { Button, EmptyState, Skeleton, type IconName } from "@ryntra/core/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Launch's pages on the core's blocks (B4): the few pieces every one of them draws the same way — a link that looks
 * like the core's button, a read still coming, and a read that failed with its one way to try again.
 */

export type CoreLang = "en" | "uk";

export const coreLang = (locale: WorkspaceLocale): CoreLang => (locale === "uk" ? "uk" : "en");

/** A link drawn as the core's button: a page to open is a link, never a button that navigates. */
export function LinkButton({
  href,
  variant = "secondary",
  external = false,
  className,
  label: name,
  children,
}: {
  href: string;
  variant?: "primary" | "secondary" | "ghost";
  /** The whole name when the face is short — a logo and one word: read out, and shown on hover. */
  label?: string;
  /** Another site: a new tab, and nothing of this one goes with it. */
  external?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = `ryntra-button ryntra-button--${variant}${className ? ` ${className}` : ""}`;
  const label = <span className="ryntra-button__label">{children}</span>;
  if (external)
    return (
      <a className={classes} href={href} target="_blank" rel="noreferrer noopener nofollow ugc" aria-label={name} title={name}>
        {label}
      </a>
    );
  return (
    <Link className={classes} href={href} prefetch={false} aria-label={name} title={name}>
      {label}
    </Link>
  );
}

/** A read still on its way: the shape of what comes, said once for a screen reader. */
export function Reading({ label, lines = 3, hero = false }: { label: string; lines?: number; hero?: boolean }) {
  return (
    <div aria-live="polite" aria-busy="true">
      <Skeleton lines={lines} hero={hero} label={label} />
    </div>
  );
}

/** A read that failed: one sentence and «Read again» — never an empty list that looks like none. */
export function Unread({ text, again, onAgain, lang, icon = "circle-x" }: { text: ReactNode; again: string; onAgain: () => void; lang: CoreLang; icon?: IconName }) {
  return (
    <EmptyState
      icon={icon}
      text={text}
      role="status"
      action={
        <Button variant="secondary" onClick={onAgain} lang={lang}>
          {again}
        </Button>
      }
    />
  );
}
