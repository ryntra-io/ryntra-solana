"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type { PublicCopy } from "@/lib/site/public-copy";

import styles from "./landing.module.css";

/*
 * Scene 2's demo — the Ryntra Home workspace, one area at a time.
 *
 * Three tabs, one panel: Portfolio & Risk, Strategies, Ryn. The tab switch is
 * the whole interaction — the same restraint as the Agent Control console
 * beneath it, which owns the richer economic-action demo. Every string comes
 * from the typed public copy, every value is inside the frame that says
 * Illustrative, and Ryn ends on the explicit user decision because that is the
 * product law, not a flourish.
 */

const TABS = ["portfolio", "strategies", "ryn"] as const;
type HomeTab = (typeof TABS)[number];

export function HomeConsole({ copy }: { readonly copy: PublicCopy }) {
  const [tab, setTab] = useState<HomeTab>("portfolio");
  const panelId = useId();

  const tabLabel: Record<HomeTab, string> = {
    portfolio: copy.homePortfolio,
    strategies: copy.homeStrategies,
    ryn: copy.homeRyn,
  };

  const tabLead: Record<HomeTab, string> = {
    portfolio: copy.homePortfolioBody,
    strategies: copy.homeStrategiesBody,
    ryn: copy.homeRynBody,
  };

  return (
    <div>
      <div className={styles.hcTabsRow}>
        <div className={styles.segment} role="tablist" aria-label={copy.homeTabsLabel}>
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`${panelId}-tab-${item}`}
              aria-selected={item === tab}
              aria-controls={panelId}
              tabIndex={item === tab ? 0 : -1}
              className={`${styles.segmentBtn} ${styles.hcTab} ${item === tab ? styles.segmentBtnOn : ""}`}
              onClick={() => setTab(item)}
            >
              {tabLabel[item]}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.hcLead}>{tabLead[tab]}</p>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${tab}`}
        tabIndex={0}
        className={styles.hcPanel}
      >
        {tab === "portfolio" ? <PortfolioPane copy={copy} /> : null}
        {tab === "strategies" ? <StrategiesPane copy={copy} /> : null}
        {tab === "ryn" ? <RynPane copy={copy} /> : null}
      </div>
    </div>
  );
}

function PortfolioPane({ copy }: { readonly copy: PublicCopy }) {
  const meters = [
    { label: copy.homeMeterStables, value: "44%", width: 44 },
    { label: copy.homeMeterEquities, value: "38%", width: 38 },
    { label: copy.homeMeterOther, value: "18%", width: 18 },
  ];
  const attention = [
    { text: copy.heroAttnShort1, tag: copy.heroAttn1Tag, tone: styles.toneWarn, fill: styles.fillWarn },
    { text: copy.heroAttnShort2, tag: copy.heroAttn2Tag, tone: styles.toneNeutral, fill: styles.fillNeutral },
    { text: copy.homeAttn4, tag: copy.homeAttn4Tag, tone: styles.toneUnknown, fill: styles.fillUnknown },
    { text: copy.homeAttn3, tag: copy.homeAttn3Tag, tone: styles.toneNeutral, fill: styles.fillNeutral },
  ];

  return (
    <div className={styles.hcGrid}>
      <div className={styles.pane}>
        <div className={styles.paneHead}>
          <span className={styles.microLabel}>{copy.compositionCoverage}</span>
          <span className={`${styles.smallValue} ${styles.toneOk}`}>96%</span>
        </div>
        <div className={styles.meterTrack}>
          <span className={`${styles.meterFill} ${styles.toneOk}`} style={{ width: "96%" }} />
        </div>
        <div className={styles.coverage}>
          <span className={styles.toneOk}>{copy.homeCoverageValued}</span>
          <span>{copy.homeCoverageUnpriced}</span>
          <span className={styles.toneUnknown}>{copy.homeCoverageHidden}</span>
        </div>

        <div className={styles.hcBlock}>
          <p className={styles.microLabel}>{copy.homeExposureLabel}</p>
          <div className={`${styles.meterList} ${styles.hcMeters}`}>
            {meters.map((row) => (
              <div key={row.label}>
                <div className={styles.meterHead}>
                  <span className={styles.meterName}>{row.label}</span>
                  <span className={`${styles.meterValue} ${styles.toneNeutral}`}>{row.value}</span>
                </div>
                <div className={styles.meterTrack}>
                  <span
                    className={`${styles.meterFill} ${styles.toneNeutral}`}
                    style={{ width: `${row.width}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`${styles.pane} ${styles.hcAttnPane}`}>
        <div className={styles.paneHead}>
          <span className={`${styles.microLabel} ${styles.toneWarn}`}>{copy.compositionAttention}</span>
          <span className={styles.microLabel}>4</span>
        </div>
        <div className={`${styles.attnList} ${styles.hcAttn}`}>
          {attention.map((row) => (
            <div key={row.text} className={styles.attnRow}>
              <span className={`${styles.dot} ${styles.attnDot} ${row.fill}`} aria-hidden="true" />
              <div className={styles.hcAttnBody}>
                <div className={styles.attnText}>{row.text}</div>
                <span className={`${styles.attnTag} ${row.tone}`}>{row.tag}</span>
              </div>
            </div>
          ))}
        </div>
        <Link className={styles.hcPaneAction} href="/app">
          {copy.homeReviewCta}
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
    </div>
  );
}

function StrategiesPane({ copy }: { readonly copy: PublicCopy }) {
  const scenarios = [
    {
      label: copy.homeStratScenarioA,
      recommended: true,
      outcome: { value: "+4.1%", width: 58, tone: styles.toneOk },
      drawdown: { value: "−2.3%", width: 23, tone: styles.toneNeutral },
    },
    {
      label: copy.homeStratScenarioB,
      recommended: false,
      outcome: { value: "+2.6%", width: 37, tone: styles.toneOk },
      drawdown: { value: "−6.8%", width: 68, tone: styles.toneWarn },
    },
  ];

  return (
    <div className={styles.hcGrid}>
      <div className={`${styles.pane} ${styles.hcStratPane}`}>
        <p className={styles.microLabel}>{copy.homeStrategies.toUpperCase()}</p>
        <p className={styles.hcStratName}>{copy.homeStratName}</p>
        <div className={styles.hcChipRow}>
          <span className={`${styles.hcStateChip} ${styles.toneOk}`}>{copy.homeStratPaper}</span>
          <span className={styles.hcStateChip}>{copy.homeStratVersion}</span>
          <span className={`${styles.hcStateChip} ${styles.hcStateChipWarn}`}>{copy.homeStratReview}</span>
        </div>
        <div className={styles.hcVersionRail} aria-hidden="true">
          {["v1", "v2", "v3"].map((version, index) => (
            <span
              key={version}
              className={`${styles.hcVersion} ${index === 2 ? styles.hcVersionOn : ""}`}
            >
              {version}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.pane}>
        {scenarios.map((scenario) => (
          <div key={scenario.label} className={styles.hcScenario}>
            <div className={styles.hcScenarioHead}>
              <p className={styles.microLabelSm}>{scenario.label}</p>
              {scenario.recommended ? (
                <span className={styles.hcRecommended}>{copy.homeStratRecommended}</span>
              ) : null}
            </div>
            <div className={`${styles.meterList} ${styles.hcMeters}`}>
              {[
                { name: copy.homeStratOutcome, ...scenario.outcome },
                { name: copy.homeStratDrawdown, ...scenario.drawdown },
              ].map((row) => (
                <div key={row.name}>
                  <div className={styles.meterHead}>
                    <span className={styles.meterName}>{row.name}</span>
                    <span className={`${styles.meterValue} ${row.tone}`}>{row.value}</span>
                  </div>
                  <div className={styles.meterTrack}>
                    <span className={`${styles.meterFill} ${row.tone}`} style={{ width: `${row.width}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RynPane({ copy }: { readonly copy: PublicCopy }) {
  const steps = [
    { label: copy.homeRynFacts, body: copy.homeRynFactsBody },
    { label: copy.homeRynRisk, body: copy.homeRynRiskBody },
    { label: copy.homeRynNext, body: copy.homeRynNextBody },
    { label: copy.homeRynDecision, body: copy.homeRynDecisionBody },
  ];

  return (
    <div className={styles.hcRyn}>
      <div className={`${styles.pane} ${styles.hcRynPane}`}>
        <div className={styles.hcQuestion}>
          <span className={styles.microLabelSm}>{copy.homeRynYou}</span>
          <p className={styles.hcQuestionText}>{copy.homeRynQuestion}</p>
        </div>

        {/* Ryn's answer as the four-step process it actually is: numbered
            nodes on one rail, the explicit decision lit as the destination. */}
        <ol className={styles.hcFlow}>
          {steps.map((step, index) => {
            const last = index === steps.length - 1;
            return (
              <li key={step.label} className={styles.hcFlowStep}>
                <span className={`${styles.hcFlowNum} ${last ? styles.hcFlowNumOn : ""}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className={styles.hcFlowBody}>
                  <p className={`${styles.hcStepLabel} ${last ? styles.toneOkLabel : ""}`}>{step.label}</p>
                  <p className={styles.hcStepBody}>{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
