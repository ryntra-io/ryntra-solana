import type { Metadata } from "next";
import { cookies } from "next/headers";
import { canKeepPersonalData, readSession, readWalletProof } from "@/lib/session";
import { attachableAccountId } from "@/lib/auth/identity-link";
import { accountLoginEnabled, customerDoorsEnabled, customerMethods, telegramClientId } from "@/lib/account/config";
import { CABINET_BOOT_SCRIPT } from "./theme";
import { LOOK_BOOT_SCRIPT, LOOK_COOKIE, MENU_COOKIE } from "./look";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { SolanaI18nProvider } from "@/app/solana/workspace/i18n/provider";
import { SolanaConnectionProvider } from "@/app/solana/workspace/connection";
import { WalletProofSeed } from "@/app/solana/workspace/wallet-proof";
import { HomeI18nProvider } from "./i18n/provider";
import { WalletDataProvider } from "./wallet-data";
import { ProductShell } from "./product-shell";
import { AccountProvider, AccountDataBoundary, type AccountSummary } from "./account/account-context";

export const metadata: Metadata = { title: { default: "Ryntra", template: "%s · Ryntra" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const [read, store] = await Promise.all([readSession(), cookies()]);
  const session = read.status === "ok" ? read.session : null;
  const walletSignin = session?.method === "solana_siws" ? session.identityWallet : null;
  /* What the server already knows about the wallet's proof, handed to every
     page before it renders: a wallet sign-in is the proof of its own address,
     so the common case costs no second read; an account signed in by email or
     Google is the proof of the Solana wallet it linked by signature (SOL-W3),
     so that person sees their pages without a signature either. */
  const proofRead = walletSignin ? null : await readWalletProof({ allowLink: true });
  const proven = walletSignin ?? (proofRead?.status === "ok" ? proofRead.proof.address : null);
  const provenVia = walletSignin ? "signin" : proofRead?.status === "ok" ? proofRead.proof.via : null;
  const checking = read.status === "unavailable" || proofRead?.status === "unavailable";
  const locale = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
  /* The menu's place and the look, read here and decoded by the core in the frame: the server never loads the core's
     components (B1). */
  const menuCookie = store.get(MENU_COOKIE)?.value;
  const lookCookie = store.get(LOOK_COOKIE)?.value;
  /* Signed in means an account that can keep personal data: a recorded
     account session, or a legacy bot session that knows its account or passed
     the old channel gate. A guest and a connected wallet are not signed in. */
  const signedIn = Boolean(session && canKeepPersonalData(session));
  const account: AccountSummary = {
    signedIn,
    /* The account, not the row: a wallet sign-in renewed in place is the same
       person and must not remount the page they are on. */
    sessionKey: session?.accountId ?? session?.sessionId ?? null,
    walletAddress: walletSignin,
    checking,
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
          feedback dialog, toasts — take the terminal's own type and tokens;
          and the core's theme, Graphite or Porcelain, applies before first
          paint too: a theme that arrives one frame late reads as a flash. */}
      <script dangerouslySetInnerHTML={{ __html: LOOK_BOOT_SCRIPT + CABINET_BOOT_SCRIPT }} />
      <SolanaConnectionProvider>
        <WalletProofSeed address={proven} via={provenVia} signedIn={signedIn} walletAddress={walletSignin} checking={checking} renderedAt={Date.now()}>
          <AccountProvider summary={account}>
            <WalletDataProvider><ProductShell signedIn={signedIn} menuCookie={menuCookie} lookCookie={lookCookie}><AccountDataBoundary>{children}</AccountDataBoundary></ProductShell></WalletDataProvider>
          </AccountProvider>
        </WalletProofSeed>
      </SolanaConnectionProvider>
    </HomeI18nProvider>
  </SolanaI18nProvider>;
}
