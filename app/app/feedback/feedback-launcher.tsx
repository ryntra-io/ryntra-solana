"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatCircleDots, X } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import styles from "./feedback.module.css";

/**
 * Feedback, where the people are.
 *
 * A row in the rail's foot, beside Settings, on
 * every page of the cabinet and in the phone's More drawer, opening one small
 * dialog: what kind of message, the message, a way to reach the person if
 * they want one. The page it was written from and the connected wallet travel
 * with it, so the operator sees who wrote and where — and says so on the
 * form, in one line, before the person presses Send.
 *
 * Nothing here is a support promise: the dialog says what happens next in
 * one sentence and shows the reference the inbox gave the thread.
 */

const TOPICS = ["question", "idea", "bug", "security"] as const;
type Topic = (typeof TOPICS)[number];

const TOPIC_LABEL: Record<Topic, string> = {
  question: "Question",
  idea: "Idea",
  bug: "Bug",
  security: "Security",
};

const TOPIC_HINT: Record<Topic, string> = {
  question: "Ask anything about how Ryntra works.",
  idea: "What would make the product better for you.",
  bug: "What you did, what you expected, what happened instead.",
  security: "Marked and read first. Do not include seed phrases or keys.",
};

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; ref: string }
  | { status: "failed"; reason: string };

export function FeedbackLauncher() {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<Topic>("question");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<SendState>({ status: "idle" });
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wallet = connection?.address ?? null;

  const close = useCallback(() => {
    setOpen(false);
    setState({ status: "idle" });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, close]);

  const send = useCallback(async () => {
    const message = body.trim();
    if (message.length < 10) {
      setState({ status: "failed", reason: text("Write a little more — at least ten characters.") });
      return;
    }
    setState({ status: "sending" });
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          topic,
          body: message,
          contact: contact.trim() || undefined,
          wallet: wallet ?? undefined,
          route: pathname,
          locale,
        }),
      });
      if (response.status === 429) {
        setState({ status: "failed", reason: text("Too many messages in a row. Try again in a few minutes.") });
        return;
      }
      if (!response.ok) {
        setState({ status: "failed", reason: text("The message could not be saved right now. Try again in a moment.") });
        return;
      }
      const json = (await response.json()) as { ref?: string };
      setState({ status: "sent", ref: json.ref ?? "" });
      setBody("");
      setContact("");
    } catch {
      setState({ status: "failed", reason: text("The message could not be saved right now. Try again in a moment.") });
    }
  }, [body, contact, locale, pathname, text, topic, wallet]);

  const dialog = open ? (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>{text("Feedback")}</h2>
          <button type="button" className={styles.close} onClick={close} aria-label={text("Close")}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {state.status === "sent" ? (
          <div className={styles.sent}>
            <p className={styles.sentLead}>{text("Received. Thank you.")}</p>
            {state.ref ? (
              <p className={styles.sentRef}>
                <span className={styles.sentRefLabel}>{text("Reference")}</span>
                <code translate="no">{state.ref}</code>
              </p>
            ) : null}
            <p className={styles.note}>{text("We read every message. If you left a contact, the answer comes there.")}</p>
            <button type="button" className={styles.primary} onClick={close}>{text("Done")}</button>
          </div>
        ) : (
          <>
            <div className={styles.topics} role="radiogroup" aria-label={text("What is it about")}>
              {TOPICS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={topic === item}
                  className={styles.topic}
                  data-topic={item}
                  onClick={() => setTopic(item)}
                >
                  {text(TOPIC_LABEL[item])}
                </button>
              ))}
            </div>
            <p className={styles.hint}>{text(TOPIC_HINT[topic])}</p>

            <label className={styles.field}>
              <span className={styles.label}>{text("Your message")}</span>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                rows={5}
                maxLength={4000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={text("What happened, or what should change")}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>
                {text("How to reach you")} <span className={styles.optional}>{text("optional")}</span>
              </span>
              <input
                className={styles.input}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder={text("Telegram @name or email")}
                maxLength={120}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <p className={styles.context} translate="no">
              {text("Attached")}: <span>{pathname}</span>
              {wallet ? <span> · {text("wallet")} {wallet.slice(0, 4)}…{wallet.slice(-4)}</span> : null}
            </p>

            {state.status === "failed" ? <p className={styles.error} role="alert">{state.reason}</p> : null}

            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void send()} disabled={state.status === "sending" || body.trim().length < 10}>
                {text(state.status === "sending" ? "Sending…" : "Send")}
              </button>
              <button type="button" className={styles.secondary} onClick={close}>{text("Cancel")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button type="button" className={`rs-link ${styles.launch}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <span className="rs-link-ic" aria-hidden="true">
          <ChatCircleDots size={17} weight="bold" />
        </span>
        <span className="rs-link-label">{text("Feedback")}</span>
      </button>
      {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
