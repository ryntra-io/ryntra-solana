import Link from "next/link";

import { AgentControlConsole } from "@/app/(home)/agent-control-console";
import { Meters } from "@/app/(home)/bits";
import { AGENT_PANELS } from "@/app/(home)/data";
import { FrozenFooter, FrozenHeader } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { AGENT_CONTROL_DOD_CHECKS } from "@/lib/product/agent-control-truth";
import { getAgentControlPublicModel } from "@/lib/product/agent-control-view";
import styles from "@/app/(home)/landing.module.css";

/*
 * The flagship page.
 *
 * The landing scene answers "what is this" in one screen. This page is where
 * the console gets room, where every capability shows all five of its axes, and
 * where the boundary is stated at length rather than as one ruled line.
 *
 * Promise, then boundary, then
 * a real action, then the primitives that made the action possible, then the
 * console, then coverage, then what is *not* built. A reader who stops halfway
 * has still met the boundary.
 */

export const revalidate = 3600;

/** The eight primitives, each with the sentence that stops it overreaching. */
const PRIMITIVES: readonly Readonly<{ name: string; body: string }>[] = [
  {
    name: "Action Passport",
    body: "One exact proposed action, with the evidence, mandate and policy that were used to judge it. A review object, not a receipt.",
  },
  {
    name: "Evidence",
    body: "Every fact carries its source, authority, freshness and verification method. A Ryntra signature proves the bundle is intact — not that a source told the truth.",
  },
  {
    name: "Mandate",
    body: "Versioned and immutable once active. Widening authority creates a new version and asks the owner again; nothing widens quietly.",
  },
  {
    name: "Risk Governor",
    body: "Deterministic rules over spend, velocity, counterparty, network, asset, action class, market state and evidence age. The model explains; the rules decide.",
  },
  {
    name: "Human Authorization",
    body: "A person approves exact bytes, not an agent. Requester and approver differ, approvals expire, and any change to price, payee or calldata invalidates the approval.",
  },
  {
    name: "Execution Binding",
    body: "Ryntra hands an external signer a decision, constraints and a digest. It holds no key, signs nothing and broadcasts nothing.",
  },
  {
    name: "Outcome Proof",
    body: "Expected against actual: fill, fees, post-state, delivered resource. A provider reporting success is one kind of evidence, not the answer.",
  },
  {
    name: "Recovery",
    body: "Ambiguous outcomes open a case with a defined end: released, refunded, retried or escalated — with proof the revocation completed.",
  },
];

const BOUNDARIES: readonly Readonly<{ name: string; body: string }>[] = [
  {
    name: "No custody",
    body: "Ryntra holds no keys and no funds, and operates no pooled balances. The wallet or provider signs and pays directly.",
  },
  {
    name: "No execution",
    body: "Ryntra does not submit transactions, create external jobs, route orders or select routes. It returns a decision and evidence.",
  },
  {
    name: "No verdict on legality",
    body: "KYC, KYT and sanctions arrive as external, source-labelled signals. Ryntra issues no regulatory or safety verdict and calls nothing compliant or safe.",
  },
  {
    name: "No success fee",
    body: "Pricing is fixed, platform or per-action. A layer that earns more when more value moves has the wrong incentive at the moment it should block.",
  },
];

export default function AgentControlPage() {
  const model = getAgentControlPublicModel();
  const { coverage, build, cards, networks } = model;

  return (
    <>
      <MarkDefs />
      {/*
        The site bar rather than the landing one. The landing bar's entries are
        same-page anchors — `#product`, `#agent-control`, `#ecosystems` — and
        none of those sections exist here, so it would ship four controls that
        scroll nowhere.
      */}
      <FrozenHeader
        variant="site"
        ground="midnight"
        mainId="main-content"
        cta={
          <Link className={styles.btnPrimary} href="/solana/workspace">
            Open Ryntra
          </Link>
        }
      />

      <main id="main-content" className={styles.page} tabIndex={-1}>
        <section className={`${styles.section} ${styles.sectionFirst}`} data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.centred}>
              <div className={styles.centredCopy}>
                <div className={styles.eyebrowRowCentred}>
                  <span className={`${styles.eyebrow} ${styles.eyebrowFlush}`}>RYNTRA AGENT CONTROL</span>
                  <span className={styles.flagship}>FLAGSHIP</span>
                </div>
                <h1 className={styles.h2}>
                  Verify the intent. Control the action.
                  <br />
                  <span className={styles.accent}>Prove the outcome.</span>
                </h1>
                <p className={styles.lead}>
                  Non-custodial mandate, authorization and evidence infrastructure for autonomous financial
                  actions and tokenized assets. Ryntra checks an agent&rsquo;s economic action against its
                  mandate before anything is signed, then proves whether what happened matched what was
                  allowed.
                </p>
                <p className={styles.acDemo}>INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE</p>
              </div>
            </div>

            <p className={styles.law}>
              Agent proposes. Ryntra verifies and governs. You authorize. The wallet signs. The rail settles.
              Ryntra proves the outcome.
            </p>
          </div>
        </section>

        <section className={styles.section} id="walkthrough" data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.sceneHead}>
              <p className={styles.eyebrow}>ONE ACTION, END TO END</p>
              <h2 className={styles.h2}>Change the action. Watch the verdict change.</h2>
              <p className={styles.lead}>
                Every verdict below comes from one deterministic rule set with its own tests — no model and
                no randomness. Move the amount, switch the counterparty or pick another action, and the
                decision moves for a named reason.
              </p>
            </div>

            <div className={`${styles.panelFrame} ${styles.agentFrame}`}>
              <div className={styles.panelBar}>
                <span className={styles.panelBarName}>MISSION CONTROL</span>
                <span className={styles.panelBarSpacer} />
                <span className={styles.sampleTag}>SAMPLE DATA</span>
              </div>
              <div className={styles.homePad}>
                <AgentControlConsole model={model} full />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} id="primitives" data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.sceneHead}>
              <p className={styles.eyebrow}>PRODUCT PRIMITIVES</p>
              <h2 className={styles.h2}>Eight parts, and where each one stops.</h2>
            </div>
            <div className={styles.principleGrid}>
              {PRIMITIVES.map((item) => (
                <div key={item.name} className={styles.principleCard}>
                  <h3 className={styles.principleTitle}>{item.name}</h3>
                  <p className={styles.principleNote}>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="mission-control" data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.sceneHead}>
              <p className={styles.eyebrow}>FULL MISSION CONTROL</p>
              <h2 className={styles.h2}>What an operator watches all day.</h2>
              <p className={styles.lead}>
                Sample telemetry. These panels show the shape of the console, not a running deployment.
              </p>
            </div>
            <div className={styles.proPanels}>
              {AGENT_PANELS.map((panel) => (
                <div key={panel.title} className={styles.proPanel}>
                  <div className={styles.paneHead}>
                    <span className={styles.microLabel}>{panel.title}</span>
                    <span className={`${styles.microLabel} ${styles.toneNeutral}`}>{panel.meta}</span>
                  </div>
                  <Meters rows={panel.rows} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="coverage" data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.sceneHead}>
              <p className={styles.eyebrow}>INTEGRATION &amp; ENFORCEMENT COVERAGE</p>
              <h2 className={styles.h2}>Where a rule is actually enforced.</h2>
              <p className={styles.lead}>
                A control is only enforced where Ryntra or a bound provider sits in the action path.
                Everywhere else it observes and proves — and says so.
              </p>
            </div>
            <div className={styles.acList}>
              {networks.map((network) => (
                <div key={network.name} className={styles.acListRow}>
                  <span className={styles.acListName}>{network.name}</span>
                  <span className={styles.acAxes}>
                    <span className={styles.acAxis}>{network.environment}</span>
                    <span className={styles.acAxis}>{network.enforcement}</span>
                  </span>
                  <span className={styles.acListMeta}>{network.note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="build-status" data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.sceneHead}>
              <p className={styles.eyebrow}>CODE-VERIFIED BUILD STATUS</p>
              <h2 className={styles.h2}>Five axes, because one word cannot hold them.</h2>
              <p className={styles.lead}>
                There is no single word for &ldquo;proven by tests, not on mainnet, shown publicly as a
                preview, and technically unable to stop a direct call&rdquo;. So it is four axes plus
                enforcement, generated from the capability registry rather than written here.
              </p>
            </div>

            <div className={styles.acBuild}>
              <span className={styles.acBuildLine}>
                Verification coverage {coverage.passed}/{coverage.applicable} blocking checks · build {build}
              </span>
              <span className={styles.acBuildNote}>
                A ratio over blocking Definition-of-Done checks. Not a completion percentage, and never
                averaged across capabilities.
              </span>
            </div>

            <div className={styles.acList}>
              {AGENT_CONTROL_DOD_CHECKS.map((check) => (
                <div key={check.id} className={styles.acListRow}>
                  <span className={styles.acListName}>
                    <span aria-hidden="true">{check.passed ? "✓ " : "✕ "}</span>
                    {check.label}
                  </span>
                  <span className={styles.acAxes}>
                    <span className={`${styles.acAxis} ${check.passed ? styles.toneOk : styles.toneBad}`}>
                      {check.passed ? "PASSED" : "OPEN"}
                    </span>
                  </span>
                  <span className={styles.acListMeta}>{check.blocker ?? ""}</span>
                </div>
              ))}
            </div>

            <div className={`${styles.capGrid} ${styles.acCards}`}>
              {cards.map((card) => (
                <div key={card.id} className={styles.capCard}>
                  <div className={styles.capCardHead}>
                    <span className={styles.capCardName}>{card.label}</span>
                  </div>
                  <span className={styles.acAxes}>
                    <span className={styles.acAxis}>{card.axes.verification}</span>
                    <span className={styles.acAxis}>{card.axes.availability}</span>
                    <span className={styles.acAxis}>{card.axes.environment}</span>
                    <span className={styles.acAxis}>{card.axes.enforcement}</span>
                  </span>
                  <p className={styles.principleNote}>{card.limitation}</p>
                  <span className={styles.acBuildNote}>
                    Last verified {card.lastVerifiedAt} · evidence {card.freshness}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="boundary" data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.sceneHead}>
              <p className={styles.eyebrow}>SECURITY &amp; NON-CUSTODIAL BOUNDARY</p>
              <h2 className={styles.h2}>Four things Ryntra will not do.</h2>
            </div>
            <div className={styles.principleGrid}>
              {BOUNDARIES.map((item) => (
                <div key={item.name} className={styles.principleCard}>
                  <h3 className={styles.principleTitle}>{item.name}</h3>
                  <p className={styles.principleNote}>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.ctaScene}`} data-ry-ground="midnight">
          <div className={styles.wrap}>
            <div className={styles.ctaInner}>
              <h2 className={styles.ctaHeadline}>Bring one real workflow.</h2>
              <p className={styles.ctaQuiet}>
                The fastest way to find out whether this helps is one of your own actions, reconstructed with
                you — in shadow mode, with no funds moving.
              </p>
              <div className={styles.ctaActions}>
                <Link className={styles.btnPrimary} href="/contact">
                  Request a pilot →
                </Link>
                <Link className={styles.btnGhost} href="/developers/agent-control">
                  API &amp; developer surface →
                </Link>
                <Link className={styles.btnGhost} href="/docs#agent-control">
                  Read in Docs →
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <FrozenFooter />
    </>
  );
}
