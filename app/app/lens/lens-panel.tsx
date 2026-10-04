"use client";

import { ArrowRight, Scales, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { rynHref } from "@/lib/agent/context";
import type { AgentBriefResponse, AgentContext, AgentCriticResponse, AgentFigure, AgentHandoff, AgentSentence } from "@/lib/api/v1/contract";

import styles from "./lens.module.css";
import { LENS_PANEL_ID, lensKey, setLensOpen, useLensOpen } from "./lens-open";
import { criticKindLabel, lensWordsFor, type LensWord } from "./lens-words";

/**
 * The Brief and the Critic where a person is deciding.
 *
 * One block on a surface that already has a subject — an asset, a plan, the
 * portfolio, the record. The block is closed until the person presses
 * *Ask Ryn*: on a page that has its own *Ask Ryn* beside its actions
 * (`trigger="page"`, the press is `AskRynLens`) the closed block draws
 * nothing; elsewhere (`trigger="own"`) it draws that one press and nothing
 * else. Once open, the Brief loads for the proven wallet and costs nothing:
 * `compose: "deterministic"` never reaches a model. The Critic is an
 * explicit press, because being argued with is something a person asks for;
 * it is the one call that may reach the model, and it does so under the
 * wallet's **existing** agent allowance — there is no second budget anywhere
 * in this panel.
 *
 * The shape is fixed: **Brief → Critic → Plan/Review**. What the person
 * reads first is two sections; the data, the gaps and the checks are folded
 * under one control, and the sources under another. Nothing here is an
 * instruction: the boundary is said in the foot, and the server drops a
 * directive sentence before it ever arrives.
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

type Phase =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "brief"; response: AgentBriefResponse }
  | { status: "critic"; brief: AgentBriefResponse | null; response: AgentCriticResponse }
  | { status: "failed"; reason: string };

/** A Critic that did not answer must not take the Brief with it: the failure is said, and what was read stays on the page. */
type Failure = Readonly<{ reason: string }> | null;

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return { code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? `HTTP ${response.status}` };
  } catch {
    return { code: "UNAVAILABLE", message: `HTTP ${response.status}` };
  }
}

/**
 * A moment in the reader's own clock — the page runs in their browser, so
 * their zone is the one to show: local time on the surface, never a bare
 * UTC stamp.
 */
function localMoment(iso: string, locale: WorkspaceLocale): string {
  return new Date(iso).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function Section({ title, rows }: { title: string; rows: readonly AgentSentence[] }) {
  if (rows.length === 0) return null;
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      <ul className={styles.sentences}>
        {rows.map((row, index) => (
          <li key={`${title}-${index}`}>{row.text}</li>
        ))}
      </ul>
    </section>
  );
}

function Figures({ figures, word }: { figures: readonly AgentFigure[]; word: (key: LensWord) => string }) {
  if (figures.length === 0) return null;
  const stateWord = (state: AgentFigure["state"]) => word(state === "current" ? "stateCurrent" : state === "stale" ? "stateStale" : state === "unavailable" ? "stateUnavailable" : "stateUnknown");
  return (
    <dl className={styles.figures}>
      {figures.map((figure, index) => (
        <div key={`${figure.label}-${index}`} className={styles.figure} data-state={figure.state}>
          <dt>{figure.label}</dt>
          <dd>
            <span className={styles.value}>{figure.value}</span>
            {/* A figure with no number already reads as its own state; saying it twice is noise. */}
            {figure.state !== "current" && figure.value !== stateWord(figure.state) ? <span className={styles.stateTag}>{stateWord(figure.state)}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Handoffs({ handoffs, demote = false }: { handoffs: readonly AgentHandoff[]; demote?: boolean }) {
  return (
    <>
      {handoffs.slice(0, 3).map((handoff) => (
        <Link key={handoff.href} className={handoff.primary && !demote ? "rw-btn rw-btn--primary" : "rw-btn"} href={handoff.href} prefetch={false}>
          <span>{handoff.label}</span>
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      ))}
    </>
  );
}

/**
 * What the read stood on, one press deep: each source by its name, when it
 * was read and whether it was current. No citation ids — «c1», «c3» are the
 * engine's bookkeeping, not words for a person.
 */
function Sources({ citations, locale, word }: { citations: AgentBriefResponse["citations"]; locale: WorkspaceLocale; word: (key: LensWord) => string }) {
  if (citations.length === 0) return null;
  return (
    <details className={styles.fold}>
      <summary>{word("sources")}</summary>
      <ul className={styles.sourceList}>
        {citations.map((citation) => (
          <li key={citation.id}>
            {citation.source}
            {citation.observedAt ? ` · ${localMoment(citation.observedAt, locale)}` : ""} ·{" "}
            {word(citation.state === "current" ? "stateCurrent" : citation.state === "stale" ? "stateStale" : citation.state === "unavailable" ? "stateUnavailable" : "stateUnknown")}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function LensPanel({
  subject,
  locale,
  trigger = "own",
  frameClassName,
}: {
  subject: AgentContext;
  locale: WorkspaceLocale;
  /** `page` when the page draws its own *Ask Ryn* (`AskRynLens`); `own` draws the one press here. */
  trigger?: "own" | "page";
  /** A layout box the open block sits in; absent while closed, so a closed block leaves no empty frame. */
  frameClassName?: string;
}) {
  const word = useMemo(() => lensWordsFor(locale === "uk" ? "uk" : "en"), [locale]);
  const subjectKey = JSON.stringify(subject);
  const openKey = lensKey(subject);
  const open = useLensOpen(openKey);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [failure, setFailure] = useState<Failure>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(
    async (format: "brief" | "critic", compose: "deterministic" | "model") => {
      setWorking(true);
      setFailure(null);
      if (format === "brief") setPhase({ status: "reading" });
      try {
        const response = await fetch(`/api/v1/agent/${format}`, {
          method: "POST",
          headers: HEADERS,
          credentials: "same-origin",
          body: JSON.stringify({ subject: JSON.parse(subjectKey) as AgentContext, locale: locale === "uk" ? "uk" : "en", compose }),
        });
        if (!response.ok) {
          const answered = await readError(response);
          const reason = answered.code === "AGENT_BUSY" ? word("busy") : word("failed");
          setFailure({ reason });
          if (format === "brief") setPhase({ status: "failed", reason });
          return;
        }
        if (format === "brief") {
          setPhase({ status: "brief", response: (await response.json()) as AgentBriefResponse });
          return;
        }
        const critic = (await response.json()) as AgentCriticResponse;
        setPhase((current) => ({ status: "critic", brief: current.status === "brief" ? current.response : current.status === "critic" ? current.brief : null, response: critic }));
      } catch {
        setFailure({ reason: word("failed") });
        if (format === "brief") setPhase({ status: "failed", reason: word("failed") });
      } finally {
        setWorking(false);
      }
    },
    [locale, subjectKey, word],
  );

  useEffect(() => {
    /* A wallet that is no longer the proven one leaves nothing of its reads on the page. */
    if (!proven) {
      setPhase({ status: "idle" });
      setFailure(null);
    }
  }, [proven]);

  useEffect(() => {
    /* The Brief reads once the person opened the block, for the proven wallet, and spends nothing; the Critic waits to be asked. */
    if (open && proven && phase.status === "idle") void load("brief", "deterministic");
  }, [open, proven, phase.status, load]);

  useEffect(() => {
    /* Opened by a press somewhere on the page: bring the block into view, never on first paint. */
    if (open && !wasOpen.current && panelRef.current) {
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      panelRef.current.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
    }
    wasOpen.current = open;
  }, [open]);

  /* Leaving the page closes the block, so the next visit starts on the page's own first screen. */
  useEffect(() => () => setLensOpen(openKey, false), [openKey]);

  const shown = phase.status === "critic" ? phase.response : phase.status === "brief" ? phase.response : null;
  const title = shown?.title ?? `${word("brief")}`;

  if (!open) {
    if (trigger === "page") return null;
    return (
      <div className={frameClassName ? `${frameClassName} ${styles.closed}` : styles.closed} data-lens={subject.kind}>
        <button type="button" className="rw-btn" aria-expanded={false} aria-controls={LENS_PANEL_ID} data-ask-ryn={subject.kind} onClick={() => setLensOpen(openKey, true)}>
          <Sparkle size={16} weight="bold" aria-hidden="true" />
          <span>{word("askRyn")}</span>
        </button>
      </div>
    );
  }

  const panel = (
    <section ref={panelRef} id={LENS_PANEL_ID} className={styles.panel} data-lens={subject.kind} data-format={phase.status === "critic" ? "critic" : "brief"} aria-label={title}>
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <span className={styles.headEnd}>
          {shown ? <span className={styles.meta}>{shown.composedBy === "model" ? word("composedModel") : word("composedDeterministic")}</span> : null}
          <button type="button" className={styles.close} aria-expanded={true} aria-controls={LENS_PANEL_ID} onClick={() => setLensOpen(openKey, false)}>
            {word("less")}
          </button>
        </span>
      </header>

      {!proven ? (
        <>
          <p className={styles.muted}>{word("connect")}</p>
          <div className={styles.actions}>
            <Link className="rw-btn" href={rynHref(subject)} prefetch={false}>
              <Sparkle size={16} weight="bold" aria-hidden="true" />
              <span>{word("chat")}</span>
            </Link>
          </div>
        </>
      ) : null}

      {phase.status === "reading" ? <p className={styles.muted}>{word("reading")}</p> : null}
      {failure ? <p className={styles.error}>{failure.reason}</p> : null}

      {phase.status === "brief" || (phase.status === "critic" && phase.brief) ? (
        (() => {
          const brief = phase.status === "brief" ? phase.response.brief : phase.brief!.brief;
          if (brief.insufficient) return <p className={styles.muted}>{word("insufficient")}</p>;
          return (
            <div className={styles.sections}>
              <Section title={word("changed")} rows={brief.changed} />
              <Section title={word("matters")} rows={brief.matters} />
              <details className={styles.fold}>
                <summary>{word("more")}</summary>
                <div className={styles.foldBody}>
                  <Section title={word("supports")} rows={brief.supports} />
                  <Section title={word("unknown")} rows={brief.unknown} />
                  <Section title={word("checks")} rows={brief.checks} />
                </div>
              </details>
            </div>
          );
        })()
      ) : null}

      {phase.status === "critic" ? (
        <div className={styles.sections}>
          <section className={styles.section}>
            <h3>{word("critic")}</h3>
            {phase.response.critic.insufficient ? (
              <p className={styles.muted}>{word("criticInsufficient")}</p>
            ) : (
              <ol className={styles.findings}>
                {phase.response.critic.findings.map((finding) => (
                  <li key={finding.id} className={styles.finding} data-state={finding.state} data-kind={finding.kind}>
                    <span className={styles.kind}>{criticKindLabel(finding.kind, locale === "uk" ? "uk" : "en")}</span>
                    <p className={styles.findingText}>{finding.text}</p>
                    <Figures figures={finding.figures} word={word} />
                  </li>
                ))}
              </ol>
            )}
          </section>
          <details className={styles.fold}>
            <summary>{word("gaps")}</summary>
            <div className={styles.foldBody}>
              <ul className={styles.sentences}>
                {phase.response.critic.gaps.map((gap, index) => (
                  <li key={`gap-${index}`}>{gap.text}</li>
                ))}
              </ul>
              <p className={styles.muted}>{word("notChallenged")}</p>
            </div>
          </details>
        </div>
      ) : null}

      {proven && (phase.status === "brief" || phase.status === "critic") ? (
        <div className={styles.actions}>
          {/* Brief → Critic → Plan/Review: from the Brief the next step is being argued with, so that is the primary control; once the Critic has spoken, the plan and its Review are. */}
          {phase.status === "brief" ? (
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => void load("critic", "model")} disabled={working} data-lens-critic="">
              <Scales size={16} weight="bold" aria-hidden="true" />
              <span>{working ? word("challenging") : word("challenge")}</span>
            </button>
          ) : (
            <button type="button" className="rw-btn" onClick={() => void load("brief", "deterministic")} disabled={working}>
              <span>{word("againBrief")}</span>
            </button>
          )}
          {shown ? <Handoffs handoffs={shown.handoffs} demote={phase.status === "brief"} /> : null}
          <Link className="rw-btn" href={rynHref(subject)} prefetch={false}>
            <Sparkle size={16} weight="bold" aria-hidden="true" />
            <span>{word("chat")}</span>
          </Link>
        </div>
      ) : null}

      {shown ? <Sources citations={shown.citations} locale={locale} word={word} /> : null}

      <p className={styles.foot}>
        <span>{word("boundary")}</span>
        {shown ? (
          <span>
            {word("observed")} {localMoment(shown.observedAt, locale)}
          </span>
        ) : null}
      </p>
    </section>
  );
  return frameClassName ? <div className={frameClassName}>{panel}</div> : panel;
}
