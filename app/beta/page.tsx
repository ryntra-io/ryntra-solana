import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "@/app/site/frozen/bridge.css";
import { BETA_COPY } from "@/lib/beta/texts";
import { LINKS } from "@/lib/beta/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Search = { t?: string; lang?: string; auth?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  return {
    title: "Beta Access — Ryntra",
    description: "Free, non-custodial beta access to Ryntra Workspace, the reference client for the Ryntra Evidence Kernel. One confirmation in the Telegram bot opens it; nothing else affects access.",
    robots: sp.t || sp.auth ? { index: false, follow: false } : { index: true, follow: true },
    alternates: { canonical: "https://ryntra.io/beta" },
  };
}

/**
 * Public beta entry copy, English only.
 *
 * It is deliberately NOT taken from `lib/beta/texts.ts`. That dictionary is the
 * bot's and is localised for the bot's own audience, while this page is English-only.
 *
 * Both now say the same thing, which was not true before RYN-BETA-001: one
 * confirmation in the bot opens the product, and nothing else affects access.
 * The old three-task checklist and its six-rung ladder are gone from every surface,
 * because only one of the three ever did anything.
 *
 * Two guarantees are carried over verbatim from the bot dictionary because they
 * are claim-reviewed and must not drift: the trust bullets and the
 * expired-link recovery line.
 */
const PAGE = {
  eyebrow: "FREE BETA ACCESS",
  title: "One confirmation. That is the whole gate.",
  lead: "Open the Telegram bot and confirm. That is what opens the product — there is no email, no password, no card, and nothing to deposit.",
  cta: "Open the Telegram bot",
  ctaNote: "Free during beta · Non-custodial · No deposits",
  afterTitle: "What happens after you open it",
  after: [
    {
      h: "You confirm, once",
      p: "The bot explains what confirming means, then you press one button. That single confirmation is what opens the product — nothing else on this page or in the bot gates access.",
    },
    {
      h: "Confirming gives Ryntra nothing",
      p: "No custody, no keys, no permission to move anything. It records that you asked for access, and that is all it does.",
    },
    {
      h: "Everything else is optional",
      p: "Following on X, joining the Telegram channel, using Arcus and adding a wallet address are all optional. None of them affects access, priority, or any reward — there is no token, no points, and no reward programme.",
    },
  ],
} as const;

export default async function BetaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  if (sp.t) {
    const params = new URLSearchParams({ t: sp.t, next: "/app/beta" });
    if (sp.lang) params.set("lang", sp.lang);
    redirect(`/api/session?${params.toString()}`);
  }

  /* Two guarantees are read from the bot dictionary so they stay identical in both places,
     but always from the English entry. The bot still sends `lang`, and honouring it here
     would render Cyrillic trust bullets and recovery copy on a public page that is
     English-only by contract. `lang` continues to ride along to /api/session above, where
     the signed-in surfaces do localise. */
  const bot = BETA_COPY.en;
  const authRefresh = sp.auth === "refresh";

  return (
    <div className="rx public-info-surface">
            <MarkDefs />
      <PublicHeader mainId="main-content" />

      <main id="main-content" className="bg-wrap" tabIndex={-1}>
        <section className="bg-hero">
          <p className="bg-eyebrow">{PAGE.eyebrow}</p>
          <h1 className="bg-status-name">{PAGE.title}</h1>
          <p className="bg-hint">{PAGE.lead}</p>

          {authRefresh ? (
            <p className="bg-auth-notice" role="status">{bot.authRecovery}</p>
          ) : null}

          <div className="bg-cta-row">
            <a href={LINKS.bot} target="_blank" rel="noreferrer" className="btn btn-primary">
              {PAGE.cta}
            </a>
          </div>
          <p className="bg-cta-note">{PAGE.ctaNote}</p>
        </section>

        {/* Not a checklist. These describe what the bot does next, so nobody has
            to work out which of several tasks is the one that matters. */}
        <section className="bg-after" aria-label={PAGE.afterTitle}>
          <h2 className="bg-h2">{PAGE.afterTitle}</h2>
          <ol>
            {PAGE.after.map((item, i) => (
              <li key={item.h}>
                <span className="bg-num" aria-hidden>{i + 1}</span>
                <span>
                  <strong>{item.h}</strong>
                  <span>{item.p}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-trust">
          {bot.pageTrust.map((t, i) => (
            <div key={i} className="bg-trust-item">
              <span className="bg-trust-dot" aria-hidden />
              {t}
            </div>
          ))}
        </section>
      </main>

      <FrozenFooter />
    </div>
  );
}
