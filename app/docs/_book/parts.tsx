"use client";

import Link from "next/link";
import { useLayoutEffect, type ReactNode } from "react";

import { hydrateLang, LANG_LABEL, LANGS, setLang, useLang } from "@/city/lib/i18n/lang";
import ui from "@/terminal/ui/ui.module.css";

import { shotSrc, UI, type Lang, type ShotId } from "./book";
import b from "./book.module.css";

/** The reader's language: the terminal's own switch and kept choice (`?lang=` on a link wins). */
export function useDocsLang(): Lang {
  useLayoutEffect(() => void hydrateLang(), []);
  return useLang();
}

/** The quiet bar over every page: where you are, and the language switch. */
export function DocsBar({ lang, here }: { lang: Lang; here?: string }) {
  const u = UI[lang];
  return (
    <div className={b.bar}>
      <nav className={b.crumbs} aria-label={u.docs}>
        {here ? (
          <>
            <Link href="/docs" className={b.crumb}>
              {u.docs}
            </Link>
            <span className={b.crumbSep} aria-hidden="true">
              /
            </span>
            <span className={b.crumbHere} aria-current="page">
              {here}
            </span>
          </>
        ) : (
          <span className={b.crumbHere} aria-current="page">
            {u.docs}
          </span>
        )}
      </nav>
      <div className={b.lang} role="group" aria-label={u.language}>
        {LANGS.map((code) => (
          <button key={code} type="button" className={b.langButton} aria-pressed={lang === code} onClick={() => setLang(code)}>
            {LANG_LABEL[code]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A frame of the live site, the phone's frame on a phone. */
export function Shot({ shot, lang, alt, priority = false, className }: { shot: ShotId; lang: Lang; alt: string; priority?: boolean; className?: string }) {
  return (
    <figure className={`${b.shot} ${className ?? ""}`}>
      <picture>
        <source media="(max-width: 767px)" srcSet={shotSrc(shot, "phone", lang)} width={780} height={1688} />
        <img
          className={b.shotImg}
          src={shotSrc(shot, "desk", lang)}
          width={1440}
          height={900}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
      </picture>
    </figure>
  );
}

/** The screen's one amber action, as a link to the terminal's screen it names. */
export function OpenLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`${ui.act} ${className ?? ""}`} prefetch={false}>
      {children}
    </Link>
  );
}

/** One quiet disclosure: closed, its name and a chevron; open, a few short sentences. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={b.more}>
      <summary className={b.moreHead}>
        <span>{title}</span>
        <span className={b.chevron} aria-hidden="true" />
      </summary>
      <div className={b.moreBody}>{children}</div>
    </details>
  );
}

/** A quiet state mark: «Live» in mint, «Coming» in lilac. */
export function StateMark({ live, lang }: { live: boolean; lang: Lang }) {
  return (
    <span className={b.state} data-live={live ? "" : undefined}>
      <span className={b.stateDot} aria-hidden="true" />
      {live ? UI[lang].live : UI[lang].coming}
    </span>
  );
}
