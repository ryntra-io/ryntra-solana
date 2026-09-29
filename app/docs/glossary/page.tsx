import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "@/app/site/frozen/module.css";
import "../docs.css";

const HREF = "/docs/glossary";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description:
    "The words the rest of the documentation uses, defined once: network, venue, protocol, adapter, passport, StrategySpec, governor, action, authorization, receipt, and the two state vocabularies.",
});

/**
 * The glossary.
 *
 * Twelve terms, and most of them exist to stop two things being merged that
 * look alike. Network against venue is the pair that has cost the most: a chain
 * settles, a venue quotes, and a product that calls one the other ends up
 * promising a chain pack it does not have.
 */
export default function Page() {
  return (
    <DocsArticle
      href={HREF}
      reviewed="2026-08-19"
      lead="The words the rest of the documentation uses, defined once. Most of them exist to keep two things apart that look alike."
    >
      <div className="rx-prose">
        <dl className="rx-facts">
            <div className="rx-fact" key="Network">
              <dt>Network</dt>
              <dd>Where value settles. A chain — Solana, Stellar, Robinhood Chain, an EVM L2. A network is not a venue and the two are never merged in code or in copy.</dd>
            </div>
            <div className="rx-fact" key="Venue">
              <dt>Venue</dt>
              <dd>Where an action is quoted or executed. Arcus, Jupiter, Uniswap, 0x. A venue runs on a network and is never described as one.</dd>
            </div>
            <div className="rx-fact" key="Protocol">
              <dt>Protocol</dt>
              <dd>A contract system a venue or adapter talks to. Uniswap v4, Aave, Blend, Ekubo. Ryntra integrates protocols and never becomes one.</dd>
            </div>
            <div className="rx-fact" key="Adapter">
              <dt>Adapter</dt>
              <dd>The bounded code that turns one network, venue or protocol into the shapes the kernel understands. An adapter never carries policy; a second policy engine inside an adapter is forbidden.</dd>
            </div>
            <div className="rx-fact" key="Passport">
              <dt>Passport</dt>
              <dd>Everything readable about a thing, with the provenance of each fact and the unknowns preserved. Instrument, asset, issuer, pool, account, agent and action each have one.</dd>
            </div>
            <div className="rx-fact" key="StrategySpec">
              <dt>StrategySpec</dt>
              <dd>A strategy stated as data rather than as code: what it watches, what it would do, under which limits. It is prepared and reviewed; it never executes on its own.</dd>
            </div>
            <div className="rx-fact" key="Risk Governor">
              <dt>Risk Governor</dt>
              <dd>The deterministic evaluator between a plan and a signature. It returns ALLOW, REVIEW, BLOCK or PAUSE by rule, and a BLOCK is the product working rather than an error.</dd>
            </div>
            <div className="rx-fact" key="Action">
              <dt>Action</dt>
              <dd>One exact economic intent, addressed and priced, in the form a person will approve and a network will execute. The payload approved is the payload executed.</dd>
            </div>
            <div className="rx-fact" key="Authorization">
              <dt>Authorization</dt>
              <dd>The human act of approving an exact action, recorded separately from the wallet signature and bound to the intent revision, the evidence root and the execution fingerprint.</dd>
            </div>
            <div className="rx-fact" key="Receipt">
              <dt>Receipt</dt>
              <dd>What actually happened, bound to what was authorized, and reconciled. A transaction hash is not a receipt. A receipt is not a compliance certificate.</dd>
            </div>
            <div className="rx-fact" key="Evidence state">
              <dt>Evidence state</dt>
              <dd>How well a fact is known right now: priced, estimated, stale, unpriced, conflicting, or private and hidden. An unknown stays visibly unknown.</dd>
            </div>
            <div className="rx-fact" key="Capability state">
              <dt>Capability state</dt>
              <dd>How far a capability has actually got: LIVE, TESTNET, PAPER, PREVIEW or BUILDING. Per capability, never per network — an environment is not a maturity.</dd>
            </div>
        </dl>
      </div>
    </DocsArticle>
  );
}
