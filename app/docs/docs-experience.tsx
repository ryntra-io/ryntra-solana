"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { type PublicLocale } from "@/lib/site/locale";
import { localizedPath, pagePath } from "@/lib/site/localized";

import { DEVELOPER_ENTRIES, DOC_NAV, DOC_PAGES, SITE_ENTRIES, docNeighbours, docPageBySlug, docSearchText, docsHref } from "./content";
import { PRODUCT_PAGES, destinationHref, hrefOf } from "./content/facts";
import { GROUP_TITLES, type DocBlock, type DocPage } from "./content/model";

/**
 * The documentation, rendered from data.
 *
 * One layout — the sidebar with search and the menu's sections, the article —
 * for every documentation page. A product page is `view: "page"` with its
 * `DocPage`; the developer references keep their own renderers below because
 * they draw from an API surface rather than from prose, and `view: "reference"`
 * draws a reference its own page brings as children, in the reader's language
 * (`useDocsLocale`).
 *
 * The language follows the public header's switch through the
 * `ryntra:public-locale` event, so a reader who changes the language sees
 * the page change in place rather than reloading it.
 */

type View =
  | Readonly<{ kind: "page"; page: DocPage }>
  | Readonly<{ kind: "developers" }>
  | Readonly<{ kind: "reference" }>
  | Readonly<{ kind: "agent-control" }>;

const DocsLocaleContext = createContext<PublicLocale>("en");

/** The language the documentation is drawn in right now — for a reference a page brings as children. */
export function useDocsLocale(): PublicLocale {
  return useContext(DocsLocaleContext);
}

const CHROME = {
  en: {
    search: "Search the documentation",
    placeholder: "Perps, grid, launch, fees…",
    results: (n: number) => (n === 1 ? "1 page" : `${n} pages`),
    noResults: "Nothing matches. Try another word.",
    contents: "Contents",
    documentation: "Documentation",
    open: "Open in Ryntra",
    openDocs: "Open Ryntra",
    onThisPage: "On this page",
    related: "Read next",
    previous: "Previous",
    next: "Next",
    browse: "Browse the documentation",
    pagesHead: ["Section", "Page"] as const,
  },
  uk: {
    search: "Пошук у документації",
    placeholder: "Perps, грід, лаунч, комісії…",
    results: (n: number) => `${n} стор.`,
    noResults: "Нічого не знайдено. Спробуй інше слово.",
    contents: "Зміст",
    documentation: "Документація",
    open: "Відкрити в Ryntra",
    openDocs: "Відкрити Ryntra",
    onThisPage: "На цій сторінці",
    related: "Читати далі",
    previous: "Назад",
    next: "Далі",
    browse: "Розділи документації",
    pagesHead: ["Розділ", "Сторінка"] as const,
  },
} as const;

export function DocsExperience({
  view,
  initialLocale = "en",
  children,
}: {
  view: View;
  initialLocale?: PublicLocale;
  children?: ReactNode;
}) {
  const [locale, setLocale] = useState<PublicLocale>(initialLocale);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname() ?? "/docs";
  const fieldId = useId();
  const chrome = CHROME[locale];

  /* The server draws the page in its address's language (`/uk/docs/…`) or
     the cookie's; a page with one address hears the header's switch in place. */
  useEffect(() => {
    setLocale(initialLocale);
  }, [initialLocale]);

  useEffect(() => {
    const update = (event: Event) => setLocale((event as CustomEvent<PublicLocale>).detail);
    window.addEventListener("ryntra:public-locale", update);
    return () => window.removeEventListener("ryntra:public-locale", update);
  }, []);

  const needle = query.trim().toLocaleLowerCase(locale === "uk" ? "uk" : "en");
  const visibleGroups = useMemo(() => {
    if (!needle) return DOC_NAV;
    const matching = new Set(DOC_PAGES.filter((page) => docSearchText(page, locale).includes(needle)).map((page) => docsHref(page.slug)));
    for (const entry of [...DEVELOPER_ENTRIES, ...Object.values(SITE_ENTRIES).flat()]) {
      if (`${entry.title[locale]} ${entry.summary[locale]}`.toLocaleLowerCase(locale === "uk" ? "uk" : "en").includes(needle)) matching.add(entry.href);
    }
    return DOC_NAV.map((group) => ({ ...group, items: group.items.filter((item) => matching.has(item.href)) })).filter((group) => group.items.length > 0);
  }, [locale, needle]);
  const results = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  const expanded = navOpen || Boolean(needle);

  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <label htmlFor={fieldId}>{chrome.search}</label>
        <input id={fieldId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={chrome.placeholder} autoComplete="off" />
        <p className="docs-result" aria-live="polite">{needle ? (results ? chrome.results(results) : chrome.noResults) : ""}</p>
        <button className="docs-nav-toggle" type="button" aria-expanded={expanded} aria-controls={`${fieldId}-nav`} onClick={() => { setNavOpen(!navOpen); setQuery(""); }}>
          {chrome.contents}<span aria-hidden>{expanded ? "−" : "+"}</span>
        </button>
        <nav id={`${fieldId}-nav`} data-open={expanded} aria-label={chrome.documentation}>
          {visibleGroups.map((group) => (
            <div className="docs-nav-group" key={group.id}>
              <p>{group.title[locale]}</p>
              <ul>
                {group.items.map((item) => {
                  const active = pagePath(pathname) === item.href;
                  return (
                    <li key={item.href}>
                      <Link href={localizedPath(item.href, locale)} aria-current={active ? "page" : undefined} onClick={() => { setNavOpen(false); setQuery(""); }}>
                        {item.title[locale]}
                        {needle ? <small>{item.summary[locale]}</small> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <article className="docs-article">
        {view.kind === "page" ? <DocArticle page={view.page} locale={locale} /> : null}
        {view.kind === "developers" ? <DeveloperOverview locale={locale} /> : null}
        {view.kind === "reference" ? <DocsLocaleContext.Provider value={locale}>{children}</DocsLocaleContext.Provider> : null}
        {view.kind === "agent-control" ? <AgentControlReference locale={locale} /> : null}
      </article>
    </div>
  );
}

/* ---------------------------------------------------------------- article */

function DocArticle({ page, locale }: { page: DocPage; locale: PublicLocale }) {
  const chrome = CHROME[locale];
  const { previous, next } = docNeighbours(page.slug);
  const related = (page.related ?? []).map((slug) => docPageBySlug(slug)).filter((item): item is DocPage => Boolean(item));
  const isHub = page.slug === "";

  return (
    <>
      <header className="docs-hero">
        <p className="docs-crumbs">
          <Link href={localizedPath("/docs", locale)}>{chrome.documentation}</Link>
          {!isHub ? <><span aria-hidden>/</span><span>{GROUP_TITLES[page.group][locale]}</span></> : null}
        </p>
        <h1>{page.title[locale]}</h1>
        <p className="docs-lead">{page.summary[locale]}</p>
        <div className="docs-hero-row">
          {/* No readiness chip: a documented page is a page that works — only what is built reaches a person. */}
          {page.pageId ? <Link className="docs-primary" href={localizedPath(hrefOf(page.pageId), locale)}>{chrome.open}</Link> : null}
          {!page.pageId && page.destination ? <Link className="docs-primary" href={localizedPath(destinationHref(page.destination), locale)}>{chrome.open}</Link> : null}
          {isHub ? <Link className="docs-primary" href="/app">{chrome.openDocs}</Link> : null}
        </div>
      </header>

      {page.sections.length > 1 ? (
        <nav className="docs-toc" aria-label={chrome.onThisPage}>
          <p>{chrome.onThisPage}</p>
          <ul>{page.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading[locale]}</a></li>)}</ul>
        </nav>
      ) : null}

      {page.sections.map((section) => (
        <section className="docs-section" id={section.id} key={section.id}>
          <h2>{section.heading[locale]}</h2>
          {section.blocks.map((block, index) => <Block block={block} locale={locale} key={`${section.id}-${index}`} />)}
        </section>
      ))}

      {isHub ? <DocsIndex locale={locale} /> : null}

      {related.length && !isHub ? (
        <section className="docs-related" aria-label={chrome.related}>
          <h2>{chrome.related}</h2>
          <ul>
            {related.map((item) => (
              <li key={item.slug}>
                <Link href={localizedPath(docsHref(item.slug), locale)}><strong>{item.title[locale]}</strong><span>{item.summary[locale]}</span></Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!isHub ? (
        <nav className="docs-pager" aria-label={`${chrome.previous} / ${chrome.next}`}>
          {previous ? <Link href={localizedPath(docsHref(previous.slug), locale)} rel="prev"><small>{chrome.previous}</small>{previous.title[locale]}</Link> : <span />}
          {next ? <Link href={localizedPath(docsHref(next.slug), locale)} rel="next"><small>{chrome.next}</small>{next.title[locale]}</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}

function Block({ block, locale }: { block: DocBlock; locale: PublicLocale }) {
  switch (block.kind) {
    case "p":
      return <p>{block.text[locale]}</p>;
    case "steps":
      return <ol>{block.items[locale].map((item) => <li key={item}>{item}</li>)}</ol>;
    case "list":
      return <ul>{block.items[locale].map((item) => <li key={item}>{item}</li>)}</ul>;
    case "note":
      return <div className="docs-note" data-tone={block.tone} role="note"><p>{block.text[locale]}</p></div>;
    case "facts":
      return (
        <dl className="docs-facts">
          {block.items[locale].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      );
    case "table":
      return (
        <div className="docs-table-wrap">
          <table>
            <thead><tr>{block.head[locale].map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
            <tbody>{block.rows[locale].map((row) => <tr key={row.join("|")}>{row.map((cell, index) => <td key={`${index}-${cell}`}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "product-pages":
      return <ProductPagesTable locale={locale} />;
    case "links":
      return (
        <ul className="docs-links">
          {block.items.map((item) => <li key={item.href}><Link href={localizedPath(item.href, locale)}>{item.label[locale]}</Link></li>)}
        </ul>
      );
  }
}

/** The pages of the menu, from the registry — the menu's own truth, and nothing it does not draw. */
function ProductPagesTable({ locale }: { locale: PublicLocale }) {
  const chrome = CHROME[locale];
  return (
    <div className="docs-table-wrap">
      <table className="docs-pages">
        <thead><tr>{chrome.pagesHead.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
        <tbody>
          {PRODUCT_PAGES.map((page, index) => {
            const doc = DOC_PAGES.find((item) => item.pageId === page.id && item.group !== "reference");
            /* The section is named once, on its first page: four rows of «Портфель» read as noise. */
            const first = index === 0 || PRODUCT_PAGES[index - 1].section !== page.section;
            return (
              <tr key={page.id} data-group-start={first ? "" : undefined}>
                <td>{first ? page.sectionLabel[locale] : null}</td>
                <td>{doc ? <Link href={localizedPath(docsHref(doc.slug), locale)}>{page.label[locale]}</Link> : page.label[locale]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The hub's index: every group with its pages, as cards. */
function DocsIndex({ locale }: { locale: PublicLocale }) {
  const chrome = CHROME[locale];
  return (
    <section className="docs-index" aria-label={chrome.browse}>
      <h2>{chrome.browse}</h2>
      {DOC_NAV.filter((group) => group.id !== "start" || group.items.length > 1).map((group) => (
        <div className="docs-index-group" key={group.id}>
          <h3>{group.title[locale]}</h3>
          <ul>
            {group.items.filter((item) => item.href !== "/docs").map((item) => (
              <li key={item.href}>
                <Link href={localizedPath(item.href, locale)}><strong>{item.title[locale]}</strong><span>{item.summary[locale]}</span></Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/* ----------------------------------------------------------- developers */

const DEVELOPER_COPY = {
  en: {
    title: "Build from explicit contracts.",
    lead: "Two ways in: run the open repository, or call Agent Control. Ryntra clients do not hold keys, sign transactions or turn missing evidence into a result.",
    source: "Open source",
    sourceBody: "The public repository: what is open, how to run it and what it does not claim.",
    sourceOpen: "Open the repository page",
    agent: "Agent Control",
    agentBody: "Typed client methods for public inspection, deterministic preflight and preview verification.",
    open: "Open reference",
  },
  uk: {
    title: "Будуй на явних контрактах.",
    lead: "Два входи: запустити відкритий репозиторій або викликати Agent Control. Клієнти Ryntra не зберігають ключів, не підписують транзакцій і не перетворюють відсутніх доказів на результат.",
    source: "Відкритий код",
    sourceBody: "Публічний репозиторій: що відкрито, як запустити і чого він не стверджує.",
    sourceOpen: "Відкрити сторінку репозиторію",
    agent: "Agent Control",
    agentBody: "Типізовані клієнтські методи для публічного читання, детермінованого preflight і перевірки preview.",
    open: "Відкрити довідку",
  },
} as const;

const AGENT_OPERATIONS = [
  ["POST", "/api/agents/demo", "Read a bounded demonstration payload"],
  ["POST", "/api/agents/passport", "Inspect one registered agent passport"],
  ["POST", "/api/agents/preflight", "Evaluate an action intent before authorization"],
  ["POST", "/api/agents/verify", "Verify an Action Passport preview"],
  ["GET", "/api/agents/agent-launch/tokens", "List the fixed public token source"],
  ["GET", "/api/agents/agent-launch/tokens/{address}", "Read one token from that source"],
  ["POST", "/api/agents/bnb-apex/observe", "Observe one known-reference BSC Testnet job"],
] as const;

function DeveloperOverview({ locale }: { locale: PublicLocale }) {
  const copy = DEVELOPER_COPY[locale];
  return (
    <>
      <header className="docs-hero">
        <p className="docs-crumbs"><Link href={localizedPath("/docs", locale)}>{CHROME[locale].documentation}</Link><span aria-hidden>/</span><span>{GROUP_TITLES.developers[locale]}</span></p>
        <h1>{copy.title}</h1>
        <p className="docs-lead">{copy.lead}</p>
      </header>
      <div className="docs-reference-list">
        <section><h2>{copy.source}</h2><p>{copy.sourceBody}</p><Link href={localizedPath("/developers", locale)}>{copy.sourceOpen}</Link></section>
        <section><h2>{copy.agent}</h2><p>{copy.agentBody}</p><Link href="/docs/developers/agent-control">{copy.open}</Link></section>
      </div>
    </>
  );
}

/** The trail above every developer reference: Documentation / Developers. */
export function DeveloperReferenceCrumbs({ locale }: { locale: PublicLocale }) {
  return (
    <p className="docs-crumbs"><Link href={localizedPath("/docs", locale)}>{CHROME[locale].documentation}</Link><span aria-hidden>/</span><Link href="/docs/developers">{GROUP_TITLES.developers[locale]}</Link></p>
  );
}

function AgentControlReference({ locale }: { locale: PublicLocale }) {
  const uk = locale === "uk";
  return (
    <>
      <header className="docs-hero">
        <DeveloperReferenceCrumbs locale={locale} />
        <h1>Agent Control</h1>
        <p className="docs-lead">{uk ? "Публічний клієнт читає, виконує детермінований preflight і перевіряє preview. Він не має методу для гаманця, підпису, фінансування, торгівлі чи settlement." : "The public client reads, runs deterministic preflight and verifies previews. It has no wallet, signing, funding, trading or settlement method."}</p>
      </header>
      <section className="docs-section">
        <h2>{uk ? "TypeScript-клієнт" : "TypeScript client"}</h2>
        <p><code>@ryntra/action-evidence-sdk</code></p>
        <pre><code>{`const client = new RyntraAgentControlClient({\n  baseUrl: "https://ryntra.io",\n  timeoutMs: 8_000,\n});\n\nconst preview = await client.preflight({ intent });\nconst check = await client.verifyActionPassportPreview(preview.passport);`}</code></pre>
        <p>{uk ? "Клієнт відхиляє redirects, обмежує час і розмір відповіді та перевіряє ідентичність відповіді перед поверненням даних." : "The client refuses redirects, bounds time and response size, and validates response identity before returning data."}</p>
      </section>
      <section className="docs-section">
        <h2>{uk ? "HTTP-операції" : "HTTP operations"}</h2>
        <p><code>openapi/ryntra-agent-control-v0.yaml</code></p>
        <div className="docs-table-wrap"><table><thead><tr><th>{uk ? "Метод" : "Method"}</th><th>{uk ? "Шлях" : "Path"}</th><th>{uk ? "Призначення" : "Purpose"}</th></tr></thead><tbody>{AGENT_OPERATIONS.map(([method, path, purpose]) => <tr key={path}><td><code>{method}</code></td><td><code>{path}</code></td><td>{purpose}</td></tr>)}</tbody></table></div>
      </section>
      <section className="docs-section">
        <h2>{uk ? "Локальний MCP" : "Local MCP"}</h2>
        <p>{uk ? "Локальний stdio-сервер запускається з репозиторію. Пакет MCP не опублікований у npm." : "The local stdio server runs from the repository. The MCP package is not published to npm."}</p>
        <pre><code>node packages/agent-control-mcp/src/stdio.ts</code></pre>
      </section>
    </>
  );
}
