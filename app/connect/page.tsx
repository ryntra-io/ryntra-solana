import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConnectConsent, type ConnectView } from "@/city/components/connect/ConnectConsent";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";
import { connectorOrigin, connectorResource } from "@/lib/connector/metadata";
import { createConnectorOAuthServer, errorRedirect, type AuthorizationParams } from "@/lib/connector/oauth";
import { getGuardRuntime } from "@/lib/guard/runtime";

/* `/connect` — the consent of Ryntra's Solana connector (CITY-154), the authorization endpoint an AI chat opens.
   The request is checked here, on the server, before anything is drawn: an unknown client or an unregistered return
   address is answered on this page and never redirected; any other refusal goes back to the client's verified address.
   With no request at all the page shows how to add Ryntra to a chat. Never offered to the index. */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Connect · Ryntra" },
  description: "Approve an AI chat to read the Solana market through Ryntra. Read-only: it never moves funds.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const KEYS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"] as const;

export default async function Page({ searchParams }: Props) {
  const raw = await searchParams;
  const params = Object.fromEntries(KEYS.map((key) => [key, typeof raw[key] === "string" ? (raw[key] as string) : null])) as AuthorizationParams;
  const origin = connectorOrigin(new Request("https://ryntra.io/connect", { headers: await headers() }));

  let view: ConnectView;
  if (!params.client_id) {
    view = { kind: "guide", mcpUrl: connectorResource(origin) };
  } else {
    const check = await createConnectorOAuthServer(getGuardRuntime().store).checkAuthorization(params, origin);
    if (!check.ok && check.mode === "REDIRECT") redirect(check.redirectTo);
    if (!check.ok) {
      view = { kind: "refused", message: check.message };
    } else {
      const { request } = check;
      view = {
        kind: "consent",
        clientName: request.clientName,
        host: request.host,
        statement: request.statement,
        denyUrl: errorRedirect(request.redirectUri, "access_denied", "The person did not approve the connection.", request.state),
        request: {
          response_type: "code",
          client_id: request.client.clientId,
          redirect_uri: request.redirectUri,
          scope: request.scopes.join(" "),
          state: request.state,
          code_challenge: request.codeChallenge,
          code_challenge_method: "S256",
          resource: request.resource,
        },
      };
    }
  }

  return (
    <main className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <ConnectConsent view={view} />
    </main>
  );
}
