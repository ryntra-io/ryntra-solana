"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { CONTACTS, contactMailto } from "@/lib/site/contacts";
import { ActionBody, Page, PageHead, Panel, cx } from "@/terminal/ui";

import b from "../../docs/_book/book.module.css";
import { Disclosure, DocsBar } from "../../docs/_book/parts";
import l from "./legal.module.css";
import { LEGAL_WORDS, type LegalDoor } from "./words";

type Lang = keyof typeof LEGAL_WORDS;

/** One numbered part of a document: its anchor, its heading as written, the language it is written in, its text. */
export type LegalPart = Readonly<{ id: string; heading: string; lang?: string; body: ReactNode }>;

/**
 * A legal document in the terminal's frame and language: the bar with the language, the title, the date it
 * took effect, the opening and every numbered part open to read, one under the other. On a desk «Contents» stands
 * beside the text and follows the reader; on a phone and a narrow desk it is one quiet disclosure above the text. The
 * other documents close the page. The documents' words are passed in as they are — this file owns none of them.
 */
export function LegalPage({
  lang,
  mark,
  here,
  title,
  titleLang,
  docLang,
  date,
  notice,
  intro,
  parts,
  doors,
  children,
}: {
  lang: Lang;
  /** The page's mark for its shots and tests. */
  mark: string;
  /** The page's name in the bar, in the reader's language. */
  here: string;
  title: string;
  titleLang: string;
  docLang: string;
  date?: string;
  notice?: ReactNode;
  intro?: ReactNode;
  parts: readonly LegalPart[];
  doors: readonly LegalDoor[];
  children?: ReactNode;
}) {
  const w = LEGAL_WORDS[lang];
  const ids = parts.map((part) => part.id);
  const { active, go } = useActivePart(ids);
  useArrival();

  const contents = (narrow: boolean) => (
    <nav className={b.toc} aria-label={w.contents}>
      {parts.map((part) => (
        <a
          key={part.id}
          href={`#${part.id}`}
          className={cx(b.tocLink, l.tocItem)}
          lang={part.lang}
          aria-current={!narrow && active === part.id ? "location" : undefined}
          onClick={(event) => go(event, part.id)}
        >
          {part.heading}
        </a>
      ))}
    </nav>
  );

  const legal = (
    <nav className={b.toc} aria-label={w.legal}>
      {doors.map((door) => (
        <Link key={door.href} href={door.href} className={b.tocLink} aria-current={door.current ? "page" : undefined}>
          {door.label}
        </Link>
      ))}
    </nav>
  );

  const toc = parts.length > 1;
  const side = (
    <div className={b.sideStack}>
      {toc ? (
        <Panel pad="m">
          <p className={cx(b.blockHead, l.panelHead)} aria-hidden="true">
            {w.contents}
          </p>
          {contents(false)}
        </Panel>
      ) : null}
      <Panel pad="m">
        <p className={cx(b.blockHead, l.panelHead)} aria-hidden="true">
          {w.legal}
        </p>
        {legal}
      </Panel>
    </div>
  );

  return (
    <Page className={b.page} data-legal={mark}>
      <DocsBar lang={lang} here={here} />
      <PageHead title={<span lang={titleLang}>{title}</span>} />
      <ActionBody side={side} sideLabel={toc ? w.contents : w.legal} className={l.body}>
        <article className={l.doc} lang={docLang}>
          {date ? <p className={l.date}>{date}</p> : null}
          {notice}
          {intro ? <div className={l.intro}>{intro}</div> : null}
          {toc ? (
            <div className={l.narrowOnly}>
              <Disclosure title={w.contents}>{contents(true)}</Disclosure>
            </div>
          ) : null}
          {parts.map((part) => (
            <section key={part.id} id={part.id} className={l.part} lang={part.lang} aria-labelledby={`${part.id}-heading`}>
              <h2 id={`${part.id}-heading`} className={l.partHead} tabIndex={-1}>
                {part.heading}
              </h2>
              {part.body}
            </section>
          ))}
          {children}
          <footer className={l.foot} lang={lang}>
            <p className={l.footLine}>
              <span>{w.questions}</span>
              <a className={b.inlineLink} href={contactMailto()}>
                {CONTACTS.email}
              </a>
            </p>
            <nav className={cx(l.footDoors, l.narrowOnly)} aria-label={w.legal}>
              {doors
                .filter((door) => !door.current)
                .map((door) => (
                  <Link key={door.href} href={door.href} className={b.inlineLink}>
                    {door.label}
                  </Link>
                ))}
            </nav>
          </footer>
        </article>
      </ActionBody>
    </Page>
  );
}

/** How far down the window a part counts as the one being read: its top in the window's upper third. */
const READ_SHARE = 0.32;
/** How near the page's foot counts as its foot. */
const FOOT_PX = 24;

/**
 * The part the reader is in: the last whose top has passed the upper third; at the page's foot, the last part. A part
 * pressed in «Contents» stays lit while it is in the window — near the foot the page cannot bring it to the top. The
 * press: the part glides into view under the header, the address names it, and the keyboard's place moves to its
 * heading.
 */
function useActivePart(ids: readonly string[]): { active: string | null; go: (event: MouseEvent<HTMLAnchorElement>, id: string) => void } {
  const [active, setActive] = useState<string | null>(null);
  const pressed = useRef<string | null>(null);
  const key = ids.join(" ");

  const go = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const place = document.getElementById(id);
    if (!place) return;
    event.preventDefault();
    pressed.current = id;
    setActive(id);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    place.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
    window.history.replaceState(window.history.state, "", `#${id}`);
  };

  useEffect(() => {
    const list = key ? key.split(" ") : [];
    if (list.length < 2) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (pressed.current) {
        const top = document.getElementById(pressed.current)?.getBoundingClientRect().top;
        if (top !== undefined && top >= 0 && top < window.innerHeight * 0.75) return setActive(pressed.current);
        pressed.current = null;
      }
      const foot = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - FOOT_PX;
      const line = window.innerHeight * READ_SHARE;
      let current: string | null = null;
      for (const id of list) {
        const place = document.getElementById(id);
        if (place && place.getBoundingClientRect().top <= line) current = id;
      }
      setActive(foot && current ? list[list.length - 1] : current);
    };
    const soon = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
    };
  }, [key]);
  return { active, go };
}

/**
 * An address that names a part (`/legal/privacy#android` — the store's link): the browser jumps to it on the page as
 * served; once the words are in the reader's language — a Ukrainian reader's parts can be longer — the part is brought
 * to the top again, once.
 */
function useArrival() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!/^[a-z][a-z0-9-]*$/.test(id)) return;
    const settle = () => document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
    // The next frame: the language's own render is in by then. Once the faces are in, once more — unless the reader
    // has moved on.
    window.requestAnimationFrame(() => {
      settle();
      const left = window.scrollY;
      const again = () => {
        if (Math.abs(window.scrollY - left) < 2) settle();
      };
      void document.fonts?.ready.then(() => window.requestAnimationFrame(again));
      window.setTimeout(again, 400);
    });
  }, []);
}
