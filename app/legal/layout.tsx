import type { Metadata } from "next";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "@/app/site/frozen/bridge.css";
import { CONTACTS, contactMailto } from "@/lib/site/contacts";
import { publicServerLocale } from "@/lib/site/server-locale";

export const metadata: Metadata = {
  title: { default: "Legal — Ryntra", template: "%s — Ryntra" },
  robots: { index: true, follow: true },
};

/**
 * The legal documents, inside the same shell as the rest of the site.
 *
 * They used to render a third chrome — a light theme, an icon-plus-wordmark
 * logo with a "Legal" pill, a two-item nav and a footer of their own — which
 * made them read as a separate site a visitor had been handed off to. That is
 * the split-personality pattern the design bar names outright, and it is worst
 * exactly here: the pages that have to look trustworthy are the ones that
 * should look most like the product.
 *
 * The document typography is unchanged. `.legal` was already written against
 * the canon tokens, so dropping the forced light theme is what darkens it —
 * the measure, the hairline section rules and the reading sizes all stay.
 *
 * Nothing in the documents themselves is touched by this file. Their wording is
 * legal content and moves only through its own reviewed task.
 */
export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  /* The published documents are English until a lawyer gives the Ukrainian
     text; the chrome and this line follow the reader's language, and the
     review candidates render in it (the new site of canon v5.5). */
  const locale = await publicServerLocale();
  return (
    <div className="rx public-info-surface">
      <MarkDefs />
      <PublicHeader mainId="main-content" locale={locale} />

      <main id="main-content" className="bg-wrap legal-wrap" tabIndex={-1}>
        {/* The documents are English; a part written in the reader's language marks its own `lang`. */}
        <article className="legal" lang="en">{children}</article>
        <p className="legal-contact">
          {locale === "uk" ? "Питання щодо цих документів:" : "Questions about these documents:"} <a href={contactMailto()}>{CONTACTS.email}</a>
        </p>
      </main>

      <FrozenFooter locale={locale} />
    </div>
  );
}
