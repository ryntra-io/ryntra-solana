"use client";

/* Canonical Ryntra Plan Card — the atomic visual unit for a trade plan, a journal
   card, a bot/signal config, or a Trading Defense verdict. It always answers four
   questions: what is the plan · what is the risk · what is missing · what is the next
   safe action. Dark-premium, locked palette (globals.css vars), mono numbers,
   Phosphor icons (never emoji), semantic status color. See docs/archive/design-pre-reset-2026-08-18/ryntra-design-bar.md §4. */

import { Check, Circle, Warning, Lock, ShieldCheck, ArrowRight } from "@phosphor-icons/react";

export type PlanCardStatus = "ready" | "caution" | "blocked" | "paper" | "next";
export type PlanCardRiskTone = "ok" | "warning" | "danger" | "neutral";

export type PlanCardRiskItem = {
  label: string;
  value: string;
  tone?: PlanCardRiskTone;
  /** true → render value in mono (prices, tickers, %); default true */
  mono?: boolean;
  /** quieter value — for honest "Next"/not-connected signals that must read as lower-priority */
  muted?: boolean;
};

export type PlanCardChecklistItem = {
  label: string;
  done: boolean;
  required?: boolean;
};

export type PlanCardAction = {
  label: string;
  tone?: "primary" | "neutral" | "warning" | "danger";
  disabled?: boolean;
  onClick?: () => void;
};

export type PlanCardProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  status: PlanCardStatus;
  statusLabel: string;
  instrument?: string;
  mode?: "Paper" | "Live" | "Preview" | "Next";
  /** dense cockpit variant — risk items render as a stacked metric grid, not full-width
      space-between rows (the fix for the sparse "debug table" look on wide surfaces). */
  dense?: boolean;
  riskItems: PlanCardRiskItem[];
  checklist?: PlanCardChecklistItem[];
  primaryAction?: PlanCardAction;
  secondaryAction?: PlanCardAction;
  footerNote?: string;
  className?: string;
  /** Optional slot rendered between the checklist and the actions — for interactive
      journal/config fields that don't fit the riskItems/checklist shape. */
  children?: React.ReactNode;
};

const STATUS_ICON: Record<PlanCardStatus, React.ReactNode> = {
  ready: <ShieldCheck size={13} weight="fill" />,
  caution: <Warning size={13} weight="fill" />,
  blocked: <Lock size={13} weight="fill" />,
  paper: <Circle size={13} weight="fill" />,
  next: <Circle size={13} weight="bold" />,
};

function ActionButton({ a, primary }: { a: PlanCardAction; primary?: boolean }) {
  return (
    <button
      type="button"
      className={`plan-btn plan-btn-${a.tone ?? (primary ? "primary" : "neutral")}`}
      disabled={a.disabled}
      onClick={a.onClick}
    >
      {a.label}
      {primary && !a.disabled ? <ArrowRight size={14} weight="bold" /> : null}
    </button>
  );
}

export function PlanCard({
  eyebrow, title, subtitle, status, statusLabel, instrument, mode, dense,
  riskItems, checklist, primaryAction, secondaryAction, footerNote, className, children,
}: PlanCardProps) {
  return (
    <section className={`plan-card plan-status-${status}${dense ? " plan-dense" : ""}${className ? ` ${className}` : ""}`} translate="no" aria-label={`Plan: ${title} — ${statusLabel}`}>
      <header className="plan-head">
        <div className="plan-head-main">
          {eyebrow ? <span className="plan-eyebrow">{eyebrow}</span> : null}
          <div className="plan-title-row">
            <h3 className="plan-title">{title}</h3>
            {mode ? <span className={`plan-mode plan-mode-${mode.toLowerCase()}`}>{mode}</span> : null}
          </div>
          {subtitle ? <p className="plan-subtitle">{subtitle}</p> : null}
        </div>
        <div className="plan-head-side">
          <span className="plan-status-pill" role="status">{STATUS_ICON[status]}{statusLabel}</span>
          {instrument ? <span className="plan-instrument">{instrument}</span> : null}
        </div>
      </header>

      {riskItems.length ? (
        <div className={`plan-risk${dense ? " plan-risk-grid" : ""}`}>
          {riskItems.map((r, i) => (
            <div className={`plan-risk-row${r.muted ? " muted" : ""}`} key={`${r.label}-${i}`}>
              <span className="plan-risk-k">{r.label}</span>
              <span className={`plan-risk-v${r.mono === false ? "" : " mono"} tone-${r.tone ?? "neutral"}`}>{r.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {checklist && checklist.length ? (
        <ul className="plan-checklist" aria-label="Plan checklist">
          {checklist.map((c, i) => (
            <li className={`plan-check${c.done ? " done" : ""}${c.required && !c.done ? " missing" : ""}`} key={`${c.label}-${i}`}>
              {c.done ? <Check size={13} weight="bold" /> : <Circle size={12} weight={c.required ? "bold" : "regular"} />}
              <span>{c.label}</span>
              {c.required && !c.done ? <em className="plan-req">required</em> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {children ? <div className="plan-slot">{children}</div> : null}

      {primaryAction || secondaryAction ? (
        <div className="plan-actions">
          {primaryAction ? <ActionButton a={primaryAction} primary /> : null}
          {secondaryAction ? <ActionButton a={secondaryAction} /> : null}
        </div>
      ) : null}

      {footerNote ? <p className="plan-foot">{footerNote}</p> : null}
    </section>
  );
}
