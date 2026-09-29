import type { Metadata } from "next";
import Link from "next/link";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "@/app/site/frozen/bridge.css";
import "./stellar.css";
import { LedgerRow, PageHero, Section, StatePill } from "@/app/site/parts";
import { sitePageMetadata } from "@/app/site/seo";
import { publicCapabilityRow } from "@/app/site/truth-core";
import { STELLAR_DESTINATIONS as HREF } from "./destinations.ts";
import { FEATURED_ASSETS } from "./workspace/assets/featured.ts";

export const revalidate = 3600;

export const metadata: Metadata = sitePageMetadata({
  path: "/stellar",
  title: "Stellar — understand the asset, control the action, prove the outcome — Ryntra",
  description:
    "Ryntra reads a Stellar asset the way the network works — exact identity, whether its issuer can freeze or claw back a holding, what a trustline costs — then prepares one exact action, has it authorized in the holder's own wallet, and produces a receipt anyone can recompute. Read-only on mainnet, non-custodial.",
  keywords: [
    "stellar rwa",
    "stellar asset issuer controls",
    "stellar trustline",
    "stellar clawback",
    "tokenized treasuries stellar",
    "stellar asset passport",
    "stellar decision receipt",
  ],
  audience: "guard",
});

/**
 * The public Stellar page.
 *
 * Its job, decided by the founder on 2026-08-14, is to move a reviewer, a
 * referrer or a design partner from "what is this?" to "this is a specific,
 * working Stellar-native product" — in the time someone actually spends on a
 * page, and in language an asset holder still understands. It is therefore
 * **not** the Asset Passport: the product is `/stellar/workspace`, the developer
 * contract is `/developers`, and receipts are verified inside the workspace.
 *
 * Two rules hold every claim on it down.
 *
 * Every state label comes from `publicCapabilityRow`, which is the same
 * resolution point the rest of the site uses — so a claim that ages past its
 * review window degrades here too, rather than this page keeping a confident
 * label the registry no longer supports.
 *
 * And every destination is a route that exists. `/developers#stellar` and
 * `/stellar/receipts/{id}` were both in the brief and neither is mounted; this
 * repository has already shipped two documented dead URLs, so `stellar.test.mjs`
 * fails the build on the next one.
 */

const PASSPORT = publicCapabilityRow("stellar-asset-passport");
const WALLET = publicCapabilityRow("stellar-wallet-connect");
const LIFECYCLE = publicCapabilityRow("stellar-testnet-payment-lifecycle");
const RECEIPTS = publicCapabilityRow("stellar-receipt-verification");
const ROUTES = publicCapabilityRow("stellar-route-evidence");
const POLICY = publicCapabilityRow("stellar-policy-evaluation");

const USTRY = FEATURED_ASSETS[0];

/** The one operation that is proven, named exactly rather than summarised. */
const PROVEN_RUN = {
  transactionHash: "1cf2324346b95d8b350f8316e5aec76063bc827c45819bb7d8cecd4c1a45c95c",
  ledger: "4,126,028",
  closedAt: "2026-08-13",
} as const;

/**
 * What a person has to assemble today, against what this collapses it into.
 *
 * The left column is not a strawman — every line is a separate surface with its
 * own vocabulary, and the reason the questions on the right go unanswered is
 * that answering them means visiting all seven.
 */
const SCATTERED = [
  "Issuer documents, on the issuer's own domain",
  "Trustline state, per holder",
  "Authorization flags, set independently of each other",
  "Clawback, enabled or not, on the same account",
  "A liquidity route, priced somewhere else",
  "A wallet prompt that shows bytes",
  "An explorer result, after the fact",
] as const;

const COLLAPSED = [
  "One Asset Passport, with each field's source attached",
  "One exact intent, checked before a signature is spent",
  "One authorization, given in the holder's own wallet",
  "One reconciliation of expected against actual",
  "One receipt anyone can recompute without trusting Ryntra",
] as const;

/**
 * The lifecycle, with the stage that is not built left visible.
 *
 * Removing policy would make the diagram shorter and the product look finished.
 * Leaving it in with its gate is what a reviewer can check — and it is the same
 * Hub Map discipline the workspace already applies to unbuilt modules.
 */
const STAGES = [
  { id: "passport", name: "Passport", detail: "identity · issuer controls · holding requirement", built: true, actor: "system" },
  { id: "preflight", name: "Preflight", detail: "refuse what the ledger would reject", built: true, actor: "system" },
  { id: "policy", name: "Policy", detail: "not built — every receipt records policyVersion: null", built: false, actor: "system" },
  { id: "authorization", name: "Human authorization", detail: "the exact intent, stated in words", built: true, actor: "human" },
  { id: "signature", name: "Wallet signature", detail: "inside Freighter; no key reaches Ryntra", built: true, actor: "human" },
  { id: "settlement", name: "Stellar settlement", detail: "browser to the public endpoint", built: true, actor: "system" },
  { id: "reconciliation", name: "Reconciliation", detail: "expected against actual, movement by movement", built: true, actor: "system" },
  { id: "receipt", name: "Receipt", detail: "intent → authorization → transaction → effects → itself", built: true, actor: "system" },
] as const;

export default function StellarPage() {
  return (
    /* `.rx` is the site's token scope, and this page had never been inside it.
       Tokens are declared on `.rx, .rx-header, .rx-footer`, so the chrome
       resolved them and everything between did not: `--fg` and `--ink` were
       unset on `<main>`, which drops the whole declaration rather than falling
       back — the primary call to action computed `background: rgba(0,0,0,0)`
       and rendered as plain text. The page background, the drawn grid and every
       reveal animation were gone with it. `/developers`, `/company`, `/docs`
       and `/workspaces` all carry this wrapper; the reviewer pages and `/beta` bring their
       own surface class instead. This one brought nothing. */
    <div className="rx">
            <MarkDefs />
      <PublicHeader />
      <main id="main" tabIndex={-1}>
        <PageHero
          eyebrow="Ryntra for Stellar"
          heading={
            <>
              Understand the asset. Control the action.{" "}
              <span className="rx-h1-dim">Prove the outcome.</span>
            </>
          }
          lead="Stellar gives issuers real power over what a holder owns — permission to hold at all, freeze, clawback — and real obligations to disclose. Ryntra reads both, prepares one exact action against them, has it authorized in the holder's own wallet, and produces a receipt anyone can recompute."
          meta={[
            `${PASSPORT.stateLabel} · Stellar Mainnet, read-only`,
            `${WALLET.stateLabel} · Freighter Connect`,
            `${LIFECYCLE.stateLabel} · one signed testnet payment`,
            "Non-custodial · no key reaches Ryntra",
          ]}
          actions={
            <>
              <Link className="rx-btn rx-btn--primary" href={HREF.passport}>
                Open the live USTRY Passport
              </Link>
              <Link className="rx-btn rx-btn--ghost" href={HREF.receipts}>
                Inspect the Stellar proof
              </Link>
              <a className="rx-link" href="#integration">
                How the integration works
              </a>
            </>
          }
        />

        <Section
          index="01"
          kicker="The problem"
          heading="A ticker is not an asset explanation"
          lead="Many assets share a code on Stellar. Two called USDC can have different issuers with completely different powers over a holding, and nothing in a balance says which one it is. Answering the questions that actually decide the outcome means visiting seven surfaces that do not share a vocabulary."
        >
          <div className="rx-split">
            <div className="rx-face">
              <div className="rx-face-top">
                <h3 className="rx-h3">What has to be assembled</h3>
                <StatePill label="Seven surfaces" tone="neutral" />
              </div>
              <ul>
                {SCATTERED.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rx-face">
              <div className="rx-face-top">
                <h3 className="rx-h3">What this collapses it into</h3>
                <StatePill label="One workflow" tone="evidence" />
              </div>
              <ul>
                {COLLAPSED.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="rx-fine">
            Stellar already provides the assets, the wallets, the liquidity and the settlement. What is
            missing is the one thing a holder or a treasury needs before acting: the facts that decide a
            specific decision, in one place, each carrying which source answered and when.
          </p>
        </Section>

        <Section
          index="02"
          kicker="The product"
          heading="One real asset, read from Stellar Mainnet"
          lead="Etherfuse USTRY, resolved from public ledger state and the issuer's own SEP-1 document. It reports what it reads rather than printing a template: USTRY's issuer can neither freeze nor claw back, while Circle's USDC on the same page shape shows freeze enabled."
          meta={<StatePill label={PASSPORT.stateLabel} tone={PASSPORT.tone} />}
          paper
        >
          <dl className="rx-ledger">
            <LedgerRow label="Exact identity">
              Classic, Stellar Asset Contract or SEP-41, with the issuer and contract address that belong to
              it. A code on its own is a 404 rather than a guess at which issuer was meant.
            </LedgerRow>
            <LedgerRow label="Issuer controls">
              Permission to hold, freeze, clawback, and whether those powers can still change — read from the
              issuer&rsquo;s account and reported separately rather than collapsed into one verdict.
            </LedgerRow>
            <LedgerRow label="Holding requirement">
              Whether a trustline is required, whether the issuer must authorize it, and the XLM reserve it
              locks, read from the ledger rather than memorised as a constant.
            </LedgerRow>
            <LedgerRow label="Redemption and eligibility">
              Backing claim, reserve attestation and redemption path from the issuer&rsquo;s own document,
              carrying a standing note that this is the issuer describing itself.
            </LedgerRow>
            <LedgerRow label="What is not known">
              Computed from the sections above, permanent, and never empty by default. It grew from three
              entries to four on the USDC page without anyone editing it.
            </LedgerRow>
          </dl>
          <p className="rx-fine">
            <strong>Etherfuse is demonstrated, not integrated.</strong> The Passport calls no Etherfuse
            surface — it resolves USTRY from the public Stellar ledger and the issuer&rsquo;s published
            <code> stellar.toml</code>. There is no score and no rating: five evidence states across a dozen
            fields is the honest shape of what is known, and one number would be an invention wearing a
            progress bar.
          </p>
          <div className="rx-linkrow">
            <Link className="rx-link rx-link--paper" href={HREF.passport}>
              Open the {USTRY.code} Passport
            </Link>
            <Link className="rx-link rx-link--paper" href={HREF.assets}>
              Find any asset by its exact identity
            </Link>
          </div>
        </Section>

        <Section
          index="03"
          kicker="How the decision works"
          heading="Eight stages, and the one that is not built stays visible"
          lead="Each stage produces something the next one consumes, and each is separately checkable. Policy is registered work rather than a shipped stage — hiding it would make this diagram shorter and the product harder to believe."
        >
          <div className="rx-flow">
            <div className="rx-flow-head">
              <span>Stellar decision lifecycle</span>
              {/* Counted, not written: a hand-typed "seven of eight" survives
                  the ninth stage arriving, and the count is the one number on
                  this block a reviewer will check against the list under it. */}
              <span className="rx-flow-mark">
                {STAGES.filter((stage) => stage.built).length} of {STAGES.length} built
              </span>
            </div>
            <ol className="rx-flow-list">
              {STAGES.map((stage) => (
                <li
                  className="rx-flow-step"
                  key={stage.id}
                  data-done={stage.built ? "true" : "false"}
                  data-actor={stage.actor}
                >
                  <span className="rx-flow-dot" aria-hidden />
                  <span>
                    <span className="rx-flow-name">{stage.name}</span>
                    <span className="rx-flow-detail">{stage.detail}</span>
                  </span>
                  <span className="rx-flow-mark">
                    {stage.built ? "Built" : POLICY.stateLabel}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <dl className="rx-ledger">
            <LedgerRow label="Evidence is not policy">
              Reading an issuer&rsquo;s powers states a fact. Deciding whether those powers are acceptable for
              a given holding is a separate judgement, and this product does not make it yet.
            </LedgerRow>
            <LedgerRow label="Policy approval is not a signature">
              An approved plan moves nothing. Only a signature inside the holder&rsquo;s own wallet does, and
              it is theirs to give or refuse.
            </LedgerRow>
            <LedgerRow label="Confirmation is not reconciliation">
              A transaction that succeeded is not evidence that what was authorized is what happened.
              Reconciliation compares them movement by movement and records the difference when there is one.
            </LedgerRow>
          </dl>
        </Section>

        <Section
          id="integration"
          index="04"
          kicker="Stellar integration"
          heading="Built around Stellar-native semantics"
          lead="Three building blocks, each with the state the capability registry records for it rather than a logo."
        >
          <div className="rx-cards">
            <div className="rx-card">
              <div className="rx-card-top">
                <h3 className="rx-card-title">Stellar RPC and Horizon</h3>
                <StatePill label={PASSPORT.stateLabel} tone={PASSPORT.tone} />
              </div>
              <p className="rx-card-body">
                Asset identity, issuer flags, trustlines, account state and network pulse. Every read records
                which source answered and when, and a read that fails states why instead of returning a
                default.
              </p>
              <p className="rx-card-scope">{PASSPORT.scope}</p>
              <p className="rx-card-limit">Read-only. The browser is not permitted to reach Stellar Mainnet at all.</p>
            </div>

            <div className="rx-card">
              <div className="rx-card-top">
                <h3 className="rx-card-title">Freighter Connect</h3>
                <StatePill label={WALLET.stateLabel} tone={WALLET.tone} />
              </div>
              <p className="rx-card-body">
                User-controlled address, network and transaction signing through the official{" "}
                <code>@stellar/freighter-api</code> client, behind a provider-neutral adapter. Ryntra never
                requests a key or a seed phrase.
              </p>
              <p className="rx-card-scope">{WALLET.scope}</p>
              <p className="rx-card-limit">Signing is refused outside Stellar Testnet, enforced in the header the site serves.</p>
            </div>

            <div className="rx-card">
              <div className="rx-card-top">
                <h3 className="rx-card-title">Soroswap Routing API</h3>
                <StatePill label={ROUTES.stateLabel} tone={ROUTES.tone} />
              </div>
              <p className="rx-card-body">
                Route discovery, quote and liquidity evidence for supported Stellar actions. No route provider
                is called today and no quote is fetched.
              </p>
              <p className="rx-card-scope">{ROUTES.scope}</p>
              <p className="rx-card-limit">Not integrated. Ryntra builds no router and would execute nothing on it.</p>
            </div>
          </div>
        </Section>

        <Section
          index="05"
          kicker="Proof"
          heading="What works now, and what is next"
          lead="Four states, each read from the capability registry. Code complete, deployed, signed, settled, reconciled and verified are six different things, and this page keeps them apart."
          meta={<StatePill label={LIFECYCLE.stateLabel} tone={LIFECYCLE.tone} />}
          paper
        >
          <div className="rx-cols rx-cols--quad">
            <div className="rx-col">
              <span className="rx-col-tag">{PASSPORT.stateLabel}</span>
              <h3 className="rx-h3">Mainnet Asset Passport</h3>
              <p>Deployed and serving, read-only, over real Stellar Mainnet assets.</p>
            </div>
            <div className="rx-col">
              <span className="rx-col-tag">{LIFECYCLE.stateLabel}</span>
              <h3 className="rx-h3">Owner-signed payment</h3>
              <p>
                One classic XLM payment on Stellar Testnet, reconciled against the ledger with balances moving
                exactly as authorized.
              </p>
            </div>
            <div className="rx-col">
              <span className="rx-col-tag">{RECEIPTS.stateLabel}</span>
              <h3 className="rx-h3">Verifiable receipt</h3>
              <p>
                That run&rsquo;s receipt recomputes from a minified copy and re-reads the ledger from scratch.
              </p>
            </div>
            <div className="rx-col">
              <span className="rx-col-tag">{ROUTES.stateLabel}</span>
              <h3 className="rx-h3">Route evidence</h3>
              <p>Soroswap route and liquidity evidence. Nothing is called today, and no quote is fetched.</p>
            </div>
          </div>

          <dl className="rx-facts">
            <div className="rx-fact">
              <dt>Transaction</dt>
              <dd className="rx-hash">{PROVEN_RUN.transactionHash}</dd>
            </div>
            <div className="rx-fact">
              <dt>Ledger</dt>
              <dd>
                {PROVEN_RUN.ledger} · closed {PROVEN_RUN.closedAt} · reconciled across four checks
              </dd>
            </div>
            <div className="rx-fact">
              <dt>Scope</dt>
              <dd>{LIFECYCLE.limitation}</dd>
            </div>
            <div className="rx-fact rx-never">
              <dt>Not claimed</dt>
              <dd>
                Mainnet execution, any other operation, amount or asset, and policy evaluation — which is why
                every receipt this product writes carries <code>policyVersion</code> as null with the reason
                named.
              </dd>
            </div>
          </dl>

          <div className="rx-linkrow">
            <Link className="rx-link rx-link--paper" href={HREF.receipts}>
              Verify a receipt, or any testnet transaction
            </Link>
            <Link className="rx-link rx-link--paper" href={HREF.map}>
              Every registered module and the gate it waits on
            </Link>
          </div>
        </Section>

        <Section
          index="06"
          kicker="Who this is for"
          heading="One product, three ways in"
          lead="The same evidence, the same lifecycle and the same receipt. What changes is the question being asked of it."
        >
          <div className="rx-cols">
            <div className="rx-col">
              <span className="rx-col-tag">Asset holders</span>
              <p>
                Understand what a token represents, which issuer powers apply to it, what holding it requires,
                and what stays unverified. Read-only and without connecting anything.
              </p>
            </div>
            <div className="rx-col">
              <span className="rx-col-tag">Treasury teams</span>
              <p>
                See issuer power, holding requirements and stated redemption before authorizing anything. The
                engine that turns those facts into an automatic decision is registered work and is not shipped.
              </p>
            </div>
            <div className="rx-col">
              <span className="rx-col-tag">Stellar applications</span>
              <p>
                The same Passport, preflight and receipt model over one evidence kernel. Every read, its source
                and what the adapter refuses are published in the workspace.
              </p>
            </div>
          </div>
        </Section>

        <Section
          index="07"
          kicker="See it"
          heading="The decision trail, on a real asset and a real transaction"
          lead="Nothing on this page needs an account, and the two things worth checking take a minute each."
          tight
        >
          <div className="rx-close-actions">
            <Link className="rx-btn rx-btn--primary" href={HREF.passport}>
              Open the live USTRY Passport
            </Link>
            <Link className="rx-btn rx-btn--ghost" href={HREF.receipts}>
              Inspect the Stellar proof
            </Link>
          </div>
          <div className="rx-linkrow">
            <Link className="rx-link" href={HREF.workspace}>
              Stellar Hub
            </Link>
            <Link className="rx-link" href={HREF.adapter}>
              Every read and what the adapter refuses
            </Link>
            <Link className="rx-link" href={HREF.developers}>
              Developers
            </Link>
            <Link className="rx-link" href={HREF.handbook}>
              Capability status
            </Link>
          </div>
        </Section>
      </main>
      <FrozenFooter />
    </div>
  );
}
