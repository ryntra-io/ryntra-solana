"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletFact } from "@/app/solana/workspace/wallet-proof";
import { clearWalletAccount } from "@/lib/account/wallet-auth.client";
import { ensureWalletFact, revalidateWalletFact } from "@/lib/account/wallet-proof-store.client";

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
  /** The store could not answer when the page rendered: «checking», never «signed out». */
  checking: boolean;
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
  const fact = useWalletFact();
  /* The last address a wallet actually showed. A pause — locked, between two
     accounts, an extension restarting — shows none and changes nothing. */
  const lastAddress = useRef<string | null>(null);
  const latest = useRef({ summary, address });
  latest.current = { summary, address };
  const [blocked, setBlocked] = useState(false);
  // Derived during render: old private children disappear before effects run.
  const changedWallet = address !== null && lastAddress.current !== null && lastAddress.current !== address;
  const otherWallet = Boolean(summary.walletAddress && address && summary.walletAddress !== address);
  const privacyBlocked = summary.signedIn && (blocked || changedWallet || otherWallet);
  const signedIn = summary.signedIn && !privacyBlocked;
  /* «Checking» only for somebody who was signed in, or before any answer: a
     guest whose one background read failed keeps the way to sign in. */
  const checking = !signedIn && ((fact.status === "down" && (fact.signedIn || fact.at === 0)) || (summary.checking && fact.status !== "known"));

  useEffect(() => { setBlocked(false); }, [summary.sessionKey, summary.signedIn]);

  /* A different wallet is a different person: its address replaces the old
     one, the old account's private view closes and the next one signs in.
     A pause never gets here — only an address that differs from the one
     before it, or from the address this session signed with. */
  useEffect(() => {
    if (address === null) return;
    const before = lastAddress.current;
    lastAddress.current = address;
    const bound = latest.current.summary.walletAddress;
    if (!(before && before !== address) && !(bound && address !== bound)) return;
    if (latest.current.summary.signedIn) setBlocked(true);
    setLoginOpen(false);
    // Clear any private draft from the old account rather than replaying it as
    // the next wallet. Cleanup queues behind an in-flight credential response.
    clearIntent();
    /* The wallet's own sign-in and proof close; a session opened by another
       door stays. The server's answer afterwards says which happened. */
    void clearWalletAccount().catch(() => undefined).finally(() => {
      void revalidateWalletFact({ fresh: true }).finally(() => router.refresh());
    });
  }, [address, router]);

  /* One read of the session for the whole tab, shared with every proof on
     the page: on focus, when the tab comes back, and once a minute. */
  useEffect(() => {
    /* A short visit renews too: past half of its term, the first read of the
       visit is the one that extends the sign-in. */
    const left = latest.current.summary.expiresAt ? Date.parse(latest.current.summary.expiresAt) - Date.now() : Infinity;
    if (latest.current.summary.signedIn && left < 15 * 24 * 3600 * 1000) void revalidateWalletFact();
    else ensureWalletFact();
    const refresh = () => { if (document.visibilityState === "visible") void revalidateWalletFact(); };
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ryntra-account-context");
    if (channel) channel.onmessage = () => {
      if (latest.current.summary.signedIn) setBlocked(true);
      void revalidateWalletFact();
      router.refresh();
    };
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      channel?.close();
    };
  }, [router]);

  /* The server's fresh answer against what this page was rendered with.
     The same account as rendered releases a temporary block (a renewed
     sign-in, another tab signing the same account in, a wallet change that
     left another door's session open). Ended — expired, revoked, signed out
     in another tab — closes the private view. Anything else re-reads the
     layout, once per distinct answer, so it never loops. A store that cannot
     answer changes nothing here. */
  const factKey = `${fact.status}|${fact.signedIn}|${fact.walletAddress ?? ""}`;
  const refreshedFor = useRef<string | null>(null);
  /* A new render of the layout is a new baseline: the same answer may need
     one more re-read against it. */
  useEffect(() => { refreshedFor.current = null; }, [summary]);
  useEffect(() => {
    if (fact.status !== "known") return;
    const rendered = latest.current.summary;
    const reread = () => {
      if (refreshedFor.current === factKey) return;
      refreshedFor.current = factKey;
      router.refresh();
    };
    if (rendered.signedIn && fact.signedIn && rendered.walletAddress === fact.walletAddress) {
      setBlocked(false);
      if (rendered.checking) reread();
    } else if (rendered.signedIn && !fact.signedIn) {
      setBlocked(true);
      reread();
    } else if (rendered.checking || rendered.signedIn !== fact.signedIn || rendered.walletAddress !== fact.walletAddress) {
      reread();
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the answer and its time, by design */
  }, [factKey, fact.at, router]);

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
      checking,
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
    [summary, signedIn, checking, privacyBlocked, copy, locale, loginOpen, openLogin, attachMode, closeLogin, notice, dismissNotice, logout, logoutPending],
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
  const { privacyBlocked, checking, sessionKey, copy, openLogin } = useAccount();
  const pathname = usePathname();
  /* The store blinked: the session is not known to be gone, so nobody is
     asked to sign again — the page says so and comes back by itself. */
  if (checking && !PUBLIC_PAGES.has(pathname)) return <CheckingSignIn copy={copy.checkingPage} />;
  if (privacyBlocked && !PUBLIC_PAGES.has(pathname)) return <section className="ry-wallet-entry">
    <p role="status">{copy.privateGate.lead}</p>
    <button type="button" className="rw-btn" onClick={() => openLogin("generic")}>{copy.privateGate.action}</button>
  </section>;
  return <div key={`${sessionKey ?? "guest"}:${privacyBlocked ? "private-hidden" : "ready"}`} style={{ display: "contents" }}>{children}</div>;
}

/* The page while the store cannot answer: what is happening, that nothing is
   asked of the person, and — once it takes longer than a moment — a way to
   ask again now instead of waiting for the next quiet retry. */
function CheckingSignIn({ copy }: { copy: AccountCopy["checkingPage"] }) {
  const [long, setLong] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLong(true), 10_000);
    return () => window.clearTimeout(timer);
  }, []);
  const again = async () => {
    setAsking(true);
    await revalidateWalletFact();
    setAsking(false);
  };
  return <section className="ry-wallet-entry ry-checking">
    <h1 className="ry-checking-title"><span className="ry-checking-dot" aria-hidden="true" />{copy.title}</h1>
    <p className="ry-muted" role="status">{long ? copy.still : copy.lead}</p>
    {long ? <button type="button" className="rw-btn" disabled={asking} onClick={() => void again()}>{asking ? copy.asking : copy.again}</button> : null}
  </section>;
}
