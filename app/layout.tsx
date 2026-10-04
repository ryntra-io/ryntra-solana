import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PUBLIC_LOCALE_COOKIE, normalizePublicLocale } from "@/lib/site/locale";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
/* The DESIGN.md projection loads first; globals.css re-resolves the legacy
   names onto it (the site rung of the migration ladder). */
import "./design/tokens.css";
import "./globals.css";
import { HOMEPAGE_CATEGORY, HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { ALL_LOCALES, SITE, SEO_COPY } from "./seo";
import { CONTACTS, ORGANIZATION_PROFILES } from "@/lib/site/contacts";
import { THEME_BOOT_SCRIPT } from "@/app/app/theme";

/**
 * The brand faces, loaded once at the root — the brand book v1.0
 * (2026-09-11): Geist for the interface, Geist Mono for every figure, hash
 * and address, Unbounded only as the public landing's display accent. Both
 * interface faces ship the Cyrillic subset.
 *
 * The CSS variable names are historical and carry the current faces:
 * `--font-geist` / `--font-geist-mono` feed `--ry-font-sans` / `--ry-font-mono`
 * in the token projection; `--font-inter` / `--font-jbmono` are the same two
 * faces under the names three legacy sheets still read; `--font-sora` is the
 * display accent. A nested route segment may still load its own variable
 * inside its subtree; this is the floor beneath them.
 *
 * ABC Diatype is the preferred face and needs a licence — when it
 * arrives, `--ry-font-sans` in app/design/tokens.css is the one line that
 * changes.
 */
const geist = Geist({ subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], display: "swap", variable: "--font-geist-mono" });
const sora = Unbounded({ subsets: ["latin"], weight: ["400", "600", "700"], display: "swap", variable: "--font-sora" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: SEO_COPY.en.title,
  description: HOMEPAGE_COPY.en.description,
  applicationName: "Ryntra",
  category: HOMEPAGE_CATEGORY,
  creator: "Ryntra",
  publisher: "Ryntra",
  robots: { index: true, follow: true },
};

// Capability claims are emitted by the hourly-revalidated landing routes, not
// by this static root layout. This global graph carries only stable product facts.
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": SITE + "/#organization",
    name: "Ryntra",
    url: SITE,
    /* The logo a search engine may show beside the name: the R on the dark
       tile at 512 px — a square raster, which is what the logo guidelines
       ask for; the SVG favicon is too small a promise for a knowledge panel.
       The wordmark is the `image`. */
    logo: SITE + "/brand/icon-512.png",
    image: SITE + "/brand/ryntra-wordmark-dark.png",
    slogan: HOMEPAGE_COPY.en.tagline,
    description: HOMEPAGE_COPY.en.description,
    email: CONTACTS.email,
    /* The identities Ryntra actually posts from. The retired Telegram channel
       outlived its removal from every visible surface here, because `sameAs` is
       the one place a claim about who Ryntra *is* is made to machines rather
       than to readers — and nobody reads it. */
    sameAs: [...ORGANIZATION_PROFILES],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE + "/#website",
    name: "Ryntra",
    url: SITE,
    description: HOMEPAGE_COPY.en.description,
    publisher: { "@id": SITE + "/#organization" },
    inLanguage: [...ALL_LOCALES],
  },

];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = normalizePublicLocale((await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value);
  return (
    <html
      lang={locale}
      dir="ltr"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${sora.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
