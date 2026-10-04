"use client";

import { useEffect } from "react";
import { Check, X } from "@phosphor-icons/react";
import { track } from "@/lib/analytics";
import type { LandingPublicModel } from "@/lib/product/public-capability-view";
import { SiteFooter, SiteHeader } from "@/app/components/site-chrome";
import type { Lang } from "./config/features";
import { localeDir } from "./i18n";
import type { HomeCopy } from "./landing/content";
import type { RavenCopy } from "./landing/raven-copy";
import { RavenCapabilities } from "./landing/raven-capabilities";
import { RavenHero } from "./landing/raven-hero";
import { isHomeCardConfirmed, publicMaturity } from "./landing/home-truth";
import { RavenScanner } from "./landing/raven-scanner";
import { MarketsStrip } from "./landing/markets-strip";
import { RavenMarkets } from "./landing/raven-markets";
import { RavenLoop } from "./landing/raven-loop";
import { RavenPrinciples } from "./landing/raven-principles";
import { RavenClose } from "./landing/raven-close";
import { RavenRoadmap } from "./landing/raven-roadmap";
import { RavenReveal } from "./landing/raven-reveal";
import "./landing/landing.css";
import "./landing/raven.css";

/**
 * PARKED — this component is no longer mounted on any route.
 *
 * The public homepage moved to `app/site/` with the site redesign. Superseded
 * work is kept in source rather than deleted, so this landing and everything
 * under `app/landing/` stay here, intact and translated, and can be restored
 * by pointing `app/page.tsx` back at them.
 *
 * Do not treat an assertion against this file as evidence about the live
 * homepage. Tests that guard what a visitor actually sees read `app/site/`.
 */

/**
 * The primary call to action opens our own access page, not the messenger.
 * An anonymous visitor never reaches the working terminal: app/robinhood/workspace/swap
 * redirects to /beta, while app/app/layout renders an onboarding gate in place
 * of the cabinet. So a button promising the app would break its promise on the
 * first click, and one pointing straight at Telegram would move a visitor off
 * the product before they see that it is real. /beta shows the live terminal
 * exists, explains entry and guarantees nothing.
 *
 * The analytics event name stays `telegram_cta_click`: it is persisted in the
 * track route and admin schema, and renaming it would break historical data
 * for no product gain.
 */
const BETA_HREF = "/beta";

/**
 * "How it works" points at the decision loop, because that section is the
 * answer: it draws plan → prove → improve as one closed circuit. The nav used
 * to point at `#how`, an id no section ever rendered, so the link silently did
 * nothing on every locale. `lib/landing-nav.test.mjs` now fails if any nav
 * anchor names a section the page does not mount.
 */
const HOW_HREF = "#loop";

/**
 * Reveal-on-scroll as progressive enhancement. The markup ships visible; the
 * hidden start state is switched on (html.rv) only once the observer is really
 * running, so a blocked or failed script leaves a readable page rather than a
 * blank one below the fold.
 */
function useReveals() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = document.querySelectorAll<HTMLElement>(".lp2-rv, .lp2-stagger");
    if (!nodes.length) return;
    const root = document.documentElement;
    if (typeof IntersectionObserver === "undefined") {
      root.classList.remove("rv");
      return;
    }

    let io: IntersectionObserver | null = null;
    try {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              (entry.target as HTMLElement).classList.add("in");
              observer.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.16 },
      );
      nodes.forEach((node) => observer.observe(node));
      io = observer;
      root.classList.add("rv");
    } catch {
      io?.disconnect();
      root.classList.remove("rv");
      return;
    }

    return () => {
      io?.disconnect();
      root.classList.remove("rv");
    };
  }, []);
}

export default function HomeClient({
  lang,
  model,
  raven,
  copy,
}: {
  lang: Lang;
  model: LandingPublicModel;
  /**
   * Every block's copy for this locale, resolved on the server.
   *
   * The dictionary behind it holds three locales of nine blocks. Importing it
   * here would put all three in the browser bundle, which is what pushed `/`
   * past its size budget while the middle of the page was being rebuilt. The
   * strings a visitor sees are identical either way.
   */
  raven: RavenCopy;
  /** Resolved on the server, for the same bundle reason as `raven`. */
  copy: HomeCopy;
}) {
  const methodologyHref = lang === "en" ? "/methodology" : `/${lang}/methodology`;

  // Fail-closed product truth: every "works today" card is bound to a registry
  // capability through the pure rules in landing/home-truth.ts.
  const capabilityById = new Map<string, (typeof model.capabilities)[number]>(
    model.capabilities.map((capability) => [capability.id, capability]),
  );
  const cardStates = copy.cards.map((card) => {
    const capability = capabilityById.get(card.capabilityId);
    const maturity = publicMaturity(card.capabilityId, capability);
    return {
      card,
      confirmed: isHomeCardConfirmed(card.capabilityId, capability),
      // Resolved from the registry, never authored: a block cannot advertise a
      // maturity the product has not reached.
      maturityLabel: maturity ? copy.maturity[maturity] : copy.maturity.unverified,
      maturityKey: maturity ?? "unverified",
    };
  });
  const anyCardDegraded = cardStates.some((state) => !state.confirmed);
  const spotRouteConfirmed = cardStates.find((state) => state.card.capabilityId === "arcus-spot-rfq")?.confirmed ?? false;

  useReveals();

  /* The motion-preference listener that used to live here was dead: it tracked
     a value nothing read, because each demonstration block now watches the
     query itself and decides what "still" means for its own content. Keeping a
     second, unused source of the same preference invites the two to disagree. */

  const scannerMaturity = publicMaturity("risk-readiness-scanner", capabilityById.get("risk-readiness-scanner"));
  // Still resolved with no block previewing it: the roadmap milestone for the
  // personal workspace reads its status from here, so the capability stays
  // visible on the page without being illustrated.
  const workspaceMaturity = publicMaturity("personal-workspace", capabilityById.get("personal-workspace"));

  /**
   * One resolved maturity map, shared by every block that badges a capability.
   *
   * Built once rather than per section so the roadmap, the decision loop and
   * the capability rows cannot disagree about the same id — the exact drift
   * that put "Next" and "In build" on the scanner at the same time.
   *
   * An unconfirmed capability resolves to `unverified` whatever its badge would
   * otherwise say: the fail-closed rule the cards already carried, applied to
   * everything that reads from here.
   */
  const registryMaturity: Record<string, string> = Object.fromEntries([
    ...cardStates.map(({ card, confirmed, maturityKey }) => [
      card.capabilityId,
      confirmed ? maturityKey : "unverified",
    ]),
    ["risk-readiness-scanner", scannerMaturity ?? "unverified"],
    ["personal-workspace", workspaceMaturity ?? "unverified"],
  ]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = localeDir(lang);
  }, [lang]);

  /* The dismiss-on-outside-click, Escape handling and locale switching moved
     into the shared chrome with the header itself — they belong to the control
     they close, not to the page around it. */

  return (
    <div className="lp-root" lang={lang} dir={localeDir(lang)}>
      {/* One chrome for every public page — see app/components/site-chrome.tsx.
          Only the link targets differ between the landing and methodology. */}
      <SiteHeader
        lang={lang}
        page="landing"
        homeHref="#top"
        betaHref={BETA_HREF}
        nav={[
          { href: "#now", label: copy.nav.now },
          { href: HOW_HREF, label: copy.nav.how },
          { href: "#trust", label: copy.nav.trust },
          { href: methodologyHref, label: copy.nav.methodology },
        ]}
        labels={{
          beta: copy.nav.beta,
          primary: copy.primary,
          menu: copy.nav.menu,
          language: copy.nav.language,
          skip: copy.skip,
        }}
      />


      <RavenReveal />

      <main id="main-content" tabIndex={-1}>
        <RavenHero
          copy={raven.hero}
          routeConfirmed={spotRouteConfirmed}
          betaHref={BETA_HREF}
          onPrimary={() => track("telegram_cta_click", "hero", lang)}
        />

        <MarketsStrip copy={copy} routeConfirmed={spotRouteConfirmed} />

        {/* What you can do now. The four reachable capabilities, each openable
            to the evidence behind its badge. Maturity and the confirmed flag
            both arrive resolved from the registry — this block authors neither. */}
        <RavenCapabilities
          copy={raven.caps}
          rows={cardStates.map(({ card, confirmed, maturityLabel, maturityKey }) => ({
            capabilityId: card.capabilityId,
            n: card.n,
            h: card.h,
            p: card.p,
            maturityLabel,
            maturityKey,
            confirmed,
          }))}
        />

        {/* Method demonstration for an unreleased capability. The badge still
            comes from the registry and the values are still fixed samples, so
            the block shows how risk is read without implying a working tool. */}
        <RavenScanner
          copy={raven.scanner}
          maturityKey={scannerMaturity ?? "unverified"}
          maturityLabel={scannerMaturity ? copy.maturity[scannerMaturity] : copy.maturity.unverified}
        />

        {/* The decision loop. Each stage inherits its badge from the registry,
            so the diagram shows three working stages and two that are not —
            drawing a complete circuit would claim `complete-decision-loop`,
            which the registry marks `planned`. */}
        <RavenLoop copy={raven.loop} maturityById={registryMaturity} maturityLabels={copy.maturity} />

        {/* The workspace preview that used to sit here is deliberately absent.
            A mocked-up terminal on the landing page is a promise the product
            has not earned yet: the real instruments are being built inside the
            app, and this block will return as screenshots of the working thing
            rather than as an illustration of it. The roadmap still carries the
            milestone, so the capability is visible without being previewed. */}

        {/* Coverage. States the permission per asset class rather than a count:
            "37 markets" flatters; what the venue actually grants is "read the
            online market feed, move money on three proven routes". The feed is
            bounded — the endpoint returns only markets Arcus reports ONLINE. */}
        <RavenMarkets copy={raven.markets} items={copy.coverage} roleLabels={copy.coverageRoles} />

        {/* Principles. Every claim arrives from HOME_COPY unchanged, including
            the proof column: a real swap that finished, with its size, fee,
            authorisation and result. That column is why the rules read as
            commitments, so it sits beside them rather than in a footnote. */}
        <RavenPrinciples
          copy={raven.principles}
          rules={copy.trustCards}
          methodologyHref={methodologyHref}
          methodologyLabel={copy.methodologyLink}
          proof={{
            kicker: copy.proofKicker,
            title: copy.proofTitle,
            rows: copy.proofRows,
            status: copy.proofStatus,
            note: copy.proofNote,
          }}
          fine={[copy.fineGeo, copy.fineAdvice]}
        />

        {/* Contrast block. Deliberately carries no maturity badge: every claim on
            the right is live today, so an aspirational line would not belong here. */}
        <section className="lp2-block lp4-principles-block" id="principles">
          <div className="container">
            <div className="lp2-rv">
              <span className="lp-eyebrow">{copy.principlesKicker}</span>
              <h2>{copy.principlesTitle}</h2>
              <p className="lp2-lead">{copy.principlesLead}</p>
            </div>
            <div className="lp4-principles-head" aria-hidden>
              <span>{copy.principlesThemLabel}</span>
              <span>{copy.principlesUsLabel}</span>
            </div>
            <ul className="lp4-principles lp2-stagger">
              {copy.principles.map((pair) => (
                <li className="lp4-pair" key={pair.us}>
                  <span className="lp4-them">
                    <X size={13} weight="bold" aria-hidden />
                    <s>{pair.them}</s>
                  </span>
                  <span className="lp4-link" aria-hidden />
                  <span className="lp4-us">
                    <Check size={13} weight="bold" aria-hidden />
                    {pair.us}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Roadmap. Milestone status is resolved from the capability registry,
            so a milestone cannot light before the product ships it. It closes
            the middle of the page: what works now was the first block, what is
            ahead is the last, and the CTA follows the honest answer. */}
        <RavenRoadmap copy={raven.roadmap} degraded={anyCardDegraded} maturityById={registryMaturity} />

        <RavenClose
          copy={raven.close}
          betaHref={BETA_HREF}
          methodologyHref={methodologyHref}
          onPrimary={() => track("telegram_cta_click", "close", lang)}
        />

      </main>

      <SiteFooter
        tagline={copy.footerTag}
        fineAdvice={copy.fineAdvice}
        boundary={copy.footerBoundary}
        terms={copy.terms}
        privacy={copy.privacy}
      />
    </div>
  );
}
