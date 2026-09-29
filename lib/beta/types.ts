export type BetaLang = "en" | "uk" | "ru";

export type TaskType = "telegram_join" | "arcus_referral" | "x_follow";
export type TaskStatus = "pending" | "submitted" | "verified" | "rejected";

export type BetaStatus =
  | "pending"
  | "telegram_verified"
  | "arcus_submitted"
  | "x_verified"
  | "beta_approved"
  | "priority";

/** Ladder order used for progress rendering. */
export const STATUS_LADDER: BetaStatus[] = [
  "pending",
  "telegram_verified",
  "arcus_submitted",
  "x_verified",
  "beta_approved",
  "priority",
];

export type BetaState = {
  user: {
    /* `null` since migration `20260812131229` made the column nullable for
       wallet-only accounts. The type was still saying `number` afterwards,
       which is the schema and the code disagreeing in the one direction that
       never fails loudly: every read looked safe and one of them was not. */
    /* The account uuid (`beta_users.id`), projected by the state function since
       the RYN-ACCESS-002 migration; absent until it is applied. */
    id?: string;
    /**
     * When legacy access for this account was closed, if it ever was.
     *
     * A stateless pre-migration cookie has no row to revoke, so «вийти всюди»
     * and a password reset could not reach it: the browser's own copy was
     * deleted and every other copy kept working until it expired. This is the
     * per-account cutoff that makes those two actions true for legacy cookies
     * as well, without rotating the signing secret and throwing out everybody
     * else's session. Absent until the migration that projects it is applied.
     */
    legacy_closed_at?: string | null;
    telegram_id: number | null;
    username: string | null;
    first_name: string | null;
    language: string;
    wallet_address: string | null;
    proof_code: string;
    referral_code: string;
    created_at: string;
  };
  tasks: Partial<Record<TaskType, { status: TaskStatus; verified_at: string | null }>>;
  access: { status: BetaStatus; priority_score: number; approved_at: string | null };
  invites: { total: number; valid: number };
  is_new?: boolean;
  inviter_telegram_id?: number | null;
};

export const LINKS = {
  bot: "https://t.me/RyntraBeta_bot",
  /* `channel` — the public Telegram channel URL — is gone. It had no reader
     left in the codebase and it was the address the founder retired from every
     public surface. `channelHandle` below is not the same fact wearing a
     different shape: `isChannelAdmin()` reads it to decide who is an admin, so
     it is an access list and it stays. Public contact identities live in
     `lib/site/contacts.ts`. */
  channelHandle: "@Ryntra_io",
  x: "https://x.com/Ryntra_io",
  arcus: "https://waitlist.arcus.xyz/s/RYNTRA",
  site: "https://ryntra.io",
} as const;

export function pickBetaLang(code?: string | null): BetaLang {
  const c = (code ?? "").toLowerCase();
  if (c === "uk" || c.startsWith("uk-") || c === "ua") return "uk";
  if (c === "ru" || c.startsWith("ru-")) return "ru";
  return "en";
}
