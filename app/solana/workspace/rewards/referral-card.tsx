"use client";

import { Check } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { referralCopy, referralDeadline } from "./referral-copy.ts";
import { walletCopy } from "./wallet-copy.ts";
import styles from "./rewards.module.css";

/**
 * Who invited you — set on its own, changeable once.
 *
 * ## Why there is no «Confirm» any more
 *
 * The first version bound nothing until the person pressed «Confirm inviter»
 * on this page. Most never saw it: friends opened a link, connected a
 * wallet, traded, and were never bound (08.10: «не кожен ходить і
 * нажимає цю кнопку… зайшов — автоматом підв'язалося»). Now the invitation a
 * browser carries binds on its own the first time that browser proves a
 * wallet (`GET /api/rewards/referral` does it), and this card mostly *reports*
 * what happened.
 *
 * ## The states
 *
 * **Carried, not yet bound** — a visitor, or a wallet not proven yet: who
 * invited them, and that it will be set on its own once the wallet is
 * confirmed. The page's own «Confirm wallet» is the one action; this card
 * offers only a different code or walking away.
 *
 * **Bound** — one row, «Invited by …», and while the window is open, one quiet
 * «Change»: once, before the first trade or within seven days after it. A
 * link for somebody else opened afterwards is offered as that one change.
 *
 * **Too late** — the first trade was over seven days ago: said plainly, never
 * "this wallet already has an inviter", with nothing to press but walking away.
 *
 * A full wallet address never reaches this component: masking happens on the
 * server.
 */

type Party = Readonly<{ code?: string; inviterMasked: string; codeMasked: string | null }>;

/** A window: before the first trade (`until` null), seven days after it, then shut. */
type Window = Readonly<{ open: boolean; until: string | null }>;

export type ReferralState = Readonly<{
  pending: Party | null;
  confirmed: Party | null;
  binding?: Window;
  change?: Window;
  bound?: true;
}>;

export type Referral = Readonly<{ state: ReferralState | null; load: () => Promise<void> }>;

/**
 * The invitation this browser carries and, for a proven wallet, its binding —
 * read once and shared, so the page can place the card where an open
 * invitation belongs without reading it twice. The read itself binds a carried
 * code for a proven wallet.
 */
export function useReferral(wallet: string | null, proven: boolean, invitedBy: string | null = null, enabled = true): Referral {
  /* Tagged with the wallet it was read for: after a switch of account in the
     wallet, the previous wallet's answer — its binding, its news — is never
     shown for the new one, not even for one render. */
  const [read, setRead] = useState<Readonly<{ wallet: string | null; data: ReferralState }> | null>(null);
  const state = read && read.wallet === wallet ? read.data : null;
  const alive = useRef(true);
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/rewards/referral?address=${encodeURIComponent(wallet ?? "")}`);
      if (!response.ok) return;
      const next = await response.json() as ReferralState;
      if (alive.current && currentWallet.current === wallet) setRead({ wallet, data: next });
    } catch {
      /* Rewards must not fail because the invitation could not be read. */
    }
  }, [wallet]);

  useEffect(() => {
    if (enabled) void load();
  }, [load, invitedBy, proven, enabled]);

  return { state, load };
}

export function ReferralCard({
  wallet,
  /** Set once the wallet's own rewards read says it already has an inviter. */
  invitedBy,
  proven,
  referral,
  onProve,
  onBound,
}: {
  wallet: string | null;
  invitedBy: string | null;
  proven: boolean;
  referral: Referral;
  onProve: () => Promise<boolean | undefined>;
  onBound: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const words = referralCopy(locale);
  const { state, load } = referral;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<Party | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /* A new message is brought into view once — centred, so a phone's bottom
     bar cannot cover it — and not again on every keystroke. */
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ block: "center" });
  }, [notice]);
  /* The same for a found code: its action must not sit under the bottom bar. */
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: "center" });
  }, [preview]);

  /* A read that just bound the carried code: the page's own figures follow —
     once per wallet. */
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (state?.bound && wallet && reported.current !== wallet) { reported.current = wallet; onBound(); }
  }, [state?.bound, wallet, onBound]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/rewards/referral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }, []);

  const refusal = useCallback((reason: string): string =>
    reason === "PROOF_REQUIRED" ? walletCopy(locale).inviterFirst
      : reason === "SELF_REFERRAL" ? text("That is your own link.")
        : reason === "ALREADY_REFERRED" ? text("This wallet already has an inviter.")
          : reason === "ALREADY_EARNING" ? words.refusedLate
            : reason === "ALREADY_CHANGED" ? words.refusedChanged
              : reason === "CYCLE" ? text("Those two wallets cannot invite each other.")
                : words.notFound,
  [text, words, locale]);

  const closeEditor = useCallback(() => {
    setEditing(false);
    setPreview(null);
    setDraft("");
  }, []);

  /** Look up a typed code or link without choosing it. */
  const lookUp = useCallback(async () => {
    setNotice(null);
    setPreview(null);
    const code = draft.trim();
    if (!code) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/rewards/referral?code=${encodeURIComponent(code)}`);
      const found = (await response.json()) as { found?: boolean; preview?: Party | null };
      if (!found.found || !found.preview) {
        setNotice(words.notFound);
        return;
      }
      setPreview(found.preview);
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [draft, text, words]);

  /** Before a binding: the previewed code becomes the one this browser carries. */
  const adoptCode = useCallback(async () => {
    if (!preview?.code) return;
    setBusy(true);
    try {
      const result = await post({ action: "pending", code: preview.code });
      if (result.status === 200) {
        closeEditor();
        await load();
      } else {
        setNotice(words.notFound);
      }
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [preview, post, load, text, words, closeEditor]);

  /** Bind, or make the one change, to this code. Needs the proven wallet. */
  const settle = useCallback(async (code: string | undefined, action: "confirm" | "change") => {
    if (!code || !wallet) { setNotice(walletCopy(locale).inviterFirst); return; }
    setNotice(null);
    setBusy(true);
    try {
      if (!proven && await onProve() !== true) return;
      if (!alive.current || currentWallet.current !== wallet) return;
      const result = await post({ action, code, address: wallet });
      if (!alive.current || currentWallet.current !== wallet) return;
      if (result.status === 200) {
        closeEditor();
        await load();
        onBound();
        return;
      }
      const reason = String(result.body.reason ?? "");
      setNotice(refusal(reason));
      /* The refusal may have told the server's side of a window the card did
         not know was shut — ask again so nothing stays offered. */
      if (reason === "ALREADY_EARNING" || reason === "ALREADY_CHANGED") await load();
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [wallet, proven, onProve, post, load, onBound, text, refusal, closeEditor, locale]);

  const dismiss = useCallback(async () => {
    setBusy(true);
    try {
      await post({ action: "dismiss" });
      closeEditor();
      await load();
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [post, load, text, closeEditor]);

  const settled = state?.confirmed?.inviterMasked ?? invitedBy ?? null;
  const pending = state?.pending ?? null;
  const editor = (title: string, mode: "adopt" | "change") => (
    <>
      <p className={styles.pendingTitle}>{title}</p>
      {/* The consequence before the action, not under it. */}
      {mode === "change" ? <p className={styles.pendingLead}>{words.changeOnce}</p> : null}
      <div className={styles.linkRow}>
        <input
          className={styles.link}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) void lookUp(); }}
          placeholder={words.codeOrLink}
          aria-label={words.codeOrLink}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div className={styles.pendingActions}>
          <button type="button" className={styles.linkAction} onClick={() => void lookUp()} disabled={busy || draft.trim().length === 0}>
            {text("Look up")}
          </button>
          <button type="button" className={styles.quietAction} onClick={() => { closeEditor(); setNotice(null); }} disabled={busy}>
            {text("Cancel")}
          </button>
        </div>
      </div>
      {preview ? (
        <div className={styles.previewRow} ref={previewRef}>
          <span className={styles.pendingLead}>
            {mode === "change" ? words.newInviter : text("Invited by")} <b translate="no">{preview.inviterMasked}</b>
          </span>
          <button
            type="button"
            className={styles.claim}
            onClick={() => void (mode === "change" ? settle(preview.code, "change") : adoptCode())}
            disabled={busy}
          >
            {mode === "change" ? words.changeConfirm : proven ? words.linkCode : text("Use this code")}
          </button>
        </div>
      ) : null}
    </>
  );

  /* ── Bound ─────────────────────────────────────────────────────────── */
  if (settled) {
    const change = state?.change ?? null;
    const changeUntil = change?.open && change.until ? referralDeadline(change.until, locale) : null;
    const offer = change?.open ? pending : null;
    const row = (
      <section className={styles.invited} aria-label={text("Your inviter")} data-referral="confirmed">
        <span className={styles.invitedLabel}>{text("Invited by")}</span>
        <span className={styles.invitedWho} translate="no">{settled}</span>
        <span className={styles.invitedMark}>
          <Check size={12} weight="bold" aria-hidden="true" />
          {words.setMark}
        </span>
      </section>
    );
    if (editing) {
      return (
        <div className={styles.invitedStack}>
          {row}
          <section className={styles.pending} aria-label={words.changeTitle} data-referral="changing">
            {editor(words.changeTitle, "change")}
            {notice ? <p className={styles.error} role="alert" ref={noticeRef}>{notice}</p> : null}
          </section>
        </div>
      );
    }
    return (
      <div className={styles.invitedStack}>
        {row}
        {offer ? (
          <section className={styles.pending} aria-label={words.changeTitle} data-referral="offer-change">
            <p className={styles.pendingLead}>{words.changeOffer(offer.inviterMasked, changeUntil)}</p>
            <div className={styles.pendingActions}>
              <button type="button" className={styles.linkAction} onClick={() => void settle(offer.code, "change")} disabled={busy}>
                {words.changeTo(offer.inviterMasked)}
              </button>
              <button type="button" className={styles.quietAction} onClick={() => void dismiss()} disabled={busy}>
                {words.keep}
              </button>
            </div>
          </section>
        ) : change?.open ? (
          <p className={styles.changeHint}>
            <span>{changeUntil ? words.changeHintUntil(changeUntil) : words.changeHint}</span>
            <button type="button" className={styles.inlineAction} onClick={() => { setNotice(null); setEditing(true); }}>
              {words.changeAction}
            </button>
          </p>
        ) : null}
        {notice ? <p className={styles.error} role="alert" ref={noticeRef}>{notice}</p> : null}
      </div>
    );
  }

  /* Not read yet (loading, a refusal, a network fault): offer nothing — a
     closed wallet must never be invited to type a code that will be refused. */
  if (!state) return null;

  /* Unknown until the wallet is proven; known and shut — nothing to bind. */
  const closed = state.binding?.open === false;
  const until = state.binding?.open && state.binding.until ? referralDeadline(state.binding.until, locale) : null;

  /* Too late and nobody being considered: nothing to do, so nothing drawn. */
  if (closed && !pending) return null;

  /* Too late with a carried link: one quiet line, the answer, and a way to put
     it away — not a card that asks for nothing. */
  if (closed && pending) {
    return (
      <p className={styles.changeHint} data-referral="closed">
        <span>{words.windowClosed(pending.inviterMasked)}</span>
        <button type="button" className={styles.inlineAction} onClick={() => void dismiss()} disabled={busy}>
          {words.hide}
        </button>
      </p>
    );
  }

  if (!pending && !editing) {
    return (
      <section className={styles.codeOffer} data-referral="offer">
        <span className={styles.codeOfferLead}>{text("Have a code or link?")}</span>
        <button type="button" className={styles.linkAction} onClick={() => setEditing(true)}>
          {text("Enter code")}
        </button>
      </section>
    );
  }

  /* ── Carried, not bound: report it, it binds on its own ─────────────── */
  /* A proven wallet whose open invitation did not bind on its own (its own
     link, a cycle) keeps an explicit «Confirm» — the refusal then says why. */
  const stuck = proven && Boolean(pending);
  return (
    <section
      className={styles.pending}
      aria-label={text("Referral invitation")}
      data-referral={editing ? "editing" : stuck ? "stuck" : until ? "window" : "pending"}
    >
      {pending && !editing ? (
        <>
          <p className={styles.pendingTitle}>{text("Referral invitation detected")}</p>
          <dl className={styles.pendingFacts}>
            <div>
              <dt>{text("Invited by")}</dt>
              <dd translate="no">{pending.inviterMasked}</dd>
            </div>
            {pending.codeMasked ? (
              <div>
                <dt>{text("Referral code")}</dt>
                <dd translate="no">{pending.codeMasked}</dd>
              </div>
            ) : null}
          </dl>
          <p className={styles.pendingLead}>
            {until ? words.autoLeadUntil(until) : wallet ? words.autoLead : words.autoLeadVisitor}
          </p>
          <div className={styles.pendingActions}>
            {stuck ? (
              <button type="button" className={styles.claim} onClick={() => void settle(pending.code, "confirm")} disabled={busy}>
                {text(busy ? "Confirming…" : "Confirm inviter")}
              </button>
            ) : null}
            <button type="button" className={styles.linkAction} onClick={() => setEditing(true)} disabled={busy}>
              {text("Change code")}
            </button>
            <button type="button" className={styles.quietAction} onClick={() => void dismiss()} disabled={busy}>
              {text("Continue without referral")}
            </button>
          </div>
        </>
      ) : (
        editor(text(pending ? "Change referral code" : "Have a code or link?"), "adopt")
      )}
      {notice ? <p className={styles.error} role="alert" ref={noticeRef}>{notice}</p> : null}
    </section>
  );
}
