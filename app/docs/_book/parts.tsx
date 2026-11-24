"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, type ReactNode } from "react";

import { hydrateLang, LANG_LABEL, LANGS, setLang, useLang } from "@/city/lib/i18n/lang";
import { terminalOpen } from "@/terminal/shell/flag";
import { Icon } from "@/terminal/ui";
import ui from "@/terminal/ui/ui.module.css";

import { docsTabTitle, shotSrc, UI, type Lang, type SectionId, type ShotId } from "./book";
import b from "./book.module.css";

/** The reader's language: the terminal's own switch and kept choice (`?lang=` on a link wins). */
export function useDocsLang(): Lang {
  useLayoutEffect(() => void hydrateLang(), []);
  return useLang();
}

/**
 * The browser's tab in the reader's language, as the terminal's pages do (`terminal/shell/useTabTitle.ts`): the server
 * names the page in English; once the page knows the language, the tab says the page's name in it — again whenever the
 * reader turns the language, or the router writes the English name back on a move. `null` is the docs' first page.
 */
export function useDocsTabTitle(id: SectionId | null, lang: Lang): void {
  useEffect(() => {
    const want = docsTabTitle(id, lang);
    const put = () => {
      if (document.title !== want) document.title = want;
    };
    put();
    // The router writes a page's title after the screen has drawn (a streamed one later still): it is put back.
    const watch = new MutationObserver(put);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [id, lang]);
}

/**
 * The quiet bar over a page: where you are — the way back to the docs from one of their pages. The language is the
 * frame's own, in «More» on a desk and in the phone's menu (the eyes' pass of 19.11: a second switch beside it); only where the
 * terminal is shut and the page stands in the plain frame does the bar keep a switch of its own. The docs, Help and About
 * are named by their heads, not by the bar, so their heads stand on the line of every screen's head (the eyes' passes of
 * 19.11 and 20.11); the way back to the docs from a section is the first line of its list of sections.
 */
export function DocsBar({ lang, here }: { lang: Lang; here?: string }) {
  const u = UI[lang];
  const own = !terminalOpen();
  if (!here && !own) return null;
  return (
    <div className={b.bar}>
      {here ? (
        <nav className={b.crumbs} aria-label={u.docs}>
          <Link href="/docs" className={b.crumb}>
            {u.docs}
          </Link>
          <span className={b.crumbSep} aria-hidden="true">
            /
          </span>
          <span className={b.crumbHere} aria-current="page">
            {here}
          </span>
        </nav>
      ) : (
        <span />
      )}
      {own ? (
        <div className={b.lang} role="group" aria-label={u.language}>
          {LANGS.map((code) => (
            <button key={code} type="button" className={b.langButton} aria-pressed={lang === code} onClick={() => setLang(code)}>
              {LANG_LABEL[code]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A frame of the live site, the phone's frame on a phone; a short caption under it says what the frame shows. */
export function Shot({ shot, lang, alt, caption, priority = false, className }: { shot: ShotId; lang: Lang; alt: string; caption?: string; priority?: boolean; className?: string }) {
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
      {caption ? <figcaption className={b.caption}>{caption}</figcaption> : null}
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

/**
 * A few doors to other pages, under a quiet heading: each a full-width row with a hairline under it and an arrow on the
 * right, so it reads as a link (the eyes' pass of 20.11: pale rows with no arrow and no rule did not).
 */
export function LinkList({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <nav className={b.linkList} aria-label={title}>
      <h2 className={b.blockHead}>{title}</h2>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={b.linkRow}>
          <span>{link.label}</span>
          <Icon name="arrow" size="s" className={b.linkArrow} />
        </Link>
      ))}
    </nav>
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
