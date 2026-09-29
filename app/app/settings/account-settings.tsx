"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { WalletEntry } from "../account/wallet-entry";
import { useAccount } from "../account/account-context";

/**
 * Settings → Wallets & notifications: the wallets that open this account,
 * the Telegram chat it may write to, and where it is signed in.
 *
 * `RYN-ACCESS-WALLET-ONLY-001`. An account is the wallet that signed; a
 * second proven wallet is the spare key. Telegram is connected here as a
 * channel and never as a way in. The legacy identity block (email, Google,
 * Telegram sign-in) renders only while the customer doors are switched on,
 * so an account that already has those methods can still tidy them; nobody
 * new is offered one.
 */
type IdentityRow = { id: string; provider: "email" | "google" | "telegram" | "other"; label: string | null; createdAt: string | null };
type WalletRow = { chain: "solana" | "evm"; address: string; verifiedAt: string };
type SessionRow = { id: string; kind: string; method: string; issuedAt: string; lastSeenAt: string; current: boolean };
type Overview = {
  accountId: string | null;
  telegramLinked: boolean;
  identityStore: "ok" | "signed_out" | "unavailable" | "off" | "mismatch";
  identities: IdentityRow[];
  wallets: WalletRow[];
  sessions: SessionRow[];
  currentMethod: string | null;
};
type TelegramView = { connected: boolean; username: string | null; connectedAt: string | null };
type TelegramState = "idle" | "reading" | "starting" | "waiting" | "expired" | "unavailable";

/* Fifteen minutes is the life of the connect code; the page stops asking when the code is dead. */
const TELEGRAM_POLL_MS = 5_000;
const TELEGRAM_WAIT_MS = 15 * 60_000;

const COPY = {
  en: {
    wallets: "Wallets of this account",
    walletsHint: "A wallet you have signed a message with opens this account. A second proven wallet is your spare key — link it while you can still sign with the first. Linking never gives Ryntra spending rights.",
    noWallets: "No wallet proven yet. Prove one from Holdings or Receipts.",
    linkWallet: "Link another wallet",
    unlink: "Unlink",
    legacyWallet: "This wallet is a legacy sign-in identity and cannot be removed here.",
    telegramTitle: "Telegram notifications",
    telegramHint: "The bot writes here only what you turn on. Connecting is not a way to sign in and gives no access to the wallet.",
    telegramOff: "Not connected",
    telegramOn: "Connected",
    telegramSince: "since",
    telegramConnect: "Connect Telegram",
    telegramOpen: "Open Telegram",
    telegramWaiting: "Press Start in the bot — this page will notice.",
    telegramDisconnect: "Disconnect",
    telegramExpired: "The link has expired. Press Connect again.",
    telegramUnavailable: "Telegram cannot be connected right now.",
    telegramReading: "Checking…",
    sessions: "Where you are signed in",
    noSessions: "No session is recorded for this account yet.",
    current: "this device",
    signOutAll: "Sign out everywhere",
    signOut: "Sign out on this device",
    lastSeen: "last seen",
    loading: "Reading…",
    failed: "Could not read the account right now.",
    lastMethod: "This is the last sign-in method; add another one first.",
    removed: "Removed.",
    methods: "Existing sign-in methods",
    methodsHint: "Methods this account was opened with before wallet sign-in. They stay usable for this account only.",
    email: "Email and password",
    google: "Google",
    telegram: "Telegram",
    telegramBot: "Telegram bot (legacy link)",
    add: "Add",
    remove: "Remove",
    setPassword: "Set or change password",
    identityExpired: "To change sign-in methods, sign in again first.",
    identityMismatch: "This browser is signed in to the identity provider as somebody else. Sign out there, then sign in as this account.",
    identityOff: "Account methods are not turned on yet.",
    addFirst: "Add email, Google or Telegram sign-in",
  },
  uk: {
    wallets: "Гаманці цього акаунта",
    walletsHint: "Гаманець, яким ви підписали повідомлення, відкриває цей акаунт. Другий підтверджений гаманець — запасний ключ: привʼяжіть його, поки можете підписати першим. Привʼязка не дає Ryntra права витрачати.",
    noWallets: "Гаманець ще не підтверджено. Підтвердьте його з Активів або Квитанцій.",
    linkWallet: "Прив’язати ще один гаманець",
    unlink: "Відвʼязати",
    legacyWallet: "Цей гаманець є старою ідентичністю входу й не видаляється тут.",
    telegramTitle: "Сповіщення в Telegram",
    telegramHint: "Бот пише сюди лише те, що ви ввімкнете. Підключення не є способом входу й не дає доступу до гаманця.",
    telegramOff: "Не підключено",
    telegramOn: "Підключено",
    telegramSince: "з",
    telegramConnect: "Підключити Telegram",
    telegramOpen: "Відкрити Telegram",
    telegramWaiting: "Натисніть Start у боті — ця сторінка сама це помітить.",
    telegramDisconnect: "Відключити",
    telegramExpired: "Посилання застаріло. Натисніть «Підключити» ще раз.",
    telegramUnavailable: "Зараз Telegram підключити не вдається.",
    telegramReading: "Перевіряю…",
    sessions: "Де виконано вхід",
    noSessions: "Для цього облікового запису ще не записано жодної сесії.",
    current: "цей пристрій",
    signOutAll: "Вийти всюди",
    signOut: "Вийти на цьому пристрої",
    lastSeen: "востаннє",
    loading: "Читаю…",
    failed: "Не вдалося прочитати обліковий запис.",
    lastMethod: "Це останній спосіб входу; спочатку додайте інший.",
    removed: "Видалено.",
    methods: "Наявні способи входу",
    methodsHint: "Способи, якими цей акаунт відкривали до входу гаманцем. Вони діють лише для цього акаунта.",
    email: "Email і пароль",
    google: "Google",
    telegram: "Telegram",
    telegramBot: "Telegram-бот (старе посилання)",
    add: "Додати",
    remove: "Видалити",
    setPassword: "Встановити або змінити пароль",
    identityExpired: "Щоб змінити способи входу, спочатку увійдіть знову.",
    identityMismatch: "У цьому браузері провайдер входу тримає іншу особу. Вийдіть там і увійдіть як цей обліковий запис.",
    identityOff: "Способи облікового запису ще не ввімкнено.",
    addFirst: "Додати вхід через email, Google або Telegram",
  },
} as const;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function whenText(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB");
}

async function readTelegram(signal?: AbortSignal): Promise<TelegramView | null> {
  const r = await fetch("/api/account/notifications", { signal });
  if (!r.ok) return null;
  const data = (await r.json()) as { telegram?: TelegramView };
  return data.telegram ?? null;
}

export function AccountSettings() {
  const { signedIn, copy, locale, methods, accountsOn, customerDoors, openLogin, attachable, logout, logoutPending } = useAccount();
  const c = locale === "uk" ? COPY.uk : COPY.en;
  const pathname = usePathname();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [showWalletLink, setShowWalletLink] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<TelegramView | null>(null);
  const [telegramState, setTelegramState] = useState<TelegramState>("reading");
  const [telegramLink, setTelegramLink] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const r = await fetch("/api/auth/identity", { signal });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json() as Overview;
      if (signal?.aborted) return;
      setOverview(data);
      setState("ready");
    } catch {
      if (signal?.aborted) return;
      setState("failed");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (signedIn) void load(controller.signal);
    else setOverview(null);
    return () => controller.abort();
  }, [signedIn, load]);

  /* The channel is read on its own: a legacy session without an account gets
     401 here and the block says so instead of pretending. */
  useEffect(() => {
    if (!signedIn) { setTelegram(null); setTelegramState("reading"); return; }
    const controller = new AbortController();
    setTelegramState("reading");
    readTelegram(controller.signal)
      .then((view) => { if (controller.signal.aborted) return; setTelegram(view); setTelegramState(view ? "idle" : "unavailable"); })
      .catch(() => { if (!controller.signal.aborted) setTelegramState("unavailable"); });
    return () => controller.abort();
  }, [signedIn]);

  /* While the bot link is out, the page asks every few seconds whether the
     person pressed Start; the code dies after fifteen minutes and so does the wait. */
  useEffect(() => {
    if (telegramState !== "waiting") return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > TELEGRAM_WAIT_MS) { setTelegramState("expired"); setTelegramLink(null); return; }
      readTelegram()
        .then((view) => { if (view?.connected) { setTelegram(view); setTelegramState("idle"); setTelegramLink(null); } })
        .catch(() => { /* the next tick asks again */ });
    }, TELEGRAM_POLL_MS);
    return () => clearInterval(timer);
  }, [telegramState]);

  if (!signedIn) {
    return (
      <div className="ry-settings-row">
        <span className="ry-muted">{locale === "uk" ? "Вхід не виконано" : "Not signed in"}</span>
        <button type="button" className="rw-btn" data-variant="primary" onClick={() => openLogin("settings")}>{copy.signIn}</button>
      </div>
    );
  }

  const unlinkIdentity = async (id: string) => {
    const r = await fetch("/api/auth/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unlink", identityId: id }) });
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    setMsg(r.ok ? c.removed : data.error === "last_method" ? c.lastMethod : c.failed);
    void load();
  };
  const unlinkWallet = async (w: WalletRow) => {
    const r = await fetch("/api/auth/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unlink_wallet", chain: w.chain, address: w.address }) });
    const data = await r.json().catch(() => ({})) as { error?: string };
    setMsg(r.ok ? c.removed : data.error === "last_method" ? c.lastMethod : data.error === "legacy_wallet" ? c.legacyWallet : c.failed);
    void load();
  };
  const linkUrl = (provider: "google" | "telegram") => `/api/auth/oauth?provider=${provider}&purpose=link&next=${encodeURIComponent(`${pathname}#account`)}`;
  const has = (provider: IdentityRow["provider"]) => overview?.identities.some((i) => i.provider === provider) ?? false;

  const connectTelegram = async () => {
    setTelegramState("starting");
    setTelegramLink(null);
    try {
      const r = await fetch("/api/account/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      const data = (await r.json().catch(() => ({}))) as { link?: string };
      if (!r.ok || typeof data.link !== "string") { setTelegramState("unavailable"); return; }
      setTelegramLink(data.link);
      setTelegramState("waiting");
      /* Opened from the click, so the browser lets it through; the link below
         stays for a browser that did not. */
      window.open(data.link, "_blank", "noopener,noreferrer");
    } catch {
      setTelegramState("unavailable");
    }
  };
  const disconnectTelegram = async () => {
    setTelegramState("starting");
    try {
      const r = await fetch("/api/account/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) });
      if (!r.ok) { setTelegramState("unavailable"); return; }
      setTelegram({ connected: false, username: null, connectedAt: null });
      setTelegramState("idle");
    } catch {
      setTelegramState("unavailable");
    }
  };

  const telegramStatus = telegramState === "reading"
    ? c.telegramReading
    : telegram?.connected
      ? `${c.telegramOn}${telegram.username ? ` · @${telegram.username}` : ""}`
      : telegramState === "unavailable"
        ? c.telegramUnavailable
        : c.telegramOff;

  return (
    <div className="ry-account-settings-block">
      {state === "loading" ? <p className="ry-muted">{c.loading}</p> : null}
      {state === "failed" ? <p className="ry-muted" role="status">{c.failed}</p> : null}
      {msg ? <p className="ry-muted" role="status">{msg}</p> : null}

      <h3 className="ry-section-title">{c.wallets}</h3>
      <p className="ry-muted">{c.walletsHint}</p>
      {overview && overview.wallets.length === 0 ? <p className="ry-muted">{c.noWallets}</p> : null}
      <ul className="ry-account-list">
        {overview?.wallets.map((w) => (
          <li key={`${w.chain}:${w.address}`} className="ry-account-row">
            <div className="ry-account-row-meta">
              <span className="ry-account-mono" title={w.address}>{short(w.address)}</span>
              <small>{w.chain === "solana" ? "Solana" : "EVM"}</small>
            </div>
            <button type="button" className="ry-action-link" onClick={() => void unlinkWallet(w)}>{c.unlink}</button>
          </li>
        ))}
      </ul>
      <button type="button" className="rw-btn" onClick={() => setShowWalletLink(!showWalletLink)}>{c.linkWallet}</button>
      {showWalletLink ? <WalletEntry mode="link" onSuccess={() => { void load(); }} /> : null}

      <h3 className="ry-section-title">{c.telegramTitle}</h3>
      <p className="ry-muted">{c.telegramHint}</p>
      <div className="ry-account-row">
        <div className="ry-account-row-meta">
          <span role="status">{telegramStatus}</span>
          {telegram?.connected && telegram.connectedAt ? <small>{c.telegramSince} {whenText(telegram.connectedAt, locale)}</small> : null}
          {telegramState === "waiting" ? <small role="status">{c.telegramWaiting}</small> : null}
          {telegramState === "expired" ? <small role="status">{c.telegramExpired}</small> : null}
        </div>
        {telegram?.connected ? (
          <button type="button" className="ry-action-link" disabled={telegramState === "starting"} onClick={() => void disconnectTelegram()}>{c.telegramDisconnect}</button>
        ) : telegramState === "waiting" && telegramLink ? (
          <a className="rw-btn" href={telegramLink} target="_blank" rel="noopener noreferrer">{c.telegramOpen}</a>
        ) : (
          <button type="button" className="rw-btn" data-variant="primary" disabled={telegramState === "reading" || telegramState === "starting" || telegramState === "unavailable"} onClick={() => void connectTelegram()}>{c.telegramConnect}</button>
        )}
      </div>

      <h3 className="ry-section-title">{c.sessions}</h3>
      {overview && overview.sessions.length === 0 ? <p className="ry-muted">{c.noSessions}</p> : null}
      <ul className="ry-account-list">
        {overview?.sessions.map((s) => (
          <li key={s.id} className="ry-account-row">
            <div className="ry-account-row-meta">
              <span>{s.method in copy.methods ? copy.methods[s.method as keyof typeof copy.methods] : s.method}{s.current ? ` · ${c.current}` : ""}</span>
              <small>{c.lastSeen} {whenText(s.lastSeenAt, locale)}</small>
            </div>
          </li>
        ))}
      </ul>
      <div className="ry-account-actions">
        <button type="button" className="rw-btn" disabled={logoutPending} onClick={() => void logout("this")}>{c.signOut}</button>
        <button type="button" className="rw-btn" disabled={logoutPending} onClick={() => void logout("all")}>{c.signOutAll}</button>
      </div>

      {customerDoors ? (
        <>
          <h3 className="ry-section-title">{c.methods}</h3>
          <p className="ry-muted">{c.methodsHint}</p>
          {!accountsOn ? <p className="ry-muted">{c.identityOff}</p> : overview?.identityStore === "mismatch" ? <p className="ry-muted" role="status">{c.identityMismatch}</p> : overview?.identityStore === "signed_out" && !attachable ? <p className="ry-muted">{c.identityExpired}</p> : null}
          {accountsOn && attachable ? (
            <div className="ry-account-actions">
              <button type="button" className="rw-btn" onClick={() => openLogin("settings", undefined, { attach: true })}>{c.addFirst}</button>
            </div>
          ) : null}
          <ul className="ry-account-list">
            {overview?.telegramLinked ? (
              <li className="ry-account-row"><div className="ry-account-row-meta"><span>{c.telegramBot}</span></div></li>
            ) : null}
            {overview?.identities.map((i) => (
              <li key={i.id} className="ry-account-row">
                <div className="ry-account-row-meta">
                  <span>{i.provider === "email" ? c.email : i.provider === "google" ? c.google : i.provider === "telegram" ? c.telegram : i.provider}</span>
                  {i.label ? <small className="ry-account-mono">{i.label}</small> : null}
                </div>
                {overview.identities.length > 1 && overview.identityStore === "ok" ? (
                  <button type="button" className="ry-action-link" onClick={() => void unlinkIdentity(i.id)}>{c.remove}</button>
                ) : null}
              </li>
            ))}
          </ul>
          {accountsOn && overview?.identityStore === "ok" ? (
            <div className="ry-account-actions">
              <Link className="ry-action-link" href="/app/settings/reset">{c.setPassword}</Link>
              {methods.google && !has("google") ? <a className="ry-action-link" href={linkUrl("google")}>{c.add} Google</a> : null}
              {methods.telegram && !has("telegram") ? <a className="ry-action-link" href={linkUrl("telegram")}>{c.add} Telegram</a> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
