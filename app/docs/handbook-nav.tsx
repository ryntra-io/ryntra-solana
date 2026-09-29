"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";

/**
 * The Handbook's left rail: a filter and a scroll spy.
 *
 * Deliberately the only client component on the page. The document itself is
 * rendered on the server — ten sections of capability tables and prose have no
 * business in a browser bundle, and a search box is not a reason to put them
 * there. So this component owns the rail, and reaches the sections through the
 * `data-hb-sec` attribute they already carry.
 *
 * Two behaviours, both of which fail safe:
 *
 * Filtering hides sections whose text does not match, and clearing the field
 * restores every one of them. The match runs against the section's own rendered
 * `textContent`, read once on mount, so a table row added to a section is
 * searchable without anyone remembering to update a keyword list here — the
 * exact failure mode a hand-maintained index has.
 *
 * The scroll spy marks the section a reader is actually looking at. Without
 * JavaScript the rail is still a plain list of working anchors, which is the
 * only part that has to work.
 */

export type HandbookEntry = Readonly<{ id: string; n: string; label: string }>;

export function HandbookNav({ entries, subject = "the Handbook" }: { entries: readonly HandbookEntry[]; subject?: string }) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(entries[0]?.id ?? "");
  /** id → lower-cased rendered text, read once from the server-rendered DOM. */
  const haystack = useRef<Map<string, string>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      const node = document.querySelector(`[data-hb-sec="${entry.id}"]`);
      map.set(entry.id, `${entry.label} ${node?.textContent ?? ""}`.toLowerCase());
    }
    haystack.current = map;
    setReady(true);
  }, [entries]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !ready) return null;
    /* Every whitespace-separated term has to appear. "swap receipt" should find
       the section that carries both words, not the union of two loose hits. */
    const terms = needle.split(/\s+/);
    return new Set(
      entries
        .filter((entry) => {
          const text = haystack.current.get(entry.id) ?? "";
          return terms.every((term) => text.includes(term));
        })
        .map((entry) => entry.id),
    );
  }, [query, entries, ready]);

  /* The sections live outside this component's tree, so their filtered state is
     applied as an attribute rather than through React. Removing the attribute
     on cleanup means an unmount can never leave the document half-hidden. */
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-hb-sec]");
    for (const node of nodes) {
      const id = node.dataset.hbSec ?? "";
      if (matches && !matches.has(id)) node.setAttribute("data-filtered", "");
      else node.removeAttribute("data-filtered");
    }
    return () => {
      for (const node of nodes) node.removeAttribute("data-filtered");
    };
  }, [matches]);

  useEffect(() => {
    /* `rootMargin` puts the detection line just under the sticky header, so the
       highlighted entry is the section whose heading a reader can actually see
       rather than the one that happens to touch the viewport edge. */
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent((visible.target as HTMLElement).dataset.hbSec ?? "");
      },
      { rootMargin: "-84px 0px -70% 0px", threshold: 0 },
    );
    for (const node of document.querySelectorAll("[data-hb-sec]")) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const visible = entries.filter((entry) => !matches || matches.has(entry.id));

  return (
    <aside className="rx-hb-side">
      <div className="rx-hb-search">
        <label className="rx-sr" htmlFor="hb-search">
          Search {subject}
        </label>
        <div className="rx-hb-field">
          <MagnifyingGlass size={15} weight="bold" aria-hidden />
          <input
            id="hb-search"
            className="rx-hb-input"
            type="search"
            placeholder={`Search ${subject}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
        </div>
        <p className="rx-hb-count" role="status">
          {matches ? `${visible.length} of ${entries.length} sections` : `${entries.length} sections`}
        </p>
      </div>

      <nav className="rx-hb-nav" aria-label="Handbook contents">
        {entries.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.id}`}
            data-filtered={matches && !matches.has(entry.id) ? "" : undefined}
            data-current={entry.id === current && !matches ? "" : undefined}
            aria-current={entry.id === current && !matches ? "true" : undefined}
          >
            <b>{entry.n}</b>
            <span>{entry.label}</span>
          </a>
        ))}
        {matches && visible.length === 0 ? (
          <p className="rx-hb-empty">
            No section matches “{query.trim()}”. The Handbook covers the product model, capabilities,
            method, evidence, security, ecosystems and roadmap.
          </p>
        ) : null}
      </nav>
    </aside>
  );
}
