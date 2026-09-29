import type { ReactNode } from "react";
import Link from "next/link";

import { FrozenFooter, FrozenHeader } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";

import { DocsSearch } from "./docs-search";
import { DOCS_GROUPS, entryFor, groupFor } from "./nav";

/**
 * One documentation article.
 *
 * Everything a docs page needs and no page should re-declare: the chrome, the
 * left navigation, the breadcrumb, the header with its page class and review
 * date, and the previous/next pair at the foot.
 *
 * The page class is not decoration. A reader who knows whether they are holding
 * *Architecture* or *Capability* knows, before the first paragraph, whether the
 * page is describing what is being built or what can be relied on — which is the
 * exact confusion the split of `/docs` was performed to end.
 */
export function DocsArticle({
  href,
  lead,
  reviewed,
  children,
}: {
  /** This page's own route. Everything else is looked up from the tree. */
  href: string;
  lead: string;
  /** When the content was last checked against the thing it describes. */
  reviewed: string;
  children: ReactNode;
}) {
  const entry = entryFor(href);
  const group = groupFor(href);
  if (!entry || !group) {
    /* A page that is not in the tree cannot render its own breadcrumb, and a
       silent fallback would let a route drift out of the navigation while still
       looking finished. */
    throw new Error(`${href} renders a docs article but is not in DOCS_GROUPS.`);
  }

  const flat = DOCS_GROUPS.flatMap((g) => g.entries).filter((e) => !e.external);
  const index = flat.findIndex((e) => e.href === href);
  const previous = index > 0 ? flat[index - 1] : null;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;

  return (
    <div className="rx" data-ry-ground="midnight">
      <MarkDefs />
      <FrozenHeader />

      <div className="rx-doc">
        <DocsSearch current={href} />

        <main className="rx-doc-main" id="main" tabIndex={-1}>
          <nav className="rx-doc-crumbs" aria-label="Breadcrumb">
            <Link href="/docs">Documentation</Link>
            <span aria-hidden>/</span>
            <span>{group.label}</span>
          </nav>

          <header className="rx-doc-head">
            <h1 className="rx-h1 rx-doc-h1">{entry.label}</h1>
            <p className="rx-lead">{lead}</p>
            <p className="rx-doc-meta">
              <span className="rx-doc-class">{entry.pageClass}</span>
              <span>Last reviewed {reviewed}</span>
            </p>
          </header>

          <div className="rx-doc-body">{children}</div>

          {previous || next ? (
            <nav className="rx-doc-updown" aria-label="More documentation">
              {previous ? (
                <Link className="rx-doc-updown-link" href={previous.href}>
                  <span>Previous</span>
                  {previous.label}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link className="rx-doc-updown-link rx-doc-updown-link--next" href={next.href}>
                  <span>Next</span>
                  {next.label}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </main>
      </div>

      <FrozenFooter />
    </div>
  );
}
