import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import type { PublicLocale } from "@/lib/site/locale";
import { Hero } from "./hero";
import { LANDING_PATH } from "./landing-copy";
import { AutoinvestSection, OnYourPhone, Questions, Security, Today, WhatYouBuy } from "./landing-blocks";
import { Universe } from "./universe";
import { Rewards } from "./rewards";
import { Workflow } from "./workflow";
import styles from "./landing.module.css";

/**
 * The public homepage — the landing, in the words of the new site.
 *
 * The hero
 * drawn in code, the market universe with Solana at its centre («Wall Street
 * closes. Solana doesn't.»), the workflow on its pinned stage, and Rewards
 * with the close, the site's footer folded into the same ground. The new
 * site of 2026-09-26 keeps every one of them and changes what they say — a
 * piece of a company from $1 in your own wallet, one action «Відкрити
 * застосунок», the workflow as the purchase's own road — and adds, in the same
 * design, «Автоінвест», what you buy with the company's path, the phone,
 * security, where Ryntra is today and the questions people ask first.
 *
 * English at `/`, Ukrainian at `/uk`: the address decides the language
 * (`page.tsx`, `uk/page.tsx`), and the header's language menu moves between
 * the two. One chrome on every page: the header carries the site's one menu,
 * the language menu and the theme switch here as everywhere, wearing the
 * landing's look; the blocks are drawn on the landing's own ink
 * and ground tokens (`landing.module.css`), so the light theme is the same
 * drawing on a light ground.
 *
 * Two rules hold the page together: every status is projected from the
 * product registry, so nothing planned can render as available; and every
 * word comes from `HOMEPAGE_COPY` (the original four blocks) or
 * `landing-copy.ts` (the new ones), each tied by its test to what production
 * does.
 */
export function Homepage({ locale = "en" }: { locale?: PublicLocale }) {
  return (
    <div lang={locale} className={styles.root}>
      <MarkDefs />
      {/* The hero's «Відкрити застосунок» is the screen's one orange action; the header's stays quiet. */}
      <PublicHeader locale={locale} mainId="main-content" landing ctaTone="quiet" languageHrefs={LANDING_PATH} homeHref={LANDING_PATH[locale]} />
      <main id="main-content" className={styles.page} tabIndex={-1}>
        <Hero locale={locale} />
        <Universe locale={locale} />
        <Workflow locale={locale} />
        <AutoinvestSection locale={locale} />
        <WhatYouBuy locale={locale} />
        <OnYourPhone locale={locale} />
        <Security locale={locale} />
        <Today locale={locale} />
        <Questions locale={locale} />
        <Rewards locale={locale} />
      </main>
      <FrozenFooter locale={locale} landing />
    </div>
  );
}
