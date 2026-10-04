import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "./docs.css";

/*
 * The documentation's own segment.
 *
 * It used to load three faces of its own — Onest, IBM Plex Mono and
 * Unbounded — under the root's variable names, so `/docs` rendered in a
 * different typeface from every other page. The brand's typography (v1.0,
 * 2026-09-11) puts Geist, Geist Mono and Unbounded on the root layout with
 * the Cyrillic subsets; this segment now loads nothing and inherits them,
 * which is what the projection's `--ry-font-*` tokens read.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    /* The ground is set here as well as on `.rx`, so an overscroll bounce shows
       the graphite ground rather than the legacy navy the root body still carries. */
    <div style={{ background: "var(--ry-bg)" }}>{children}</div>
  );
}
