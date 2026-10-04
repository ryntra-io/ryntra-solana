import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/* Signed, stateless tokens with PURPOSE SEPARATION: base64url("<payload>.<hmac-sha256-hex>").
   Payload = "[login|sess]:[admin:]<subject>~<expiryMs>[~<jti>]".

   Two distinct purposes so one credential can never do another's job:
     login (deep-link)  — issued by the bot into `?t=` URLs. Its ONLY power is to be exchanged at
                          /api/session for a session cookie. It is REJECTED as an API bearer and as
                          a session cookie. A leaked login link therefore cannot read /api/paper or
                          /api/live and cannot be planted verbatim as a session.
     sess  (session)    — minted server-side at the exchange and lives only in the HttpOnly
                          `rt`/`rta`/`rw` cookies. It is never serialized into a URL or client bundle.

   New login links carry a random JTI. /api/session atomically records it before minting a session,
   so the same link cannot be exchanged twice. Rotating BETA_TOKEN_SECRET revokes all tokens.

   SUBJECTS: a session token names either the legacy stateless subject — a Telegram
   id or a lowercase EVM address — or a SERVER-RECORDED SESSION (`s<uuid>`). The recorded form is the
   only one that can be revoked before its expiry; the stateless forms are accepted until they expire
   (30 days at most) and are no longer minted for new sign-ins.

   LEGACY COMPAT: ordinary-user pre-purpose tokens are accepted as login and session only until
   their signed embedded expiry. Admin credentials always require an explicit purpose; admin login
   additionally requires a one-time JTI. Remove user compatibility after the deployed legacy
   minting code has been retired for at least its maximum 45-day TTL. */

const SECRET = process.env.BETA_TOKEN_SECRET;

// Deep-link (login) TTLs — shorter than the old 45-day user token; buttons older than this need a
// fresh bot command (the bot re-issues on every /start · /status · /demo · /admin). Tunable.
const LOGIN_TTL_MS = 7 * 24 * 3600 * 1000; // user login link
const ADMIN_LOGIN_TTL_MS = 15 * 60 * 1000; // admin login link — 15 minutes
// Session cookie TTLs — must match the cookie maxAge set in /api/session.
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // user session
const ADMIN_SESSION_TTL_MS = 24 * 3600 * 1000; // admin session — 24 hours

export type TokenPurpose = "login" | "sess";

function sign(payload: string): string {
  return createHmac("sha256", SECRET ?? "").update(payload).digest("hex");
}

function issue(payload: string): string | null {
  if (!SECRET) return null;
  return Buffer.from(`${payload}.${sign(payload)}`).toString("base64url");
}

/** HMAC-verify only; returns the raw payload string (purpose/expiry not yet checked). */
function verifyMac(token: string): string | null {
  if (!SECRET) return null;
  try {
    const raw = Buffer.from(token, "base64url").toString();
    const dot = raw.lastIndexOf(".");
    if (dot < 1) return null;
    const payload = raw.slice(0, dot);
    const mac = raw.slice(dot + 1);
    if (!/^[0-9a-f]{64}$/.test(mac) || payload.length > 128) return null;
    const given = Buffer.from(mac, "hex");
    const expected = Buffer.from(sign(payload), "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Who a token is for.
 *
 * A subject is a Telegram id, a wallet address **or a recorded session id**,
 * never two of them and never none. An address is an account in its own
 * right, and the alternative — minting a synthetic Telegram id for wallet
 * accounts — was rejected on sight: a fabricated identifier that looks
 * exactly like a real one is the kind of lie that survives for years.
 *
 * A wallet subject is written `w` followed by the lowercase address; a session
 * subject is written `s` followed by the uuid of its row in `private.sessions`.
 * The prefixes keep the three forms apart for a parser and for a person
 * reading a payload. The longest payload is
 * `sess:admin:s<36 chars>~<13 digits>` at 62 characters, well inside the
 * 128-character cap `verifyMac` enforces.
 */
export type TokenSubject =
  | Readonly<{ kind: "telegram"; telegramId: number }>
  | Readonly<{ kind: "wallet"; wallet: string }>
  | Readonly<{ kind: "session"; sessionId: string }>;

type Parsed = {
  purpose: TokenPurpose | null;
  subject: TokenSubject;
  admin: boolean;
  exp: number;
  jti: string | null;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Parse a MAC-verified payload; reject malformed or expired tokens. */
function parse(payload: string): Parsed | null {
  const m = payload.match(
    new RegExp(`^(?:(login|sess):)?(admin:)?(\\d{1,15}|w0x[0-9a-f]{40}|s${UUID})~(\\d{10,16})(?:~([A-Za-z0-9_-]{24}))?$`),
  );
  if (!m) return null; // pre-expiry legacy (no ~expiry) is long gone → user re-opens from the bot
  const exp = Number(m[4]);
  if (!(exp > Date.now())) return null;
  const purpose = (m[1] as TokenPurpose | undefined) ?? null;
  const jti = m[5] ?? null;
  if (jti && purpose !== "login") return null;

  const raw = m[3];
  const subject: TokenSubject = raw.startsWith("w")
    ? { kind: "wallet", wallet: raw.slice(1) }
    : raw.startsWith("s")
      ? { kind: "session", sessionId: raw.slice(1) }
      : { kind: "telegram", telegramId: Number(raw) };

  /* A recorded session is always an explicit `sess` purpose: there is no login
     link for one and no legacy form of one, so anything else is a forgery. */
  if (subject.kind === "session" && purpose !== "sess") return null;

  /* An admin credential is a Telegram admin (bot link) or a recorded admin
     session. There is no wallet admin path and inventing one here would be the
     widest possible hole in the narrowest possible place. */
  if (m[2] && subject.kind === "wallet") return null;

  return { purpose, subject, admin: !!m[2], exp, jti };
}

function verifyParsed(token: string): Parsed | null {
  const p = verifyMac(token);
  return p ? parse(p) : null;
}

/* ---------- issue ---------- */

export function issueLoginToken(telegramId: number): string | null {
  const jti = randomBytes(18).toString("base64url");
  return issue(`login:${telegramId}~${Date.now() + LOGIN_TTL_MS}~${jti}`);
}

export function issueSessionToken(telegramId: number): string | null {
  return issue(`sess:${telegramId}~${Date.now() + SESSION_TTL_MS}`);
}

/**
 * A session for an account identified only by its wallet.
 *
 * The address is lowercased here rather than trusted from the caller, because
 * this string becomes the lookup key for every subsequent read and a
 * mixed-case duplicate would be a second account for one person.
 */
export function issueWalletSessionToken(wallet: string): string | null {
  const normalized = wallet.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) return null;
  return issue(`sess:w${normalized}~${Date.now() + SESSION_TTL_MS}`);
}

export function issueAdminLoginToken(telegramId: number): string | null {
  const jti = randomBytes(18).toString("base64url");
  return issue(`login:admin:${telegramId}~${Date.now() + ADMIN_LOGIN_TTL_MS}~${jti}`);
}

export function issueAdminSessionToken(telegramId: number): string | null {
  return issue(`sess:admin:${telegramId}~${Date.now() + ADMIN_SESSION_TTL_MS}`);
}

const SESSION_ID = new RegExp(`^${UUID}$`);

/**
 * A cookie value that names a recorded session.
 *
 * The signed expiry mirrors the row's absolute expiry so a cookie that outlives
 * its row is refused before any store is asked; the row is still the authority
 * on revocation and idleness. `admin` marks the privileged form, which only the
 * `rta` cookie carries.
 */
export function issueSessionRefToken(sessionId: string, expiresAtMs: number, admin = false): string | null {
  const id = sessionId.trim().toLowerCase();
  if (!SESSION_ID.test(id)) return null;
  const exp = Math.floor(expiresAtMs);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  return issue(`sess:${admin ? "admin:" : ""}s${id}~${exp}`);
}

/* ---------- verify ---------- */

export type LoginCredential = {
  telegramId: number;
  admin: boolean;
  jti: string | null;
  expiresAt: number;
};

/**
 * Accept a LOGIN token (or a legacy token during compat) at the /api/session exchange ONLY.
 * A `sess` token is REJECTED here — session credentials never travel as login links.
 */
export function verifyLoginToken(token: string): LoginCredential | null {
  const p = verifyParsed(token);
  if (!p) return null;
  if (p.purpose === "sess") return null; // purpose separation: a session token is not a login link
  if (p.admin && (p.purpose !== "login" || !p.jti)) return null;
  /* A login link is a bot deep-link and therefore always a Telegram subject.
     There is no wallet or session login link to issue, so any other shape is a
     forged payload rather than a case to handle. */
  if (p.subject.kind !== "telegram") return null;
  return { telegramId: p.subject.telegramId, admin: p.admin, jti: p.jti, expiresAt: p.exp };
}

/**
 * Accept a SESSION token (or a legacy token during compatibility) from the HttpOnly cookie.
 * A `login` token is REJECTED here — a deep-link can never act as a session/API credential.
 */
export function verifySession(token: string): { subject: TokenSubject; admin: boolean } | null {
  const p = verifyParsed(token);
  if (!p) return null;
  if (p.purpose === "login") return null; // purpose separation: a login link is not a session
  if (p.admin && p.purpose !== "sess") return null;
  return { subject: p.subject, admin: p.admin };
}


/* ---------- bot deep-links (all carry LOGIN tokens; exchanged for a session at /api/session) ---------- */

export function statusPageUrl(telegramId: number, lang: string): string {
  return sessionUrl(telegramId, lang, "/app/beta");
}

/** Bot link that exchanges a LOGIN token for a session cookie, then lands on a clean cabinet URL. */
export function sessionUrl(telegramId: number, lang: string, next: string): string {
  const t = issueLoginToken(telegramId);
  return t
    ? `https://ryntra.io/api/session?t=${t}&lang=${lang}&next=${encodeURIComponent(next)}`
    : `https://ryntra.io/beta?lang=${lang}`;
}

export function adminSessionUrl(telegramId: number): string | null {
  const t = issueAdminLoginToken(telegramId);
  return t ? `https://ryntra.io/api/session?t=${t}&next=%2Fadmin` : null;
}

export function demoUrl(telegramId: number, lang: string): string {
  return sessionUrl(telegramId, lang, "/robinhood/workspace/terminal");
}
