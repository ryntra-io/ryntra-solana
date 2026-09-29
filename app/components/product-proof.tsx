import {
  CheckCircle,
  Circle,
  FileText,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { LANDING_COPY, type LandingCopy } from "../landing/content";
import type { LocaleCode } from "../i18n";

type ProductProofProps = {
  copy?: Pick<LandingCopy, "riskState" | "riskReason">;
  locale?: LocaleCode;
  compact?: boolean;
  idPrefix?: string;
};

const evidenceRows = [
  ["Reference market", "Closed · estimated"],
  ["Quote vs feed", "+0.84%"],
  ["Oracle observation", "18s · sample"],
] as const;

const planRows = [
  ["Risk limit", "≤ 0.50%"],
  ["Recheck threshold", "> 1.25% deviation"],
  ["Example disposition", "Paper or human review"],
] as const;

export function ProductProof({
  copy = LANDING_COPY.en,
  locale = "en",
  compact = false,
  idPrefix = "decision-ledger",
}: ProductProofProps) {
  const riskId = `${idPrefix}-risk`;
  const planId = `${idPrefix}-plan`;
  const journalId = `${idPrefix}-journal`;

  return (
    <div className={`decision-ledger${compact ? " decision-ledger-compact" : ""}`} lang="en" dir="ltr">
      <div className="dl-toolbar">
        <div>
          <span>DECISION LEDGER · DETERMINISTIC SAMPLE</span>
          <strong>NVDA tokenized instrument · scoped adapter evidence</strong>
        </div>
        <span className="dl-sample">No wallet · No order</span>
      </div>

      <div className="dl-grid">
        <section className="dl-risk" aria-labelledby={riskId}>
          <div className="dl-section-head">
            <span id={riskId}>Current risk state</span>
            <ShieldCheck size={18} weight="bold" aria-hidden />
          </div>
          <div className="dl-risk-state">
            <Warning size={22} weight="fill" aria-hidden />
            <div>
              <span>Signal</span>
              <strong lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{copy.riskState}</strong>
            </div>
          </div>
          <p className="dl-reason" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{copy.riskReason}</p>
          <dl className="dl-rows">
            {evidenceRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="dl-source">Sample source · Arcus is shown only as the first shipped adapter.</p>
        </section>

        <section className="dl-plan" aria-labelledby={planId}>
          <div className="dl-section-head">
            <span id={planId}>Plan structure</span>
            <CheckCircle size={18} weight="bold" aria-hidden />
          </div>
          <p className="dl-section-intro">
            Example limits make the decision reviewable. They are not a readiness score.
          </p>
          <dl className="dl-rows">
            {planRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="dl-human-gate">
            <span>Human authority</span>
            <strong>Decision pending</strong>
            <small>No supported live action can bypass an explicit wallet confirmation.</small>
          </div>
        </section>

        <section className="dl-journal" aria-labelledby={journalId}>
          <div className="dl-section-head">
            <span id={journalId}>Decision journal</span>
            <FileText size={18} weight="bold" aria-hidden />
          </div>
          <ol className="dl-timeline">
            <li className="complete">
              <CheckCircle size={18} weight="fill" aria-hidden />
              <span><strong>Context checked</strong><small>Sample evidence recorded</small></span>
            </li>
            <li className="complete">
              <CheckCircle size={18} weight="fill" aria-hidden />
              <span><strong>Plan noted</strong><small>Limits remain visible</small></span>
            </li>
            <li>
              <Circle size={18} weight="regular" aria-hidden />
              <span><strong>Human decision</strong><small>No order submitted</small></span>
            </li>
            <li>
              <Circle size={18} weight="regular" aria-hidden />
              <span><strong>Review</strong><small>Not available in this sample</small></span>
            </li>
          </ol>
        </section>
      </div>

      <p className="dl-boundary">
        Interface concept only. The complete StrategySpec → readiness → disposition →
        DecisionReceipt → ReviewRecord loop is planned and is not shipped end to end.
      </p>
    </div>
  );
}
