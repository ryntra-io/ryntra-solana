"use client";

import { useState, type FormEvent } from "react";

import { useAccount } from "../../account/account-context";

/** Set a new password: after a recovery link, or from Settings when signed in. */
export function ResetForm() {
  const { copy } = useAccount();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error" | "partial">("idle");
  const [text, setText] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  /* The way on from a partial reset: end the other sessions again, from the
     new session this browser now holds. */
  const signOutEverywhere = async () => {
    setRetrying(true);
    try {
      const r = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "all" }) });
      if (r.ok) {
        window.location.assign("/app?login=1&reason=generic");
        return;
      }
      setText(copy.reset.sessionsOpen);
    } catch {
      setText(copy.unavailable);
    }
    setRetrying(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "working") return;
    setState("working");
    setText(null);
    try {
      const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, next: "/app/settings" }) });
      const data = (await r.json().catch(() => ({}))) as { status?: string; next?: string };
      if (data.status === "updated") {
        setState("done");
        setText(copy.reset.done);
        window.setTimeout(() => window.location.assign(data.next ?? "/app/settings"), 800);
        return;
      }
      /* The password changed but the other sessions did not all end. Saying
         «готово» here would be the dangerous half of the truth for exactly the
         person who resets a password because it leaked, so the screen says
         what happened and offers the one action that finishes it. */
      if (data.status === "updated_sessions_open") {
        setState("partial");
        setText(copy.reset.sessionsOpen);
        return;
      }
      setState("error");
      setText(
        data.status === "weak_password" ? copy.weakPassword
          : data.status === "same_password" ? copy.samePassword
            : data.status === "signed_out" ? copy.reset.signedOut
              : data.status === "rate_limited" ? copy.rateLimited
                : copy.unavailable,
      );
    } catch {
      setState("error");
      setText(copy.unavailable);
    }
  };

  return (
    <form className="ry-login-form" onSubmit={(event) => void submit(event)}>
      <label className="ry-login-field">
        <span>{copy.newPassword}</span>
        <input type="password" name="new-password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={state === "working" || state === "done"} />
        <small>{copy.passwordHint}</small>
      </label>
      {text ? <p className={state === "error" ? "ry-login-error" : "ry-muted"} role={state === "error" || state === "partial" ? "alert" : "status"}>{text}</p> : null}
      {state === "partial" ? (
        <button type="button" className="rw-btn" onClick={() => void signOutEverywhere()} disabled={retrying}>
          {copy.reset.signOutAll}
        </button>
      ) : null}
      <button type="submit" className="rw-btn" data-variant="primary" disabled={state === "working" || state === "done"}>
        {state === "working" ? copy.working : copy.submitReset}
      </button>
    </form>
  );
}
