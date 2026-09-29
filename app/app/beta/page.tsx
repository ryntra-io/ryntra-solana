import { getSession } from "@/lib/session";
import { getState } from "@/lib/beta/rpc";
import { BETA_COPY } from "@/lib/beta/texts";
import { LINKS, pickBetaLang } from "@/lib/beta/types";
import { CB_COPY } from "../copy";
import { VisitorNotice } from "../visitor";

export const dynamic = "force-dynamic";

/**
 * Beta access, signed in.
 *
 * Access is binary and already granted by the time this page renders, so there is nothing
 * to climb here. The old rung list — join the channel, register with Arcus, follow on X —
 * and the invite panel are gone: none of them ever affected access, and showing them as
 * progress said otherwise.
 */
/* The shell owns the `main` landmark (app/shell/app-shell.tsx); a page nested
   inside it must not declare a second one. */
export default async function BetaAccessPage() {
  const session = await getSession();
  if (!session?.verified) {
    return (
      <VisitorNotice
        eyebrow="Account"
        heading="Access"
        body="What your beta access covers and what it does not."
        reason="Access is granted per account, so this page has nothing to report until there is one."
      />
    );
  }
  const lang = pickBetaLang(session.state.user.language);
  const c = CB_COPY[lang] ?? CB_COPY.en;
  const bc = BETA_COPY[lang];

  const state = await getState(session.telegramId);

  return (
    <div className="cb-grid">
      <header className="cbh cb-span2">
        <div>
          <p className="cbh-eyebrow">{bc.pageYourStatus}</p>
          <h1>{c.beta.title}</h1>
        </div>
      </header>

      <section className="cb-card cb-span2">
        <div className="cb-card-head">
          <h2>{bc.accessTitle}</h2>
          <span className="cb-badge">{bc.status[state?.access.status ?? "telegram_verified"].name}</span>
        </div>
        <p className="cb-hint">{bc.status[state?.access.status ?? "telegram_verified"].hint}</p>
      </section>

      <section className="cb-card cb-span2">
        <div className="cb-card-head"><h2>{c.beta.optionalTitle}</h2></div>
        <p className="cb-hint">{bc.optionalNote}</p>
        <p className="cb-hint">
          <a href={LINKS.bot} target="_blank" rel="noreferrer">{bc.pageOpenBot}</a>
        </p>
      </section>
    </div>
  );
}
