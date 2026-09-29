import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * «Keep the account I already have», made explicit.
 *
 * Joining a new identity to an existing account is the one operation where two
 * separate authorities have to agree: the browser's product session says which
 * account, and the verifier says which identity. Doing it implicitly — reading
 * whatever cookies happen to be present at the end of a sign-in — is what let a
 * signup confirmed in an operator's browser bind itself to the operator.
 *
 * So the instruction is stated first, signed, and checked against the live
 * context when it is spent. Two purposes use it:
 *
 *   `admin_bootstrap`  the owner attaches a verified identity to the operator
 *                      account from the transitional bot session. Context is
 *                      that admin session, subject is the auth user, and the
 *                      screen shows both before the owner confirms.
 *   `email_signup`     somebody with a Telegram bot account creates an email
 *                      login for it. The instruction is given in the sheet, and
 *                      it has to survive the trip through the mailbox — so it
 *                      lives in an HttpOnly cookie in the browser that gave it,
 *                      bound to that session and that address. A link opened
 *                      anywhere else carries no instruction and attaches
 *                      nothing.
 *
 * A stale intent, a different session, a different identity: each makes the
 * token describe a world that no longer exists, and the bind is refused rather
 * than applied to the new one. Nothing secret is carried — two identifiers, a
 * purpose, a nonce and a timestamp, signed with `BETA_TOKEN_SECRET`.
 */
export type AttachPurpose = "admin_bootstrap" | "email_signup";

/** How long each instruction stays spendable. */
const TTL_MS: Record<AttachPurpose, number> = {
  /* Read on the screen and confirmed in the same minute. */
  admin_bootstrap: 5 * 60 * 1000,
  /* Long enough to walk to a mailbox and back, short enough that a shared
     computer does not carry it into somebody else's afternoon. */
  email_signup: 60 * 60 * 1000,
};

export type AttachIntent = Readonly<{
  purpose: AttachPurpose;
  /** The session the instruction was given in: an admin session key, or a product session key. */
  context: string;
  /** The account the identity is to join. */
  accountId: string;
  /** Who is joining: an auth user id, or the address a confirmation will prove. */
  subject: string;
  nonce: string;
  issuedAt: number;
}>;

export const ATTACH_COOKIE = "ry_attach";

function secret(): string | null {
  const value = process.env.BETA_TOKEN_SECRET;
  return value && value.length >= 16 ? value : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(`attach.${payload}`).digest("base64url");
}

export function issueAttachIntent(
  input: Readonly<{ purpose: AttachPurpose; context: string; accountId: string; subject: string }>,
  now = Date.now(),
): { value: string; intent: AttachIntent } | null {
  const key = secret();
  if (!key) return null;
  const intent: AttachIntent = { ...input, nonce: randomBytes(18).toString("base64url"), issuedAt: now };
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return { value: `${payload}.${sign(payload, key)}`, intent };
}

export function readAttachIntent(value: string | null | undefined, now = Date.now()): AttachIntent | null {
  const key = secret();
  if (!key || typeof value !== "string" || value.length > 2048) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload, key), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<AttachIntent>;
    if (
      (parsed.purpose !== "admin_bootstrap" && parsed.purpose !== "email_signup") ||
      typeof parsed.context !== "string" ||
      typeof parsed.accountId !== "string" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    if (parsed.issuedAt > now + 60_000 || now - parsed.issuedAt > TTL_MS[parsed.purpose]) return null;
    return {
      purpose: parsed.purpose,
      context: parsed.context,
      accountId: parsed.accountId,
      subject: parsed.subject,
      nonce: parsed.nonce,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Does the instruction still describe the live context?
 *
 * Every field has to match what the server sees right now. This is what makes
 * a captured or replayed token useless: it names one session, one account and
 * one subject, and outside that triple it authorises nothing.
 */
export function attachIntentMatches(
  intent: AttachIntent | null,
  live: Readonly<{ purpose: AttachPurpose; context: string; accountId: string; subject: string }>,
): boolean {
  if (!intent) return false;
  return (
    intent.purpose === live.purpose &&
    intent.context === live.context &&
    intent.accountId === live.accountId &&
    intent.subject.toLowerCase() === live.subject.toLowerCase()
  );
}

export const ATTACH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(TTL_MS.email_signup / 1000),
};
