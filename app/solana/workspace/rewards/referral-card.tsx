"use client";

import { Check } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./rewards.module.css";

/**
 * Who invited you — shown before it is decided, and settled only on purpose.
 *
 * ## The three states, and why they are three
 *
 * **Nothing.** No link was opened and no code is being considered. One quiet
 * line offers to take one, because a person who was given a code verbally has
 * nowhere else to put it.
 *
 * **Pending.** A link was opened, or a code was entered. The inviter is shown
 * masked and *nothing has been written* — this is the state that did not exist
 * before, and its absence was the defect: the attribution used to happen while
 * a page loaded, so somebody who opened the wrong link found out afterwards or
 * never. Here they can confirm, swap the code, or walk away.
 *
 * **Confirmed.** Written, permanent, and drawn without any control that implies
 * otherwise. There is no Change button after confirmation, because in V1 there
 * is no change — offering one would be a lie a person only discovers by
 * pressing it.
 *
 * ## What is never shown
 *
 * A full wallet address. Masking happens on the server and the whole address
 * never reaches this component. An inviter's address is public on any explorer,
 * but handing a new arrival their inviter's entire trading history as an
 * opening gesture is not something confirming an invitation requires.
 */

type Party = Readonly<{ code?: string; inviterMasked: string; codeMasked: string | null }>;

type ReferralState = Readonly<{ pending: Party | null; confirmed: Party | null }>;

export function ReferralCard({
  wallet,
  /** Set once the wallet's own rewards read says it already has an inviter. */
  invitedBy,
  proven,
  onProve,
  onBound,
}: {
  wallet: string | null;
  invitedBy: string | null;
  proven: boolean;
  onProve: () => Promise<boolean | undefined>;
  onBound: () => void;
}) {
  const { text } = useSolanaI18n();
  const [state, setState] = useState<ReferralState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<Party | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/rewards/referral?address=${encodeURIComponent(wallet ?? "")}`);
      if (!response.ok) return;
      const next = await response.json() as ReferralState;
      if (alive.current && currentWallet.current === wallet) setState(next);
    } catch {
      /* Rewards must not fail because the invitation could not be read. */
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load, invitedBy, proven]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/rewards/referral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }, []);

  /** Look up a typed code without choosing it. */
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
        setNotice(text("Referral code not found"));
        return;
      }
      setPreview(found.preview);
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [draft, text]);

  /** Adopt the previewed code as the one being considered. Still not a binding. */
  const adoptCode = useCallback(async () => {
    if (!preview?.code) return;
    setBusy(true);
    try {
      const result = await post({ action: "pending", code: preview.code });
      if (result.status === 200) {
        setEditing(false);
        setPreview(null);
        setDraft("");
        await load();
      } else {
        setNotice(text("Referral code not found"));
      }
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [preview, post, load, text]);

  const dismiss = useCallback(async () => {
    setBusy(true);
    try {
      await post({ action: "dismiss" });
      setEditing(false);
      setPreview(null);
      await load();
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [post, load, text]);

  const confirm = useCallback(async () => {
    const code = state?.pending?.code;
    if (!code || !wallet) { setNotice(text("Confirm this wallet first, then set your inviter.")); return; }
    setNotice(null);
    setBusy(true);
    try {
      /* Confirming is the one action that writes, so it is the one that needs a
         proven wallet. A person who has not signed in yet is walked through it
         here rather than being told to go and do it somewhere else. */
      if (!proven && await onProve() !== true) return;
      if (!alive.current || currentWallet.current !== wallet) return;
      const result = await post({ action: "confirm", code, address: wallet });
      if (!alive.current || currentWallet.current !== wallet) return;
      if (result.status === 200) {
        await load();
        onBound();
        return;
      }
      const reason = String(result.body.reason ?? "");
      setNotice(
        reason === "PROOF_REQUIRED"
          ? text("Confirm this wallet first, then set your inviter.")
          : reason === "SELF_REFERRAL"
            ? text("That is your own link.")
            : reason === "ALREADY_REFERRED" || reason === "ALREADY_EARNING"
              ? text("This wallet already has an inviter.")
              : reason === "CYCLE"
                ? text("Those two wallets cannot invite each other.")
                : text("Referral code not found"),
      );
    } catch {
      if (alive.current) setNotice(text("The referral could not be updated. Try again."));
    } finally {
      setBusy(false);
    }
  }, [state, proven, onProve, post, load, onBound, text, wallet]);

  const settled = invitedBy ?? state?.confirmed?.inviterMasked ?? null;

  if (settled) {
    return (
      <section className={styles.invited} aria-label={text("Your inviter")}>
        <span className={styles.invitedLabel}>{text("Invited by")}</span>
        <span className={styles.invitedWho} translate="no">{settled}</span>
        <span className={styles.invitedMark}>
          <Check size={12} weight="bold" aria-hidden="true" />
          {text("Confirmed")}
        </span>
      </section>
    );
  }

  const pending = state?.pending ?? null;

  if (!pending && !editing) {
    return (
      <section className={styles.codeOffer}>
        <span className={styles.codeOfferLead}>{text("Have a referral code?")}</span>
        <button type="button" className={styles.linkAction} onClick={() => setEditing(true)}>
          {text("Enter code")}
        </button>
      </section>
    );
  }

  return (
    <section className={styles.pending} aria-label={text("Referral invitation")}>
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
            {text("Nothing is set until you confirm. Your inviter cannot be changed afterwards.")}
          </p>
          <div className={styles.pendingActions}>
            <button type="button" className={styles.claim} onClick={() => void confirm()} disabled={busy}>
              {text(busy ? "Confirming…" : "Confirm inviter")}
            </button>
            <button type="button" className={styles.linkAction} onClick={() => setEditing(true)} disabled={busy}>
              {text("Change code")}
            </button>
            <button type="button" className={styles.quietAction} onClick={() => void dismiss()} disabled={busy}>
              {text("Continue without referral")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.pendingTitle}>{text(pending ? "Change referral code" : "Have a referral code?")}</p>
          <div className={styles.linkRow}>
            <input
              className={styles.link}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={text("Referral code")}
              aria-label={text("Referral code")}
              spellCheck={false}
              autoCapitalize="characters"
            />
            <button type="button" className={styles.linkAction} onClick={() => void lookUp()} disabled={busy || draft.trim().length === 0}>
              {text("Look up")}
            </button>
            <button
              type="button"
              className={styles.quietAction}
              onClick={() => {
                setEditing(false);
                setPreview(null);
                setNotice(null);
                setDraft("");
              }}
              disabled={busy}
            >
              {text("Cancel")}
            </button>
          </div>
          {preview ? (
            <div className={styles.previewRow}>
              <span className={styles.pendingLead}>
                {text("Invited by")} <b translate="no">{preview.inviterMasked}</b>
              </span>
              <button type="button" className={styles.claim} onClick={() => void adoptCode()} disabled={busy}>
                {text("Use this code")}
              </button>
            </div>
          ) : null}
        </>
      )}
      {notice ? <p className={styles.error}>{notice}</p> : null}
    </section>
  );
}
