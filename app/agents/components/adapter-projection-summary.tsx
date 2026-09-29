import Link from "next/link";

import { ArrowMark, AttentionMark, CheckMark, CrossMark } from "@/app/components/mark";
import type {
  AdapterProjection,
  ProjectionAxes,
  SharedActionIdentity,
} from "@/lib/agent-control/adapter-projection";

import styles from "./adapter-projection-summary.module.css";

type AxisKey = keyof ProjectionAxes;

export type AdapterProjectionCopy = Readonly<{
  sharedIdentity: string;
  actionId: string;
  actionDigest: string;
  policyVersion: string;
  receipt: string;
  agentControlOwns: string;
  ecosystemOwns: string;
  axes: string;
  axisLabels: Readonly<Record<AxisKey, string>>;
  limitations: string;
  nextGate: string;
  notBound: string;
  openCounterpart: string;
  agentResponsibilities?: readonly string[];
  ecosystemResponsibilities?: readonly string[];
  axisBasis?: Readonly<Partial<Record<AxisKey, string>>>;
  limitationLines?: readonly string[];
  nextGateText?: string;
}>;

export const ENGLISH_ADAPTER_PROJECTION_COPY: AdapterProjectionCopy = {
  sharedIdentity: "Shared identity",
  actionId: "Action ID",
  actionDigest: "Action digest",
  policyVersion: "Policy version",
  receipt: "Receipt",
  agentControlOwns: "Agent Control owns",
  ecosystemOwns: "Ecosystem owns",
  axes: "Four independent facts",
  axisLabels: {
    providerCapability: "Provider capability",
    ryntraMaturity: "Ryntra maturity",
    routeCapability: "Route capability",
    userEligibility: "User eligibility",
  },
  limitations: "Limitations",
  nextGate: "Next gate",
  notBound: "Not bound",
  openCounterpart: "Open the other projection",
};

function StatusMark({ status }: { status: AdapterProjection["status"] }) {
  if (status === "COMPLETE") return <CheckMark size={15} />;
  if (status === "PARTIAL") return <AttentionMark size={15} />;
  return <CrossMark size={15} />;
}

function Identity({ identity, copy }: { identity: SharedActionIdentity; copy: AdapterProjectionCopy }) {
  const rows = [
    [copy.actionId, identity.actionId],
    [copy.actionDigest, identity.actionDigest],
    [copy.policyVersion, identity.policyVersion === null ? null : `v${identity.policyVersion}`],
    [copy.receipt, identity.receipt ? `${identity.receipt.id} · ${identity.receipt.hash}` : null],
  ] as const;

  return (
    <dl className={styles.identity}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={value ? styles.bound : styles.missing} translate={value ? "no" : undefined}>
            {value ?? copy.notBound}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AdapterProjectionSummary({
  projection,
  counterpartHref,
  copy = ENGLISH_ADAPTER_PROJECTION_COPY,
}: {
  projection: AdapterProjection;
  counterpartHref: string;
  copy?: AdapterProjectionCopy;
}) {
  const axisKeys: readonly AxisKey[] = [
    "providerCapability",
    "ryntraMaturity",
    "routeCapability",
    "userEligibility",
  ];
  const agentResponsibilities = copy.agentResponsibilities ?? projection.agentControl.responsibilities;
  const ecosystemResponsibilities = copy.ecosystemResponsibilities ?? projection.ecosystem.responsibilities;
  const limitationLines = copy.limitationLines ?? projection.limitations;

  return (
    <div className={styles.root} data-status={projection.status}>
      <div className={styles.status}>
        <span className={styles.statusMark} aria-hidden>
          <StatusMark status={projection.status} />
        </span>
        <b>{projection.status}</b>
        <span>{projection.adapter.networkLabel}</span>
      </div>

      <section className={styles.section} aria-label={copy.sharedIdentity}>
        <h3>{copy.sharedIdentity}</h3>
        <Identity identity={projection.identity} copy={copy} />
      </section>

      <div className={styles.ownership}>
        <section className={styles.section}>
          <h3>{copy.agentControlOwns}</h3>
          <ul>
            {agentResponsibilities.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <section className={styles.section}>
          <h3>{copy.ecosystemOwns}</h3>
          <ul>
            {ecosystemResponsibilities.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
      </div>

      <section className={styles.section} aria-label={copy.axes}>
        <h3>{copy.axes}</h3>
        <dl className={styles.axes}>
          {axisKeys.map((key) => {
            const fact = projection.axes[key];
            return (
              <div key={key}>
                <dt>{copy.axisLabels[key]}</dt>
                <dd>
                  <b>{fact.state}</b>
                  <span>{copy.axisBasis?.[key] ?? fact.basis}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className={styles.section}>
        <h3>{copy.limitations}</h3>
        <ul>
          {limitationLines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>

      <div className={styles.next}>
        <p>
          <b>{copy.nextGate}</b>
          <span>{copy.nextGateText ?? projection.nextGate}</span>
        </p>
        <Link href={counterpartHref}>
          {copy.openCounterpart}
          <ArrowMark size={13} />
        </Link>
      </div>
    </div>
  );
}
