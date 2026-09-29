import Link from "next/link";

import { getAgentControlPublicModel } from "@/lib/product/agent-control-view";
import type { PublicCopy } from "@/lib/site/public-copy";

import { AgentControlConsole } from "./agent-control-console";
import styles from "./landing.module.css";

/*
 * Agent Control — one economic action a visitor can play.
 *
 * Status words still come from the registry through getAgentControlPublicModel.
 * The demo is labelled illustrative. The CTA opens the workspace, not a second
 * marketing page.
 */

export function AgentControl({ copy }: { copy: PublicCopy }) {
  const model = getAgentControlPublicModel();

  return (
    <section className={`${styles.section} ${styles.agentScene}`} id="agent-control" data-ry-ground="midnight">
      <div className={styles.wrap}>
        <div className={styles.centred}>
          <div className={styles.centredCopy}>
            <p className={styles.eyebrow}>{copy.agentsEyebrow}</p>
            <h2 className={styles.h2}>{copy.agentsHeadline}</h2>
            <p className={styles.lead}>{copy.agentsLead}</p>
            <p className={styles.acDemo}>{copy.agentsDemo}</p>
          </div>
        </div>

        <p className={styles.law}>{copy.agentsLaw}</p>

        <div className={`${styles.panelFrame} ${styles.agentFrame}`}>
          <div className={styles.panelBar}>
            <span className={styles.panelBarName}>AGENT CONTROL</span>
            <span className={styles.panelBarSpacer} />
            <span className={styles.sampleTag}>{copy.sample}</span>
          </div>

          <div className={styles.homePad}>
            <AgentControlConsole model={model} />
          </div>
        </div>

        <div className={styles.btnRow}>
          <Link className={styles.btnPrimary} href="/agents/workspace">
            {copy.agentsOpen}
          </Link>
        </div>
      </div>
    </section>
  );
}
