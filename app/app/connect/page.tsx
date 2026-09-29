import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { cabinetUiCopy } from "../ui-lang";
import { VisitorNotice } from "../visitor";
import { ConnectionCenter } from "./connection-center";
import { CONNECTION_CENTER_COPY } from "./copy";

export const dynamic = "force-dynamic";

/* The shell owns the `main` landmark (app/shell/app-shell.tsx); a page nested
   inside it must not declare a second one. */
export default async function ConnectPage() {
  const session = await getSession();
  if (!session) {
    return (
      <VisitorNotice
        eyebrow="System"
        heading="Connection Center"
        body="Identity, read-only data connections, venue credentials and exact action authority are different records."
        reason="Sign in before creating account-bound browser-local records. Public workspaces and public evidence remain readable without an account; this page stores your declarations and therefore needs an identity boundary."
      />
    );
  }
  /* The workspace locale cookie, not the Telegram bot language: the same
     summary block on Today already follows the cookie, and one page speaking
     a third language inside EN/UA chrome was the exact drift. */
  const { lang, c } = await cabinetUiCopy();
  const copy = CONNECTION_CENTER_COPY[lang] ?? CONNECTION_CENTER_COPY.en;
  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });

  return (
    <ConnectionCenter
      ownerRef={ownerRef}
      subjectKind={session.subjectKind}
      initialIdentityWallet={session.identityWallet}
      telegramVerified={session.verified}
      legacyWatchAddress={session.state.user.wallet_address}
      canManageVenue={session.verified}
      copy={copy}
      arcusCopy={c.connect}
    />
  );
}
