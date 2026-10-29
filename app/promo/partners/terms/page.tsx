import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import { isPublicLocale, normalizePublicLocale, PUBLIC_LOCALE_COOKIE, type PublicLocale } from "@/lib/site/locale";

import styles from "./terms.module.css";
import { termsCopy } from "./terms-copy";

/**
 * `/promo/partners/terms` — the public Terms of the creator partner
 * programme: shares, term, cap, attribution, states and payouts, versions,
 * what is not allowed, the advertising label; taxes are the recipient's.
 *
 * A document, not a gate: it asks nothing of whoever opens it, names no
 * country and limits nobody. Its language is the address's (`?lang=uk`),
 * else the one the reader chose on this site — so a link in either language
 * can be shared as it is.
 */

export const dynamic = "force-dynamic";

const PATH = "/promo/partners/terms";

type Search = Promise<Record<string, string | string[] | undefined>>;

async function localeOf(searchParams: Search): Promise<PublicLocale> {
  const asked = (await searchParams).lang;
  if (typeof asked === "string" && isPublicLocale(asked)) return asked;
  return normalizePublicLocale((await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value);
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const locale = await localeOf(searchParams);
  const words = termsCopy(locale);
  return {
    title: { absolute: words.metaTitle },
    description: words.metaDescription,
    alternates: { canonical: `${PATH}?lang=${locale}`, languages: { en: `${PATH}?lang=en`, uk: `${PATH}?lang=uk` } },
  };
}

export default async function PartnerTermsPage({ searchParams }: { searchParams: Search }) {
  const locale = await localeOf(searchParams);
  const words = termsCopy(locale);
  return (
    <div className="rx" data-ry-ground="midnight">
      <MarkDefs />
      <PublicHeader locale={locale} mainId="main" ctaTone="quiet" languageHrefs={{ en: `${PATH}?lang=en`, uk: `${PATH}?lang=uk` }} />
      <main id="main" className={`rx-shell ${styles.page}`} lang={locale === "uk" ? "uk" : "en"}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>{words.eyebrow}</span>
          <h1 className={styles.title}>{words.title}</h1>
          <p className={styles.promise}>{words.promise}</p>
          <p className={styles.version}>{words.version}</p>
        </header>

        <div className={styles.layout}>
          <nav className={styles.contents} aria-label={words.contents}>
            <span className={styles.contentsTitle}>{words.contents}</span>
            <ol>
              <li>
                <a href="#rates">{words.ratesTitle}</a>
              </li>
              {words.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className={styles.body}>
            <p className={styles.intro}>{words.intro}</p>

            <section id="rates" className={styles.section} aria-labelledby="rates-title">
              <h2 id="rates-title">{words.ratesTitle}</h2>
              <table className={styles.rates}>
                <thead>
                  <tr>
                    <th scope="col">{words.ratesHead.partner}</th>
                    <th scope="col">{words.ratesHead.share}</th>
                    <th scope="col">{words.ratesHead.when}</th>
                  </tr>
                </thead>
                <tbody>
                  {words.rates.map((rate) => (
                    <tr key={`${rate.partner}:${rate.when}`}>
                      <th scope="row">{rate.partner}</th>
                      <td className={styles.share}>{rate.share}</td>
                      <td>{rate.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {words.sections.map((section) => (
              <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                {section.lines.length === 1 ? (
                  <p>{section.lines[0]}</p>
                ) : (
                  <ul>
                    {section.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <div className={styles.actions}>
              <Link className="rx-btn rx-btn--primary" href="/app/rewards/partners" prefetch={false}>
                {words.cta}
              </Link>
              <Link className="rx-btn rx-btn--ghost" href="/app/rewards/partners/kit" prefetch={false}>
                {words.kit}
              </Link>
            </div>
          </article>
        </div>
      </main>
      <FrozenFooter locale={locale} />
    </div>
  );
}
