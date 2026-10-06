"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { clearWalletAccount } from "@/lib/account/wallet-auth.client";

import type { AccountMethods } from "@/lib/account/config";
import { clearIntent, dispatchIntent, rememberIntent, takeIntent, type IntentKind } from "@/lib/account/intent.client";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

import { accountCopyFor, type AccountCopy } from "./copy";
import { LoginSheet } from "./login-sheet";

/**
 * The account, as the client sees it.
 *
 * Facts come from the server layout — whether a session exists, its name and
 * method — and the client adds the one thing only it can hold: the login
 * sheet with the reason it was opened for, and the intent that reopens the
 * action after the round trip. Opening the sheet never changes the URL;
 * a `?login=1&reason=…` deep link opens it once and is stripped.
 */
export type AccountSummary = Readonly<{
  signedIn: boolean;
  sessionKey: string | null;
  walletAddress: string | null;
  expiresAt: string | null;
  name: string | null;
  method: string | null;
  telegramLinked: boolean;
  methods: AccountMethods;
  /** Telegram Login's public client id (the bot id) while the Telegram door is open; `null` otherwise. */
  telegramClientId: string | null;
  /** True when at least one of the three account doors is open. */
  accountsOn: boolean;
  /** True only while the legacy customer doors (email, Google, Telegram sign-in) are switched on. */
  customerDoors: boolean;
  /** A legacy bot session that can take a new identity without a second account. */
  attachable: boolean;
}>;

type AccountValue = AccountSummary &
  Readonly<{
    copy: AccountCopy;
    locale: string;
    loginOpen: boolean;
    openLogin: (reason?: IntentKind, draft?: unknown, options?: { attach?: boolean }) => void;
    attachMode: boolean;
    closeLogin: () => void;
    notice: string | null;
    dismissNotice: () => void;
    logout: (scope: "this" | "all") => Promise<void>;
    logoutPending: boolean;
    privacyBlocked: boolean;
  }>;

const AccountContext = createContext<AccountValue | null>(null);

export function useAccount(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside AccountProvider.");
  return value;
}

const REASONS: readonly IntentKind[] = ["save_plan", "journal", "alerts", "settings", "link_wallet", "generic"];

export function AccountProvider({ summary, children }: { summary: AccountSummary; children: ReactNode }) {
  const { locale } = useSolanaI18n();
  const copy = accountCopyFor(locale);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loginOpen, setLoginOpen] = useState(false);
  const [reason, setReason] = useState<IntentKind>("generic");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSticky, setNoticeSticky] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [attachMode, setAttachMode] = useState(false);
  const { connection } = useSolanaConnection();
  const address = connection?.address ?? null;
  const priorAddress = useRef<string | null>(null);
  const latest = useRef({ summary, address });
  latest.current = { summary, address };
  const [blocked, setBlocked] = useState(false);
  // Derived during render: old private children disappear before effects run.
  const changedWallet = priorAddress.current !== null && priorAddress.current !== address;
  const privacyBlocked = blocked || changedWallet || Boolean(summary.walletAddress && summary.walletAddress !== address);
  const signedIn = summary.signedIn && !privacyBlocked;

  useEffect(() => { setBlocked(false); }, [summary.sessionKey]);
  useEffect(() => {
    const before = priorAddress.current;
    priorAddress.current = address;
    const bound = latest.current.summary.walletAddress;
    if (!(before && before !== address) && !(address && bound && address !== bound)) return;
    setBlocked(true);
    setLoginOpen(false);
    // Clear any private draft from the old account rather than replaying it as
    // the next wallet. Cleanup queues behind an in-flight credential response.
    clearIntent();
    void clearWalletAccount().catch(() => undefined).finally(() => router.refresh());
  }, [address, router]);

  useEffect(() => {
    if (!summary.signedIn) return;
    let current = true;
    const expectedAddress = address;
    const expectedSession = summary.sessionKey;
    const refresh = async () => {
      if (!expectedAddress) return;
      try {
        const response = await fetch("/api/auth/solana/session", { cache: "no-store" });
        const value = await response.json() as { signedIn?: boolean; walletAddress?: string | null };
        if (!current || latest.current.address !== expectedAddress || latest.current.summary.sessionKey !== expectedSession) return;
        if (!response.ok || !value.signedIn || (value.walletAddress && value.walletAddress !== latest.current.address)) {
          setBlocked(true);
          router.refresh();
        } else if (value.walletAddress === expectedAddress) {
          // A restored wallet can arrive after the sign-in redirect. A fresh
          // matching session releases that temporary gate without another signature.
          setBlocked(false);
        }
      } catch { if (current) setBlocked(true); }
    };
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const expiresIn = summary.expiresAt ? Date.parse(summary.expiresAt) - Date.now() : null;
    const timeout = expiresIn === null ? null : window.setTimeout(() => { setBlocked(true); router.refresh(); }, Math.max(0, Math.min(expiresIn, 2147483647)));
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ryntra-account-context");
    if (channel) channel.onmessage = () => { setBlocked(true); router.refresh(); };
    return () => {
      current = false;
      if (timeout !== null) window.clearTimeout(timeout);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
    };
  }, [summary.signedIn, summary.expiresAt, summary.sessionKey, address, router]);

  const openLogin = useCallback(
    (why: IntentKind = "generic", draft?: unknown, options?: { attach?: boolean }) => {
      if (draft !== undefined || why !== "generic") rememberIntent({ kind: why, path: pathname, draft });
      setReason(why);
      setAttachMode(options?.attach === true);
      setLoginOpen(true);
    },
    [pathname],
  );
  const closeLogin = useCallback(() => setLoginOpen(false), []);
  const dismissNotice = useCallback(() => {
    setNotice(null);
    setNoticeSticky(false);
  }, []);

  const logout = useCallback(async (scope: "this" | "all") => {
    setLogoutPending(true);
    setNotice(null);
    setNoticeSticky(false);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const outcome = await response.json().catch(() => null) as { ok?: unknown } | null;
      if (response.ok && outcome?.ok === true) {
        window.location.assign("/app");
        return;
      }
    } catch {
      // A transport failure gives no evidence that any session was revoked.
    }
    setNotice(scope === "all" ? copy.menu.logoutAllFailed : copy.menu.logoutFailed);
    setNoticeSticky(true);
    setLogoutPending(false);
    // A partial server result may have cleared this browser's cookies. Refresh
    // the identity without hiding the unconfirmed revocation from the person.
    router.refresh();
  }, [copy.menu.logoutAllFailed, copy.menu.logoutFailed, router]);

  /* The one-time markers a callback leaves on the URL: `auth=ok|cancel|error`
     and `login=1&reason=…`. Read once, acted on, removed — a reload must not
     replay a toast or reopen a sheet. */
  useEffect(() => {
    const auth = searchParams.get("auth");
    const login = searchParams.get("login");
    if (!auth && !login) return;
    // The saved action's receiver mounts only after the matching wallet has
    // restored. Do not consume its draft while the private subtree is hidden.
    if (auth === "ok" && summary.walletAddress && !signedIn) return;
    const params = new URLSearchParams(searchParams.toString());
    if (auth) {
      setNoticeSticky(false);
      const reasonParam = searchParams.get("reason") ?? "";
      if (auth === "ok") {
        setNotice(reasonParam === "new" ? copy.returned.okNew : reasonParam === "linked" ? copy.returned.linked : copy.returned.ok);
        const intent = takeIntent(pathname);
        if (intent) window.setTimeout(() => dispatchIntent(intent), 0);
      } else if (auth === "cancel") {
        setNotice(copy.returned.cancel);
      } else {
        setNotice(
          reasonParam === "telegram_claimed"
            ? copy.returned.telegramClaimed
            : reasonParam === "telegram_identity"
              ? copy.returned.telegramIdentity
              : reasonParam === "link"
                ? copy.returned.link
                : reasonParam === "state"
                  ? copy.returned.state
                  : copy.returned.error,
        );
      }
      params.delete("auth");
      params.delete("reason");
    }
    if (login && !summary.signedIn) {
      const why = searchParams.get("reason");
      setReason(REASONS.includes(why as IntentKind) ? (why as IntentKind) : "generic");
      setLoginOpen(true);
      params.delete("login");
      params.delete("reason");
    } else if (login) {
      params.delete("login");
      params.delete("reason");
    }
    /* Native history, not the router: the marker is gone from the address bar
       without a server round trip, and the notice state above survives. */
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", qs ? `${pathname}?${qs}` : pathname);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per marker, by design */
  }, [searchParams, signedIn, summary.walletAddress]);

  useEffect(() => {
    if (!notice || noticeSticky) return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeSticky]);

  const value = useMemo<AccountValue>(
    () => ({
      ...summary,
      signedIn,
      name: signedIn ? summary.name : null,
      privacyBlocked,
      copy,
      locale,
      loginOpen,
      openLogin,
      attachMode,
      closeLogin,
      notice,
      dismissNotice,
      logout,
      logoutPending,
    }),
    [summary, signedIn, privacyBlocked, copy, locale, loginOpen, openLogin, attachMode, closeLogin, notice, dismissNotice, logout, logoutPending],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
      {notice ? (
        <div className="ry-account-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="ry-account-notice-close" onClick={dismissNotice} aria-label={copy.close}>×</button>
        </div>
      ) : null}
      {loginOpen && (!signedIn || attachMode) ? <LoginSheet reason={reason} onClose={closeLogin} attach={attachMode && summary.attachable} /> : null}
    </AccountContext.Provider>
  );
}


// Public financial preparation stays available during a private-account reset.
const PUBLIC_PAGES = new Set(["/app", "/app/swap", "/app/send", "/app/receive", "/app/top-up", "/app/portfolio", "/app/activity", "/app/spot", "/app/perps", "/app/trends", "/app/ideas", "/app/bots", "/app/bots/catalog", "/app/markets"]);
export function AccountDataBoundary({ children }: { children: ReactNode }) {
  const { privacyBlocked, sessionKey, locale, openLogin } = useAccount();
  const pathname = usePathname();
  if (privacyBlocked && !PUBLIC_PAGES.has(pathname)) return <section className="ry-wallet-entry" role="status">
    <p>{locale === "uk" ? "Підтвердьте вхід, щоб відкрити приватний акаунт цього гаманця." : "Confirm sign-in to open this wallet’s private account."}</p>
    <button type="button" className="rw-btn" onClick={() => openLogin("generic")}>{locale === "uk" ? "Увійти гаманцем" : "Sign in with wallet"}</button>
  </section>;
  return <div key={`${sessionKey ?? "guest"}:${privacyBlocked ? "private-hidden" : "ready"}`} style={{ display: "contents" }}>{children}</div>;
}
