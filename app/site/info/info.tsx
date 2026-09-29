import Link from "next/link";
import { ArrowRight, Check, Prohibit } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import type { PublicLocale } from "@/lib/site/locale";
import { localizedPath } from "@/lib/site/localized";
import "@/app/site/frozen/primitives.css";

import styles from "./info.module.css";
import type { Prose } from "./prose";

export type { Prose } from "./prose";

/*
 * The furniture of the public pages around the landing — About, Security,
 * Where the figures come from, Open source, Contact, Verify (the new site of
 * canon v5.5). Small on purpose: a page is its words (each page's copy module,
 * English and Ukrainian together) laid into these few shapes, so every page
 * reads the same way and no page grows a shape of its own.
 *
 * One rule the shapes enforce: a technical paragraph never stands at rest on
 * the page. At rest a block is a title, one line and short items; the detail
 * sits in a disclosure, a tap deeper (canon §0.0 rule 1).
 */

export type InfoLink = Readonly<{ href: string; label: string; external?: boolean }>;

/** The page: the one public header and footer, in the page's language, around its `main`. */
export function InfoPage({
  locale,
  children,
  quietHeaderAction = false,
}: {
  locale: PublicLocale;
  children: ReactNode;
  /** The page's own orange action is the one on the screen — the header's «Open the app» steps back (canon §2, rule 1). */
  quietHeaderAction?: boolean;
}) {
  return (
    <div className="rx">
      <MarkDefs />
      <PublicHeader locale={locale} ctaTone={quietHeaderAction ? "quiet" : "primary"} />
      <main id="main" className={styles.main} tabIndex={-1} lang={locale} dir="ltr">
        {children}
      </main>
      <FrozenFooter locale={locale} />
    </div>
  );
}

export function InfoHero({
  eyebrow,
  title,
  lead,
  note,
  chips,
  actions,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  /** One quieter sentence under the lead: what the page covers, and what it does not. */
  note?: ReactNode;
  chips?: readonly string[];
  actions?: ReactNode;
}) {
  return (
    <header className={styles.hero}>
      <div className={styles.wrap}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
          {note ? <p className={styles.heroNote}>{note}</p> : null}
          {chips?.length ? (
            <ul className={styles.chips}>
              {chips.map((chip) => <li className={styles.chip} key={chip}>{chip}</li>)}
            </ul>
          ) : null}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}

export function InfoBlock({
  id,
  eyebrow,
  title,
  lead,
  meta,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  /** A factual note beside the title — a date the facts were checked, a count. */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className={styles.block} aria-labelledby={`${id}-title`}>
      <div className={styles.wrap}>
        <div className={styles.blockHead}>
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h2 id={`${id}-title`} className={styles.blockTitle}>{title}</h2>
          {lead ? <p className={styles.blockLead}>{lead}</p> : null}
          {meta ? <p className={styles.meta}>{meta}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

export type Tile = Readonly<{ title: string; body: string; icon?: ReactNode; href?: string }>;

export function Tiles({ items }: { items: readonly Tile[] }) {
  return (
    <ul className={styles.tiles} data-count={items.length}>
      {items.map((item) => (
        <li className={styles.tile} key={item.title}>
          {item.href ? (
            <TileLink href={item.href}>
              {item.icon ? <span className={styles.tileIcon} aria-hidden>{item.icon}</span> : null}
              <span className={styles.tileTitle}>{item.title}<ArrowRight size={16} aria-hidden /></span>
              <span className={styles.tileBody}>{item.body}</span>
            </TileLink>
          ) : (
            <>
              {item.icon ? <span className={styles.tileIcon} aria-hidden>{item.icon}</span> : null}
              <h3 className={styles.tileTitle}>{item.title}</h3>
              <p className={styles.tileBody}>{item.body}</p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A tile that goes somewhere: a page of the site by the router, a letter or another site as a plain link. */
function TileLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith("mailto:")) return <a className={styles.tileLink} href={href}>{children}</a>;
  if (/^https?:/.test(href)) return <a className={styles.tileLink} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  return <Link className={styles.tileLink} href={href} prefetch={false}>{children}</Link>;
}

export function Checks({ items, columns = 1, tone = "can" }: { items: readonly string[]; columns?: 1 | 2; tone?: "can" | "cannot" }) {
  return (
    <ul className={styles.checks} data-columns={columns} data-tone={tone}>
      {items.map((item) => <li key={item}>{tone === "cannot" ? <Prohibit size={16} weight="bold" aria-hidden /> : <Check size={16} weight="bold" aria-hidden />}<span>{item}</span></li>)}
    </ul>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={styles.panel}>
      {title ? <h3 className={styles.panelTitle}>{title}</h3> : null}
      {children}
    </div>
  );
}

/** Rows of a label and what it is — and, where it has one, the third column: its source, its time. */
export function Rows({
  rows,
  shape = "triple",
  head,
}: {
  rows: readonly (readonly [string, string, string?])[];
  shape?: "triple" | "pair";
  /** The columns' names, drawn over the rows where they stand side by side; on a phone each row reads top to bottom. */
  head?: readonly [string, string, string];
}) {
  return (
    <dl className={styles.rows} data-shape={shape}>
      {head ? (
        <div className={styles.rowHead} aria-hidden>
          {head.map((cell) => <span key={cell}>{cell}</span>)}
        </div>
      ) : null}
      {rows.map(([label, value, note]) => (
        <div className={styles.row} key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
          {note ? <dd>{note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export type Disclosure = Readonly<{
  id: string;
  title: string;
  /** One line under the title, readable while the disclosure is closed. */
  hint?: string;
  /** A number the disclosure keeps from an older document, so a link to it still means the same thing. */
  number?: string;
  body: ReactNode;
}>;

export function Disclosures({ items }: { items: readonly Disclosure[] }) {
  return (
    <div className={styles.disclosures}>
      {items.map((item) => (
        <details className={styles.disclosure} id={item.id} key={item.id}>
          <summary>
            <span className={styles.summaryText}>
              <span className={styles.summaryTitle}>
                {item.number ? <span className={styles.number}>{item.number}</span> : null}
                {item.title}
              </span>
              {item.hint ? <span className={styles.summaryHint}>{item.hint}</span> : null}
            </span>
          </summary>
          <div className={styles.body}>{item.body}</div>
        </details>
      ))}
    </div>
  );
}

export function ProseBody({ blocks }: { blocks: readonly Prose[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (typeof block === "string") return <p key={index}>{block}</p>;
        if ("list" in block) return <ul key={index}>{block.list.map((item) => <li key={item}>{item}</li>)}</ul>;
        if ("strong" in block) return <p key={index}><strong>{block.strong}</strong></p>;
        if ("gap" in block) return <p key={index} className={styles.gap}>{block.gap}</p>;
        if ("code" in block) return <pre key={index} className={styles.pre}><code>{block.code}</code></pre>;
        return <p key={index}><Link className={styles.link} href={block.href} prefetch={false}>{block.label}<ArrowRight size={16} aria-hidden /></Link></p>;
      })}
    </>
  );
}

/** A row of links; a page of the site at the address of the page's language (`/uk/docs`) where it has one. */
export function LinkRow({ links, locale = "en" }: { links: readonly InfoLink[]; locale?: PublicLocale }) {
  return (
    <ul className={styles.linkRow}>
      {links.map((link) => (
        <li key={link.href}>
          {link.external ? (
            <a className={styles.link} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ArrowRight size={16} aria-hidden /></a>
          ) : (
            <Link className={styles.link} href={localizedPath(link.href, locale)} prefetch={false}>{link.label}<ArrowRight size={16} aria-hidden /></Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PrimaryAction({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return external || href.startsWith("mailto:")
    ? <a className={styles.primary} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>
    : <Link className={styles.primary} href={href} prefetch={false}>{children}</Link>;
}

export function SecondaryAction({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return external || href.startsWith("mailto:")
    ? <a className={styles.secondary} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>
    : <Link className={styles.secondary} href={href} prefetch={false}>{children}</Link>;
}

export const infoStyles = styles;
