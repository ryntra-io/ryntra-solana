"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { Help } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AddressEvidenceReadDto } from "@/lib/api/v1/contract";
import { summarizeAddressEvidence, type AddressEvidenceSummary } from "@/lib/evidence/address";

import risk from "./risk.module.css";
import { bandWord, fmtWhen, riskWordsFor, sanctionsWord, summaryWord } from "./risk-words";

/**
 * The recipient check — one line before a person signs a transfer, from
 * the security provider's two engines (sanctions screening, findings), and
 * the details one press away. It reads the address once it is a valid
 * Solana address and the person has stopped typing; the server keeps a copy
 * an hour, so a second transfer to the same address costs nothing.
 *
 * Six honest words and no seventh: *nothing found among what the source
 * keeps* (never "safe"), *risk evidence found*, *on a sanctions list the
 * source keeps*, *partly checked* (one engine answered, the other did not),
 * *the source cannot analyse this kind of address* (a program, a vault, an
 * exchange contract — never read as clean), *unable to verify right now*.
 * Ryntra never stops the transfer on any of them: the words are the person's
 * information, the decision is theirs.
 */

type Fetched = Readonly<{ status: "idle" } | { status: "loading" } | { status: "done"; read: AddressEvidenceReadDto }>;

const TONE: Readonly<Record<AddressEvidenceSummary, "none" | "flags" | "muted" | "stop">> = {
  "nothing-found": "none",
  "evidence-found": "flags",
  sanctioned: "stop",
  "partly-checked": "muted",
  unsupported: "muted",
  unavailable: "muted",
};

export function RecipientCheck({ address, locale }: { address: string | null; locale: WorkspaceLocale }) {
  const word = useMemo(() => riskWordsFor(locale), [locale]);
  const [state, setState] = useState<Fetched>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!address) {
      setState({ status: "idle" });
      setOpen(false);
      return;
    }
    let live = true;
    setState({ status: "loading" });
    setOpen(false);
    /* The person has stopped typing: one read per settled address. */
    const timer = globalThis.setTimeout(() => {
      fetch(`/api/v1/research/address-evidence?address=${encodeURIComponent(address)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } })
        .then(async (response) => (response.ok ? ((await response.json()) as AddressEvidenceReadDto) : null))
        .catch(() => null)
        .then((read) => {
          if (!live) return;
          setNow(Date.now());
          setState({ status: "done", read: read ?? { state: "UNAVAILABLE", evidence: null, reason: null, served: "none" } });
        });
    }, 700);
    return () => {
      live = false;
      globalThis.clearTimeout(timer);
    };
  }, [address]);

  if (!address || state.status === "idle") return null;

  const read = state.status === "done" ? state.read : null;
  const summary = read ? summarizeAddressEvidence(read) : null;
  const evidence = read?.evidence ?? null;
  const tone = summary ? TONE[summary] : "muted";
  const when = evidence?.observedAt ?? evidence?.fetchedAt ?? null;

  return (
    <div className={risk.recipient} data-tone={tone} aria-live="polite">
      <div className={risk.recipientHead}>
        <span className={risk.dot} data-tone={tone} aria-hidden="true" />
        <span className={risk.recipientTitle}>
          {word("recipientTitle")}
          <Help topic="recipientCheck" locale={locale} />
        </span>
        <span className={risk.recipientLine}>
          {state.status === "loading" ? word("recipientChecking") : summary ? summaryWord(summary, locale) : word("recipientUnavailable")}
          {summary === "nothing-found" ? <span className={risk.launchNote}> · {word("recipientNotSafe")}</span> : null}
        </span>
        {read && evidence ? (
          <button type="button" className={risk.recipientMore} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {word("details")}
          </button>
        ) : null}
      </div>
      {open && evidence ? (
        <dl className={risk.recipientDetails}>
          <div>
            <dt>{word("findings")}</dt>
            <dd translate="no">
              {evidence.findings.state === "answered"
                ? (evidence.findings.high ?? 0) > 0 || (evidence.findings.medium ?? 0) > 0
                  ? [evidence.findings.high ? `${evidence.findings.high} ${word("findingsHigh")}` : null, evidence.findings.medium ? `${evidence.findings.medium} ${word("findingsMedium")}` : null].filter(Boolean).join(" · ") + ` ${word("findingsSeverity")}`
                  : word("findingsNone")
                : evidence.findings.state === "unsupported"
                  ? word("findingsUnsupported")
                  : word("findingsUnavailable")}
              {evidence.findings.state === "answered" && evidence.findings.score !== null && evidence.findings.band ? ` · ${word("sourceFigure")} ${evidence.findings.score} — ${bandWord(evidence.findings.band, locale)} ${word("sourceBand")}` : ""}
            </dd>
          </div>
          <div>
            <dt>{word("sanctions")}</dt>
            <dd>
              {sanctionsWord(evidence.sanctions.state, locale)}
              {evidence.sanctions.related === true ? ` · ${word("sanctionsRelated")}` : ""}
            </dd>
          </div>
          {evidence.findings.state === "unsupported" ? (
            <div>
              <dt>{word("addressKindProgram")}</dt>
              <dd>{word("recipientProgramNote")}</dd>
            </div>
          ) : null}
          <div>
            <dt>{evidence.observedAt ? word("observedAt") : word("askedAt")}</dt>
            <dd translate="no">
              {when ? fmtWhen(when, locale, now) : "—"}
              {read?.state === "STALE" ? ` · ${word("stateStale")}` : ""}
              {" · "}
              <a href={evidence.attribution.href} target="_blank" rel="noreferrer noopener">
                {evidence.attribution.text}
                <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
              </a>
            </dd>
          </div>
          <p className={risk.recipientFoot}>{word("recipientYourCall")}</p>
        </dl>
      ) : null}
      {read && !evidence && read.reason ? <p className={risk.recipientFoot}>{read.reason}</p> : null}
    </div>
  );
}
