import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { Section, StateChip } from "@/app/app/portfolio/tiles";
import type { AdviceCase } from "@/lib/home/advice/advice-case";
import type { HomeActionCase } from "@/lib/home/advice/action-case";
import type { Receipt } from "@/lib/home/advice/receipt";
import {
  ActionStages,
  AdviceChain,
  Alternatives,
  SectionIcons,
  stageLabel,
  stageTone,
} from "./tiles";
import styles from "./decisions.module.css";

/**
 * One decision, in full — the body of `/app/action-cases/[id]`.
 *
 * It lives here rather than inside the route so the same markup can be driven
 * by literal evidence in a rendered-QA harness. A detail surface that can only
 * be looked at through a live account and a live venue is a surface nobody
 * looks at, and this repository's rule is that somebody looks at it every time.
 *
 * Everything is a field off the case. The chain is not a summary of the case —
 * it *is* the case, link by link, with each one either carrying its fact or
 * naming the exact reason it is empty.
 */
export function AdviceCaseDetail({
  advice,
  action,
  receipt,
}: {
  advice: AdviceCase;
  action: HomeActionCase | null;
  receipt: Receipt | null;
}) {
  return (
    <div className={styles.surface} data-surface-state={advice.stage}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home · Decision</p>
          <h1>{advice.trigger.subjectLabel}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={stageTone(advice.stage)} label={stageLabel(advice)} />
          <Link className={styles.link} href="/app/action-cases">Decisions <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      <Section
        id="chain"
        title="The audited chain"
        icon={SectionIcons.chain}
        info={
          <p>
            Eight links, in the order the product commits to: the context a decision was read
            against, what triggered it, the evidence, the deterministic risk, the human
            decision, the exact action, the observed outcome and the review. A link is either
            the fact it carries or the reason it is empty — a blank with nothing beside it is
            the state this product refuses everywhere else.
          </p>
        }
        aside={<span className={styles.literal}>{advice.caseId}</span>}
      >
        <AdviceChain advice={advice} action={action} />
        <p className={styles.question}>{advice.openQuestion}</p>
      </Section>

      <Section
        id="alternatives"
        title="What can be done about it"
        icon={SectionIcons.alternatives}
        info={
          <p>
            <b>Ryntra issues no recommendation here and cannot.</b> Personalized advice needs
            a permitted provider of record, a counsel-approved product perimeter and a
            versioned capability state, and none exists — so this is the set of things that
            are open to you, with the reason any of them is not. Doing nothing is always on
            the list, because a set that only offers ways to act is a recommendation with
            extra steps.
          </p>
        }
      >
        <Alternatives advice={advice} />
      </Section>

      {advice.evidence.conflicts.length === 0 && advice.evidence.unknowns.length === 0 ? null : (
        <Section
          id="disagreement"
          title="Disagreements and unknowns"
          icon={SectionIcons.evidence}
          info={
            <p>
              Two sources that report a different value keep both rows: an average would be a
              number nobody reported. A required fact nobody supplied stays unknown rather
              than becoming a zero, and the two are independent — a conflict is not a kind of
              unknown and an unknown is not a kind of conflict.
            </p>
          }
        >
          {advice.evidence.conflicts.length === 0 ? null : (
            /* Sized to the comparison, not to the page. Full width put seven
               hundred pixels between a source and the number it reported, which
               is the one pair a reader is here to hold side by side. */
            <ul className={styles.conflict}>
              {advice.evidence.conflicts.map((entry) => (
                <li key={`${entry.sourceId}-${entry.value}`} className={styles.conflictRow}>
                  <span className={styles.rowName}>{entry.sourceId}</span>
                  <span className={styles.conflictValue}>{entry.value}</span>
                </li>
              ))}
            </ul>
          )}
          {advice.evidence.unknowns.length === 0 ? null : (
            <ul className={styles.note}>
              {advice.evidence.unknowns.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </Section>
      )}

      <Section
        id="evidence"
        title="Evidence bundle"
        icon={SectionIcons.evidence}
        info={
          <p>
            Every source that answered for this case, with the entitlement it was read under
            and the time it was observed. Your own account data is one thing; a
            provider&rsquo;s public API describing its own product is another. The bundle id
            is a digest of exactly these sources, so a bundle that changes gets a new one.
          </p>
        }
        aside={<StateChip tone={advice.evidence.completeness === "COMPLETE" ? "good" : "unknown"} label={advice.evidence.completeness} />}
      >
        {advice.evidence.items.length === 0 ? (
          <p className={styles.empty}>
            No source answered for this subject on this read, so this bundle is empty rather
            than partial.
          </p>
        ) : (
          <ul className={styles.rows}>
            {advice.evidence.items.map((item) => (
              <li key={item.ref} className={styles.row}>
                <span className={styles.rowName}>
                  {item.label}
                  <StateChip tone="quiet" label={item.entitlement} />
                </span>
                <StateChip
                  tone={item.state === "OK" ? "good" : item.state === "STALE" ? "caution" : "risk"}
                  label={item.state}
                />
              </li>
            ))}
          </ul>
        )}
        <div className={styles.fact}>
          <span className={styles.factKey}>Bundle</span>
          <span className={styles.literal}>{advice.evidence.bundleId}</span>
        </div>
      </Section>

      {action === null ? null : (
        <Section
          id="stages"
          title="The exact action, stage by stage"
          icon={SectionIcons.actions}
          info={
            <p>
              The eight stages are Agent Control&rsquo;s, imported rather than restated, so
              Home and Agent Control describe one action in one vocabulary. <b>Blocked and
              unavailable are different answers</b>: blocked means a rule refused, unavailable
              means the product cannot reach that stage at all. Home evaluates no policy on
              this path, so policy reads unavailable and never allowed.
            </p>
          }
          aside={<StateChip tone={action.closed ? "good" : "unknown"} label={action.closed ? "Closed" : "Open"} />}
        >
          <ActionStages stages={action.stages} />
        </Section>
      )}

      <Section
        id="receipt"
        title="Receipt"
        icon={SectionIcons.receipts}
        info={
          <p>
            A receipt exists only after an authoritative observed outcome. The integrity
            digest covers exactly that outcome, so a restated outcome produces a different
            one. It is a digest and nothing more — not a signature, not a proof and not an
            attestation.
          </p>
        }
      >
        {receipt === null ? (
          <p className={styles.empty}>
            No receipt exists for this case. {advice.outcome === null
              ? "Nothing has been observed yet, and a receipt before an observation would be a claim about something that has not happened."
              : "The recorded outcome was not reported by an authoritative observer of this action."}
          </p>
        ) : (
          <div className={styles.facts}>
            <div className={styles.fact}>
              <span className={styles.factKey}>Book</span>
              <span className={styles.factValue}>{receipt.book}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factKey}>Observed by</span>
              <span className={styles.factValue}>{receipt.observedBy}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factKey}>Realized</span>
              {receipt.realizedAmount === null
                ? <span className={styles.factUnknown}>Not reported</span>
                : <span className={styles.factValue}>{receipt.realizedAmount} {receipt.realizedCurrency}</span>}
            </div>
            <div className={styles.fact}>
              <span className={styles.factKey}>Integrity</span>
              <span className={styles.factValue}>{receipt.integrity}</span>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
