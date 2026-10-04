import Link from "next/link";
import {
  ArrowUpRight,
  Cube,
  Database,
  ShieldCheck,
  SquaresFour,
  TrendDown,
  Vault,
} from "@phosphor-icons/react/dist/ssr";

import { SiteFooter, SiteHeader } from "./chrome";
import { AccessGlyph } from "./glyphs";
import { BETA_CTA_LABEL, BETA_HREF, DOCS_HREF, GUARD_HREF } from "./nav";
import { Section, StatePill, StatedGap } from "./parts";
import { ProductWalk } from "./product-walk";
import { LifecycleBanner } from "./banner";
import type { SiteTruth } from "./truth-view";

/**
 * The Ryntra homepage.
 *
 * It answers, in this order: what do I get, how does it work, where do I use
 * it, why should I trust it, what proves it, and how do I start. Six sections
 * and one hero.
 *
 * The version this replaces had twelve, and every one of them was individually
 * correct: four capability accordions, a full sample scanner, the eight-stage
 * Decision Circuit, a coverage table, a principles manifest, a field-by-field
 * execution receipt, a `what we refuse to build` list, the roadmap, a research
 * chapter and two calls to action. The sum asked a first-time visitor to read a
 * technical document before learning what the product is for. Depth did not
 * disappear — it moved to `/docs` and `/developers`, where a reader who wants
 * it is already asking for it.
 *
 * Four rules hold the page together, and all four are inherited because they
 * are what stops a shorter page from becoming a less honest one.
 *
 *   1. Every maturity badge resolves from the capability registry on the
 *      server. This file has no vocabulary for "live" and cannot invent one.
 *   2. No proof value is typed into this page. There are no sample hashes on
 *      it.
 *   3. An artifact that does not exist renders as prose stating why, never as a
 *      control a reviewer can press.
 *   4. A card binds to one capability — or, where it spans several, to the
 *      weakest of them. A section that averages five capabilities into one
 *      confident badge is how two paper features end up advertised alongside
 *      three live ones under a single green pill.
 */

/** The product's trust line, in the order it is always written. */
const TRUST_RAIL = [
  "Non-custodial",
  "Paper-first",
  "Human-authorized",
  "No profit promises",
] as const;

/**
 * A registry scope, only when it reads as one.
 *
 * Scope strings are machine-shaped by design — `future-supported-instruments`
 * is an exact and useful boundary inside the registry. Rendered under a product
 * card on the homepage it reads as a leaked identifier, which costs more trust
 * than the precision buys. So a single hyphenated token is withheld and a real
 * enumeration — words a person reads — is shown. The exact scope of every
 * claim is one click away in the Handbook, where machine shape is the right
 * register.
 */
function readableScope(scope: string | undefined): string | null {
  if (!scope) return null;
  return scope.includes(" ") ? scope : null;
}

export function Home({ truth }: { truth: SiteTruth }) {
  /* The surface this page offers, carrying a state it is not allowed to
     author. The Workspace is a registry surface. */
  const workspace = truth.surfaces.find((surface) => surface.id === "workspace");

  /* The live execution scope, quoted from the registry rather than retyped.
     The hero makes an execution claim, and an execution claim without its exact
     routes is the broadest reading a visitor can take. */
  const liveRows = truth.today.filter((row) => row.state === "live");

  return (
    <div className="rx">
      <SiteHeader page="home" />

      <main id="main" tabIndex={-1}>
        {/* ── Hero ──────────────────────────────────────────────────────────
            One claim, its scope, one action. The previous hero opened with
            `Not another exchange` — negative positioning that explains what
            Ryntra is not and leaves a visitor still asking what it is. */}
        <section className="rx-hero">
          <div className="rx-shell rx-hero-grid">
            <div className="rx-hero-lede">
              <p className="rx-eyebrow">Risk, Strategy &amp; Evidence OS</p>
              {/* Three lines: the plain claim, the brand-gradient line, the
                  quiet close. Verbs with objects — the words are pinned by the
                  site tests precisely because a headline is the first thing a
                  later edit softens. */}
              <h1 className="rx-h1 rx-hero-title">
                Plan the trade. <em>See the risk.</em> <span>Sign it yourself.</span>
              </h1>
              <p className="rx-lead rx-hero-copy">
                A non-custodial workspace for tokenized markets and crypto. Understand the instrument, set
                your limits, check the exact action against live evidence, and keep a record of what
                actually happened.
              </p>

              {/* The boundary sits with the claim it bounds, because `Sign it
                  yourself` is an execution claim and an execution claim without
                  a stated limit is read at its widest.

                  It used to name the three exact route pairs here. That was
                  precise and it was the wrong register for a first screen: it
                  bound the whole brand to one venue and made a reader parse a
                  technical scope before knowing what the product does. The
                  limit stays, the enumeration moved one click away — where it
                  is rendered from the registry rather than retyped. */}
              <p className="rx-hero-scope">
                Wallet-signed execution is live on a bounded set of supported routes. Everything else here
                is read-only, on paper, or still being built, and every card says which.{" "}
                <Link className="rx-link" href={`${DOCS_HREF}#capabilities`}>
                  See what is supported
                </Link>
              </p>

              <ul className="rx-trust">
                {TRUST_RAIL.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <div className="rx-hero-actions">
                <a className="rx-btn rx-btn--primary" href={BETA_HREF}>
                  {BETA_CTA_LABEL}
                  <ArrowUpRight size={15} weight="bold" aria-hidden />
                </a>
                <a className="rx-btn rx-btn--ghost" href="#walkthrough">
                  See how it works
                </a>
              </div>
              {/* The gate is named before the click, not after it — `/beta` is
                  a Telegram confirmation, and a visitor who learns that only on
                  arrival has been sold a product and handed a form. What was
                  three clauses of onboarding mechanics is now one line; the
                  rest belongs on `/beta` itself. */}
              <p className="rx-hero-note">
                Free during beta · One confirmation in Telegram · No email, no password, nothing to deposit
              </p>
            </div>
          </div>
        </section>

        {/* The lifecycle crosses the page as a moving band — proven stages lit,
            the rest dim. It is the argument in one line. */}
        <LifecycleBanner stages={truth.circuit} />

        {/* ── 01 · One decision loop ────────────────────────────────────────
            The walkthrough carries one registry capability per step, so five
            steps that genuinely disagree about their maturity stay disagreeing.
            The eight-stage architecture diagram that used to follow it is in
            the Handbook now: it explains the machine, and this explains the
            person. */}
        <Section
          id="walkthrough"
          index="01"
          kicker="One decision loop"
          meta={`${truth.walkthrough.length} steps · state from the registry`}
          heading="One decision. One evidence trail."
          lead="Understand the instrument, write the plan down, check it against evidence that carries its own freshness, authorize it in your own wallet, and compare the plan with what actually happened. Each step below states its own maturity, because they are not all equally built."
        >
          <div data-rx-reveal="up" tabIndex={-1} className="rx-hero-stage">
            <ProductWalk steps={truth.walkthrough} />
          </div>

          <div className="rx-linkrow">
            <Link className="rx-link" href={`${DOCS_HREF}#methodology`}>
              How the decision system works
            </Link>
            <Link className="rx-link" href={`${DOCS_HREF}#capabilities`}>
              What works today, with its exact scope
            </Link>
          </div>
        </Section>

        {/* ── 02 · Where to use it ──────────────────────────────────────────
            Not a list of chains. Stellar, Base and Solana are registered
            directions with no product behind them, and a card each on the
            homepage would read as several products where there is one. They
            live in the Handbook until one of them has a workspace to open. */}
        <Section
          id="products"
          index="02"
          kicker="Product surface"
          meta="One kernel · one workspace"
          heading="One Ryntra. One place to use it."
          lead="The evidence, policy, authorization and receipt model, reached by a person in one workspace."
        >
          {/* Equal cards read as products from different companies. The
              Workspace is the product, so the layout says so before the copy
              has to. */}
          <div className="rx-surfaces">
            <article
              className="rx-col rx-col--lead"
              id="workspace"
              data-rx-reveal="up"
              data-rx-group="products"
            >
              <span className="rx-col-tag">
                <SquaresFour size={14} weight="bold" aria-hidden />
                For individuals · the main product
              </span>
              <h3 className="rx-h3">Ryntra Workspace</h3>
              {workspace ? <StatePill label={workspace.stateLabel} tone={workspace.tone} /> : null}
              <p>
                Scan a supported market, build a strategy, prepare the trade and review the result — the
                whole decision loop in one place, for tokenized markets and crypto.
              </p>
              {readableScope(workspace?.scope) ? (
                <p className="rx-mono rx-card-scope">{readableScope(workspace?.scope)}</p>
              ) : null}
              <div className="rx-linkrow">
                <a className="rx-btn rx-btn--primary rx-btn--sm" href={BETA_HREF}>
                  {BETA_CTA_LABEL}
                </a>
              </div>
            </article>
          </div>

          {/* The wedge, stated once, where it explains a product decision
              rather than as a chapter of its own. */}
          <p className="rx-closing">
            Built first for tokenized markets, where the token, the underlying asset and the trading venue
            can each follow different rules.
          </p>
        </Section>

        {/* ── 03 · Why Ryntra ───────────────────────────────────────────────
            Four boundaries. The manifesto this replaces ran to a principles
            chapter and a `what we refuse to build` list, and a reader who
            finished both knew no more about what to do next. */}
        <Section
          id="trust"
          index="03"
          kicker="Why Ryntra"
          meta={`${truth.capabilities.length} public claims · reviewed ${truth.registryVerifiedAt}`}
          heading="Four boundaries the product holds."
          lead="Three of them are structural — there is no component that could break them. The fourth is an honest statement about evidence, which is never complete and never permanently fresh."
        >
          <div className="rx-cols rx-cols--quad">
            <div className="rx-col" data-rx-reveal="up" data-rx-group="limits">
              <span className="rx-col-tag">
                <Vault size={14} weight="bold" aria-hidden />
                Non-custodial
              </span>
              <p>
                Your funds and keys stay in your wallet. Ryntra never requests a seed phrase or private
                key, holds no withdrawal authority, and never signs on your behalf.
              </p>
            </div>
            <div className="rx-col" data-rx-reveal="up" data-rx-group="limits">
              <span className="rx-col-tag">
                <ShieldCheck size={14} weight="bold" aria-hidden />
                Human-authorized
              </span>
              <p>
                AI may explain, formalize and compare. It never supplies a missing fact, decides policy,
                authorizes or signs. Deterministic code returns every decision.
              </p>
            </div>
            <div className="rx-col" data-rx-reveal="up" data-rx-group="limits">
              <span className="rx-col-tag">
                <Database size={14} weight="bold" aria-hidden />
                Evidence attached
              </span>
              <p>
                Facts carry a source and a freshness state. Missing, stale or conflicting data is shown as
                such and fails closed — an unknown never renders as a green result.
              </p>
            </div>
            <div className="rx-col" data-rx-reveal="up" data-rx-group="limits">
              <span className="rx-col-tag">
                <TrendDown size={14} weight="bold" aria-hidden />
                Strategy before execution
              </span>
              <p>
                The plan and the risk limits exist before the wallet prompt. Nothing here predicts a market
                or promises a profit.
              </p>
            </div>
          </div>

          {/* The five axes stay, because collapsing them is the specific way a
              missing input disappears from a decision. */}
          {/* One line, not a methodology chapter. The five decision axes, the
              full verdict explanation and the freshness model were here; they
              are the machinery behind this sentence and they now live in
              `/docs/core-principles`, where a reader who wants the machinery is
              already asking for it. */}
          <p className="rx-closing">
            Allowed by policy means the action matched the configured rules against the evidence available
            at that moment. It is not a promise about the outcome.
          </p>

          {truth.anyReVerifying ? (
            <p className="rx-fine" style={{ marginTop: 18 }}>
              <StatedGap>
                Current capabilities are being re-verified: at least one claim has aged past its review
                window and is shown as unverified rather than at its previous confidence.
              </StatedGap>
            </p>
          ) : null}

          <div className="rx-linkrow">
            <Link className="rx-link" href={`${DOCS_HREF}#methodology`}>
              How a decision is evaluated
            </Link>
            <Link className="rx-link" href={`${DOCS_HREF}#security`}>
              Security and boundaries
            </Link>
          </div>
        </Section>

        {/* ── 04 · Proof ────────────────────────────────────────────────────
            One card on the evidence surface. A field-by-field receipt — intent
            id, evidence root, policy digest, fingerprint, both hashes, the fee
            comparison — does not belong here: a homepage that reproduces one
            is asking a first-time visitor to audit a transaction. */}
        <Section
          id="proof"
          index="04"
          kicker="Proof"
          meta="State from the registry"
          paper
          heading="A working product, not a concept."
          lead="One thing exists and can be checked. It is not a reliability claim, and it says where it stops."
        >
          <div className="rx-cols">
            <article className="rx-col" data-rx-reveal="up" data-rx-group="proof">
              <span className="rx-col-tag">
                <Cube size={14} weight="bold" aria-hidden />
                Tokenized market execution
              </span>
              {liveRows.length ? (
                <p>
                  Owner-authorized spot execution is available on supported routes, with the plan written
                  before the wallet prompt and the result reconciled against what was authorized.
                </p>
              ) : (
                <p>
                  <StatedGap>
                    No execution claim is live right now: every route claim has aged past its review window
                    and is shown as unverified rather than at its previous confidence.
                  </StatedGap>
                </p>
              )}
              <div className="rx-linkrow">
                <Link className="rx-link rx-link--paper" href={`${DOCS_HREF}#capabilities`}>
                  See the exact scope
                </Link>
              </div>
            </article>
          </div>
        </Section>

        {/* ── 05 · Start ────────────────────────────────────────────────────*/}
        <Section index="05" kicker="Start" meta="Free during beta" heading="Build the plan before the next action." tight>
          <div className="rx-close" data-rx-reveal="scale">
            <div>
              <p className="rx-body">
                Try the sequence on paper first: understand a supported asset, write a plan, check what is
                missing, and review what happened. Nothing is deposited, and nothing is signed without you.
              </p>
              <div className="rx-close-actions">
                <a className="rx-btn rx-btn--primary" href={BETA_HREF}>
                  {BETA_CTA_LABEL}
                  <ArrowUpRight size={15} weight="bold" aria-hidden />
                </a>
                <a className="rx-btn rx-btn--ghost" href="#walkthrough">
                  See how it works
                </a>
              </div>
              <p className="rx-fine" style={{ marginTop: 20 }}>
                Building a product?{" "}
                <Link className="rx-link" href={GUARD_HREF}>
                  Explore developer tools
                </Link>
              </p>
            </div>
            <div className="rx-close-visual">
              <AccessGlyph />
              <p className="rx-fine">How access opens — nothing else is asked for.</p>
            </div>
          </div>

          <p className="rx-fine" style={{ marginTop: 26 }}>
            Free during beta · Non-custodial · Human-authorized · No profit promises.
          </p>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
