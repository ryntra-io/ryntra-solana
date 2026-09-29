import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getSession, canKeepPersonalData } from "@/lib/session";
import { attachableAccountId } from "@/lib/auth/identity-link";
import { accountLoginEnabled, customerDoorsEnabled, customerMethods, telegramClientId } from "@/lib/account/config";
import { CABINET_BOOT_SCRIPT, THEME_BOOT_SCRIPT } from "./theme";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { SolanaI18nProvider } from "@/app/solana/workspace/i18n/provider";
import { SolanaConnectionProvider } from "@/app/solana/workspace/connection";
import { HomeI18nProvider } from "./i18n/provider";
import { WalletDataProvider } from "./wallet-data";
import { ProductShell } from "./product-shell";
import { AccountProvider, AccountDataBoundary, type AccountSummary } from "./account/account-context";

export const metadata: Metadata = { title: { default: "Ryntra", template: "%s · Ryntra" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const [session, store] = await Promise.all([getSession(), cookies()]);
  const locale = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
  /* Signed in means an account that can keep personal data: a recorded
     account session, or a legacy bot session that knows its account or passed
     the old channel gate. A guest and a connected wallet are not signed in. */
  const signedIn = Boolean(session && canKeepPersonalData(session));
  const account: AccountSummary = {
    signedIn,
    sessionKey: session?.sessionId ?? session?.accountId ?? null,
    walletAddress: session?.method === "solana_siws" ? session.identityWallet : null,
    expiresAt: session?.expiresAt ?? null,
    name: signedIn ? (session?.state.user.first_name ?? session?.state.user.username ?? null) : null,
    method: signedIn ? (session?.method ?? (session?.subjectKind === "WALLET" ? "wallet_siwe" : "telegram_link")) : null,
    telegramLinked: Boolean(session?.telegramId),
    methods: customerMethods(),
    telegramClientId: customerMethods().telegram ? telegramClientId() : null,
    accountsOn: accountLoginEnabled(),
    customerDoors: customerDoorsEnabled(),
    /* A bot-door session whose account has no identity yet can take one:
       email, Google or Telegram OpenID attach to it instead of making a
       second account. Named here so the sheet can say so. */
    attachable: Boolean(attachableAccountId(session)),
  };
  return <SolanaI18nProvider initialLocale={locale}>
    <HomeI18nProvider initialLocale={locale}>
      {/* The cabinet names itself on <html> before first paint, so the
          surfaces that mount outside the shell — the sign-in sheet, the
          feedback dialog, toasts — take the terminal's own type and tokens. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT + CABINET_BOOT_SCRIPT }} />
      <SolanaConnectionProvider>
        <AccountProvider summary={account}>
          <WalletDataProvider><ProductShell signedIn={signedIn}><AccountDataBoundary>{children}</AccountDataBoundary></ProductShell></WalletDataProvider>
        </AccountProvider>
      </SolanaConnectionProvider>
    </HomeI18nProvider>
  </SolanaI18nProvider>;
}
