"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { DOCS_GROUPS } from "./nav";

/**
 * The documentation rail, with a filter.
 *
 * The rail itself is not new — every article already rendered the full contents
 * beside it, which is the sticky sidebar the public-site brief asks for. A reader who knows the word they want
 * had to read eleven labels to find which page holds it.
 *
 * The filter matches against each entry's label **and its note**, because the
 * note is where the words a reader actually types live — "Passport", "Receipt",
 * "Starknet", "mandate" — and none of them is in a label. A hand-kept keyword
 * list would be a second list to forget to update; the note is already the
 * page's own description of its contents, and it is maintained because it is
 * rendered on the hub.
 *
 * Everything fails safe. This is a client component, so Next renders the full
 * list into the HTML: with JavaScript off the rail is a plain list of working
 * links, and the field simply does nothing. Clearing the field restores every
 * group. A query that matches nothing says so rather than showing an empty rail
 * that looks broken.
 */
export function DocsSearch({ current }: { current?: string }) {
  const [query, setQuery] = useState("");
  const fieldId = useId();
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!needle) return DOCS_GROUPS;
    return DOCS_GROUPS.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        `${entry.label} ${entry.note} ${group.label}`.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.entries.length > 0);
  }, [needle]);

  const matches = groups.reduce((total, group) => total + group.entries.length, 0);

  return (
    <nav className="rx-doc-nav" aria-label="Documentation">
      <div className="rx-doc-search">
        <label className="rx-doc-searchlabel" htmlFor={fieldId}>
          Filter documentation
        </label>
        <input
          id={fieldId}
          className="rx-doc-searchfield"
          type="search"
          value={query}
          placeholder="Solana, risk, receipt…"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        {/* Politely, and only while filtering: a live region that announces on
            every keystroke of an empty field is noise. */}
        <p className="rx-doc-searchcount" aria-live="polite">
          {needle ? `${matches} of ${DOCS_GROUPS.flatMap((g) => g.entries).length} pages` : ""}
        </p>
      </div>

      {groups.map((group) => (
        <div className="rx-doc-navgroup" key={group.id}>
          <p className="rx-doc-navlabel">{group.label}</p>
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.href}>
                <Link
                  className="rx-doc-navlink"
                  href={entry.href}
                  aria-current={entry.href === current ? "page" : undefined}
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {needle && matches === 0 ? (
        <p className="rx-doc-searchempty">
          Nothing here matches “{query.trim()}”. Clear the field to see every page.
        </p>
      ) : null}
    </nav>
  );
}
