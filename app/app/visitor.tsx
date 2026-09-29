import Link from "next/link";

import { BETA_COPY } from "@/lib/beta/texts";
import { LINKS } from "@/lib/beta/types";
import { cabinetUiCopy } from "./ui-lang";

/**
 * Visitor mode.
 *
 * The cabinet used to be a wall. No session meant no shell, no navigation, no
 * workspace switcher and no product — one standalone page explaining that a
 * Telegram confirmation stood between you and everything. A person who arrived
 * to find out what Ryntra is was handed a form instead, and the surface whose
 * entire argument is *we show you exactly what is proven and exactly where it
 * stops* showed nothing at all.
 *
 * Everything readable is now readable. What still needs an account is precisely
 * what is **yours** or what is a **credential**, and each of those says so in
 * place, inside the shell, next to the thing it is about:
 *
 *   yours       paper trades, journal, alerts, settings. There is nothing to
 *               show a visitor because a visitor has none — so the page says
 *               that rather than bouncing them to a form.
 *   credential  the Arcus trade key. An anonymous credential path is not a
 *               simpler product, it is an open door, and it stays shut.
 *
 * The account gate itself did not move an inch. Every `/api` route still reads
 * the session, `/api/paper` still rate-limits per account and still caps open
 * trades, and nothing here writes anything. This module only changes what an
 * unauthenticated visitor is *shown*.
 *
 * Language: this notice used to be EN-only on the argument that a visitor has
 * no account and therefore no stored language. That rationale predates the
 * shared workspace locale cookie — a visitor *does* have a chosen UI language
 * now, the one the whole hub chrome around this notice already speaks — so the
 * notice reads it the same way every Home server page does.
 */

/**
 * The in-place explanation for a surface that genuinely needs an account.
 *
 * It states what the page is, why an account is required for *this* page
 * specifically, and where to get one — inside the shell, with the navigation
 * and the workspace switcher still there, so the visitor can keep looking
 * around instead of being ejected.
 */
export async function VisitorNotice({
  eyebrow,
  heading,
  body,
  reason,
  intent = "generic",
}: {
  eyebrow: string;
  heading: string;
  /** What the page does, for someone who has never seen it. */
  body: string;
  /** Why this particular surface cannot be read without an account. */
  reason: string;
  /** Why the sign-in is asked for; the login sheet shows it as its reason line. */
  intent?: "journal" | "alerts" | "save_plan" | "settings" | "generic";
}) {
  const { lang } = await cabinetUiCopy();
  const c = BETA_COPY[lang] ?? BETA_COPY.en;
  return (
    <>
      <header className="cbh">
        <div>
          <p className="cbh-eyebrow">{eyebrow}</p>
          <h1>{heading}</h1>
          <p className="cbh-sub">{body}</p>
        </div>
      </header>

      <section className="cb-visitor">
        <p className="cb-visitor-why">{reason}</p>

        <div className="cb-visitor-steps">
          {c.cabinetGateSteps.map((label, index) => (
            <div className="cb-visitor-step" key={label}>
              <span className="cb-visitor-n" aria-hidden>
                {index + 1}
              </span>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <div className="cb-visitor-cta">
          {/* The account sheet is the door (email, Google, Telegram); the bot
              link stays as the transitional path while those are verified. A
              wallet signature proves an address and opens no account, so it is
              not offered here. */}
          <Link className="btn btn-primary btn-sm" href={`?login=1&reason=${intent}`}>
            {lang === "uk" ? "Увійти" : "Sign in"}
          </Link>
          <a href={LINKS.bot} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            {c.pageOpenBot}
          </a>
        </div>

        <p className="cb-visitor-fine">{c.cabinetGateStale}</p>
      </section>
    </>
  );
}
