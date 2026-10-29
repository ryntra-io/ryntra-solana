"use client";

import { Flag } from "@phosphor-icons/react";
import { Button } from "@ryntra/core/ui";
import { useState } from "react";

import feedback from "@/app/app/feedback/feedback.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { launchWords, type LaunchWordKey } from "../launch-words";

/**
 * «Поскаржитися на токен» (MC-1): a report on a launched token from its own page, into the inbox the team already reads
 * (`/api/feedback`, topic `report`, read first as security is). The token's address and page travel with it; what
 * Ryntra does with a report is the takedown the terms name (`app/legal/terms/launch.ts`). Nothing here hides anything.
 */

const REASONS = ["scam", "pretends", "picture", "other"] as const;
type Reason = (typeof REASONS)[number];
const REASON_WORD: Record<Reason, LaunchWordKey> = { scam: "reportScam", pretends: "reportPretends", picture: "reportPicture", other: "reportOther" };

type State = { status: "closed" } | { status: "open" } | { status: "sending" } | { status: "sent"; ref: string } | { status: "failed"; word: LaunchWordKey };

export function ReportToken({ mint, symbol, locale }: { mint: string; symbol: string; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const [state, setState] = useState<State>({ status: "closed" });
  const [reason, setReason] = useState<Reason>("scam");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");

  if (state.status === "closed") {
    return (
      <Button variant="ghost" onClick={() => setState({ status: "open" })} lang={locale === "uk" ? "uk" : "en"}>
        <Flag size={16} aria-hidden /> {word("reportOpen")}
      </Button>
    );
  }
  if (state.status === "sent") {
    return (
      <div className={feedback.sent} role="status">
        <p className={feedback.sentLead}>{word("reportSent")}</p>
        {state.ref ? (
          <p className={feedback.sentRef}>
            <code translate="no">{state.ref}</code>
          </p>
        ) : null}
      </div>
    );
  }

  const send = async () => {
    setState({ status: "sending" });
    const body = [`Report: $${symbol} · ${mint}`, `Reason: ${reason}`, note.trim()].filter(Boolean).join("\n");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "app", topic: "report", body, contact: contact.trim() || undefined, route: window.location.pathname, locale }),
      });
      if (response.status === 429) return setState({ status: "failed", word: "reportRateLimited" });
      if (!response.ok) return setState({ status: "failed", word: "reportFailed" });
      const json = (await response.json().catch(() => ({}))) as { ref?: string };
      setState({ status: "sent", ref: json.ref ?? "" });
    } catch {
      setState({ status: "failed", word: "reportFailed" });
    }
  };

  return (
    <form
      className={feedback.form}
      aria-label={word("reportOpen")}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={feedback.reasons} role="radiogroup" aria-label={word("reportWhy")}>
        {REASONS.map((item) => (
          <button key={item} type="button" role="radio" aria-checked={reason === item} className={feedback.topic} onClick={() => setReason(item)}>
            {word(REASON_WORD[item])}
          </button>
        ))}
      </div>
      <label className={feedback.field}>
        <span className={feedback.label}>
          {word("reportNote")} <span className={feedback.optional}>{word("reportOptional")}</span>
        </span>
        <textarea className={feedback.textarea} rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label className={feedback.field}>
        <span className={feedback.label}>
          {word("reportContact")} <span className={feedback.optional}>{word("reportOptional")}</span>
        </span>
        <input className={feedback.input} value={contact} onChange={(event) => setContact(event.target.value)} maxLength={120} autoComplete="off" spellCheck={false} />
      </label>
      {state.status === "failed" ? (
        <p className={feedback.error} role="alert">
          {word(state.word)}
        </p>
      ) : null}
      <div className={feedback.actions}>
        <button type="submit" className={feedback.primary} disabled={state.status === "sending"}>
          {word(state.status === "sending" ? "reportSending" : "reportSend")}
        </button>
      </div>
    </form>
  );
}
