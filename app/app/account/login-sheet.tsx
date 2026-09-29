"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GoogleLogo, TelegramLogo, X } from "@phosphor-icons/react";

import type { IntentKind } from "@/lib/account/intent.client";
import { loadTelegramLogin, telegramLoginApi, type TelegramLoginResult } from "@/lib/auth/telegram-login.client";
import { LINKS } from "@/lib/beta/types";

import { useAccount } from "./account-context";
import { WalletEntry } from "./wallet-entry";

/**
 * The login sheet: compact, closable, three doors.
 *
 * It says why it opened (the calling action's reason), offers Google and
 * Telegram when those doors are open, and carries the email form with its
 * three modes. It never holds the draft — the intent store does — so closing
 * it loses nothing, and a successful sign-in navigates so every server
 * component renders against the new session.
 */
type Mode = "signin" | "signup" | "forgot";
type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "confirm_email"; email: string; resent: boolean }
  | { kind: "recovery_sent" }
  | { kind: "error"; text: string };

function LegacyLoginSheet({ reason, onClose, attach = false }: { reason: IntentKind; onClose: () => void; attach?: boolean }) {
  const { copy, locale, methods, accountsOn, telegramClientId } = useAccount();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(attach ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const titleId = useId();
  const firstField = useRef<HTMLInputElement>(null);

  const qs = searchParams.toString();
  const next = qs ? `${pathname}?${qs}` : pathname;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    firstField.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startOauth = (provider: "google" | "telegram") => {
    window.location.assign(`/api/auth/oauth?provider=${provider}${attach ? "&attach=1" : ""}&next=${encodeURIComponent(next)}`);
  };

  /* Telegram signs in through Telegram Login's popup rather than the redirect:
     the popup hands this page an ID token that still carries the numeric
     Telegram id, which the redirect loses on its way through the verifier.
     The library and the round trip's nonce are fetched while the sheet is
     open, so the popup can open inside the click that asks for it. */
  const telegramTrip = useRef<{ nonce: string; clientId: number; issuedAt: number } | null>(null);
  /* The round trip lives ten minutes on the server. A sheet left open longer
     than that — a popup waiting for a phone that is elsewhere — would post a
     token against an expired trip, so a trip older than eight minutes is
     replaced before the popup opens, and a refused one is replaced at once. */
  const TELEGRAM_TRIP_FRESH_MS = 8 * 60 * 1000;
  const fetchTelegramTrip = async (): Promise<{ nonce: string; clientId: number; issuedAt: number } | null> => {
    try {
      const res = await fetch(`/api/auth/telegram?next=${encodeURIComponent(next)}${attach ? "&attach=1" : ""}`);
      const data = (await res.json()) as { status?: string; nonce?: string; clientId?: string };
      if (data.status !== "ready" || !data.nonce) return null;
      return { nonce: data.nonce, clientId: Number(data.clientId ?? telegramClientId), issuedAt: Date.now() };
    } catch {
      return null;
    }
  };
  useEffect(() => {
    if (!methods.telegram || !telegramClientId) return;
    let cancelled = false;
    telegramTrip.current = null;
    void loadTelegramLogin();
    void fetchTelegramTrip().then((trip) => {
      if (!cancelled && trip) telegramTrip.current = trip;
    });
    return () => {
      cancelled = true;
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- the fetch reads next/attach, which are the deps */
  }, [methods.telegram, telegramClientId, next, attach]);

  const telegramReasonText = (reason: string | undefined) => {
    switch (reason) {
      case "telegram_identity":
        return copy.returned.telegramIdentity;
      case "telegram_claimed":
        return copy.returned.telegramClaimed;
      case "state":
      case "nonce":
        return copy.returned.state;
      case "rate_limited":
        return copy.rateLimited;
      default:
        return copy.unavailable;
    }
  };

  const finishTelegram = async (result: TelegramLoginResult) => {
    if (!result?.id_token) {
      /* A closed popup is not an error; a reported one is. */
      setState(result?.error ? { kind: "error", text: copy.unavailable } : { kind: "idle" });
      return;
    }
    try {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: result.id_token, next }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; reason?: string; next?: string };
      if (data.status === "signed_in") {
        window.location.assign(data.next ?? next);
        return;
      }
      setState({ kind: "error", text: telegramReasonText(data.status === "rate_limited" ? "rate_limited" : data.reason) });
      /* A refused round trip is spent either way; the next click needs a new one. */
      if (data.reason === "state" || data.reason === "nonce") {
        telegramTrip.current = null;
        telegramTrip.current = await fetchTelegramTrip();
      }
    } catch {
      setState({ kind: "error", text: copy.unavailable });
    }
  };

  const startTelegram = async () => {
    const api = telegramLoginApi();
    if (!api) {
      setState({ kind: "error", text: copy.unavailable });
      return;
    }
    let trip = telegramTrip.current;
    if (!trip || Date.now() - trip.issuedAt > TELEGRAM_TRIP_FRESH_MS) {
      /* One short request; the click's activation still covers the popup. */
      trip = await fetchTelegramTrip();
      telegramTrip.current = trip;
    }
    if (!trip) {
      setState({ kind: "error", text: copy.unavailable });
      return;
    }
    setState({ kind: "working" });
    try {
      api.auth({ client_id: trip.clientId, scope: ["profile"], nonce: trip.nonce, lang: locale === "uk" ? "uk" : locale === "ru" ? "ru" : "en" }, (result) => {
        void finishTelegram(result);
      });
    } catch {
      setState({ kind: "error", text: copy.unavailable });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.kind === "working") return;
    setState({ kind: "working" });
    try {
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, email, password: mode === "forgot" ? undefined : password, next, locale: locale === "uk" ? "uk" : "en", attach }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; next?: string };
      switch (data.status) {
        case "signed_in":
          window.location.assign(data.next ?? next);
          return;
        case "confirm_email":
          setState({ kind: "confirm_email", email, resent: false });
          return;
        case "recovery_sent":
          setState({ kind: "recovery_sent" });
          return;
        case "invalid":
          setState({ kind: "error", text: copy.invalid });
          return;
        case "weak_password":
          setState({ kind: "error", text: copy.weakPassword });
          return;
        case "rate_limited":
          setState({ kind: "error", text: copy.rateLimited });
          return;
        default:
          setState({ kind: "error", text: copy.unavailable });
      }
    } catch {
      setState({ kind: "error", text: copy.unavailable });
    }
  };

  const resend = async () => {
    if (state.kind !== "confirm_email") return;
    await fetch("/api/auth/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resend", email: state.email, next }),
    }).catch(() => undefined);
    setState({ ...state, resent: true });
  };

  const reasonLine = copy.reasons[reason];
  const working = state.kind === "working";

  return (
    <div className="ry-login-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ry-login" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="ry-login-head">
          <div>
            <h2 id={titleId} className="ry-login-title">{copy.sheetTitle}</h2>
            {reasonLine ? <p className="ry-login-reason">{reasonLine}</p> : null}
          </div>
          <button type="button" className="ry-login-close" onClick={onClose} aria-label={copy.close}>
            <X size={18} weight="bold" aria-hidden />
          </button>
        </header>
        <p className="ry-login-lead">{attach ? copy.attachLead : copy.sheetLead}</p>

        {!accountsOn ? (
          <div className="ry-login-transitional">
            <p className="ry-muted">{copy.methodsPreparing}</p>
            <a className="rw-btn" data-variant="primary" href={LINKS.bot} target="_blank" rel="noreferrer noopener">
              <TelegramLogo size={18} weight="bold" aria-hidden /> {copy.telegramBot}
            </a>
          </div>
        ) : (
          <>
            {methods.google || methods.telegram ? (
              <div className="ry-login-providers">
                {methods.google ? (
                  <button type="button" className="rw-btn ry-login-provider" onClick={() => startOauth("google")} disabled={working}>
                    <GoogleLogo size={18} weight="bold" aria-hidden /> {copy.google}
                  </button>
                ) : null}
                {methods.telegram ? (
                  <button type="button" className="rw-btn ry-login-provider" onClick={() => void startTelegram()} disabled={working}>
                    <TelegramLogo size={18} weight="bold" aria-hidden /> {copy.telegram}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="ry-login-tabs" role="tablist">
              {(attach ? ["signup", "signin", "forgot"] as const : ["signin", "forgot"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} className="ry-login-tab" onClick={() => { setMode(m); setState({ kind: "idle" }); }}>
                  {m === "signin" ? copy.emailTab : m === "signup" ? copy.createTab : copy.forgotTab}
                </button>
              ))}
            </div>

            {state.kind === "confirm_email" ? (
              <div className="ry-login-state" role="status">
                <p>{copy.confirmEmail}</p>
                <button type="button" className="ry-action-link" onClick={() => void resend()} disabled={state.resent}>{state.resent ? copy.resent : copy.resend}</button>
              </div>
            ) : state.kind === "recovery_sent" ? (
              <p className="ry-login-state" role="status">{copy.recoverySent}</p>
            ) : (
              <form className="ry-login-form" onSubmit={(event) => void submit(event)}>
                <label className="ry-login-field">
                  <span>{copy.email}</span>
                  <input ref={firstField} type="email" name="email" autoComplete={mode === "signup" ? "email" : "username"} required value={email} onChange={(event) => setEmail(event.target.value)} disabled={working} />
                </label>
                {mode !== "forgot" ? (
                  <label className="ry-login-field">
                    <span>{copy.password}</span>
                    <input type="password" name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={working} />
                    {mode === "signup" ? <small>{copy.passwordHint}</small> : null}
                  </label>
                ) : null}
                {state.kind === "error" ? <p className="ry-login-error" role="alert">{state.text}</p> : null}
                <button type="submit" className="rw-btn" data-variant="primary" disabled={working}>
                  {working ? copy.working : mode === "signin" ? copy.submitSignIn : mode === "signup" ? copy.submitCreate : copy.submitForgot}
                </button>
              </form>
            )}

            {!methods.telegram ? (
              <p className="ry-login-foot">
                <a href={LINKS.bot} target="_blank" rel="noreferrer noopener">{copy.telegramBot}</a>
                <span className="ry-muted"> · {copy.telegramBotHint}</span>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}


export function LoginSheet({ reason, onClose, attach = false }: { reason: IntentKind; onClose: () => void; attach?: boolean }) {
  const { copy, locale, customerDoors } = useAccount();
  /* The legacy sheet (email, Google, Telegram sign-in) exists only while the
     customer doors are switched on; with them shut the wallet is the one way
     in and the sheet has nothing else to offer (RYN-ACCESS-WALLET-ONLY-001). */
  const [legacy, setLegacy] = useState(attach && customerDoors);
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (legacy) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [legacy, onClose]);
  if (legacy) return <LegacyLoginSheet reason={reason} onClose={onClose} attach={attach} />;
  return <div className="ry-login-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} tabIndex={-1} className="ry-login" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="ry-login-head">
        <div><h2 id={titleId} className="ry-login-title">{copy.sheetTitle}</h2><p className="ry-login-reason">{copy.reasons[reason]}</p></div>
        <button type="button" className="ry-login-close" onClick={onClose} aria-label={copy.close}><X size={18} aria-hidden /></button>
      </header>
      <WalletEntry onSuccess={() => { const url = new URL(window.location.href); url.searchParams.set("auth", "ok"); window.location.assign(url.href); }} />
      {customerDoors ? (
        <button type="button" className="ry-action-link ry-wallet-legacy" onClick={() => setLegacy(true)}>
          {locale === "uk" ? "Уже маєте акаунт через email, Google або Telegram?" : "Already have an account through email, Google or Telegram?"}
        </button>
      ) : null}
    </section>
  </div>;
}
