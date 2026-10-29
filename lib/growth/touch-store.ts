import { randomInt } from "node:crypto";
import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { REFERRAL_CODE_ALPHABET } from "../rewards/referral-code.ts";
import { POST_CODE_LENGTH, POST_CODE_PATTERN, touchLanding } from "./touch-param.ts";
import { sourceFromKey, sourceKey, TOUCH_NONCE, type Touch, type TouchSource } from "./touch.ts";

/**
 * The growth panel's own three records (Ріст 7): visits by source and day, the post codes the panel issued, and the
 * one source each wallet came from. None of them is a boundary — nothing here decides whether money may move — and
 * none stores anything about a person beyond a wallet address they presented themselves.
 */

export const VISITS_COLLECTION = "growthVisits" as const;
export const POST_CODES_COLLECTION = "growthPostCodes" as const;
export const TOUCH_WALLETS_COLLECTION = "growthTouchWallets" as const;

/* ------------------------------------------------------------------ visits */

/** Visits one source counts in a day at most: a rough count no loop can run up without end. */
export const VISITS_PER_SOURCE_PER_DAY = 5_000;
/** Different UTM sources a day may open; the rest are counted together as `utm:~other`. */
export const UTM_SOURCES_PER_DAY = 200;
/** Where UTM visits past the day's limit of sources go. */
export const UTM_OVERFLOW_KEY = "utm:~other";

export type VisitsDay = Readonly<{ version: number; day: string; source: string; visits: number }>;
type UtmIndex = Readonly<{ version: number; day: string; sources: readonly string[] }>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayOf(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error("A visit needs a readable moment.");
  return new Date(ms).toISOString().slice(0, 10);
}

/** A UTM source new today takes a place on the day's list, while there is one; else its visits are `utm:~other`. */
async function utmPlace(store: GuardStore, day: string, key: string): Promise<string> {
  const index = store.versioned<UtmIndex>(VISITS_COLLECTION);
  const indexKey = `${day}:~utm`;
  let placed = key;
  await withBoundedCasRetry(async () => {
    const current = await index.get(indexKey);
    const sources = current?.sources ?? [];
    if (sources.includes(key)) return true;
    if (sources.length >= UTM_SOURCES_PER_DAY) {
      placed = UTM_OVERFLOW_KEY;
      return true;
    }
    return index.compareAndSet(indexKey, current?.version ?? null, { version: (current?.version ?? 0) + 1, day, sources: [...sources, key] });
  });
  return placed;
}

/** Count one visit of a source on the day of `now` — up to the day's cap. */
export async function recordVisit(store: GuardStore, source: TouchSource, now: string): Promise<void> {
  const day = dayOf(now);
  let key = sourceKey(source);
  if (source.channel === "utm") key = await utmPlace(store, day, key);
  const collection = store.versioned<VisitsDay>(VISITS_COLLECTION);
  const rowKey = `${day}:${key}`;
  await withBoundedCasRetry(async () => {
    const current = await collection.get(rowKey);
    if ((current?.visits ?? 0) >= VISITS_PER_SOURCE_PER_DAY) return true;
    return collection.compareAndSet(rowKey, current?.version ?? null, { version: (current?.version ?? 0) + 1, day, source: key, visits: (current?.visits ?? 0) + 1 });
  });
}

/** Every day's visits by source, from the first one counted; rows that are not visits are left out. */
export async function readVisits(store: GuardStore): Promise<readonly Readonly<{ day: string; source: string; visits: number }>[]> {
  const rows = await store.collection<Partial<VisitsDay> & Partial<UtmIndex>>(VISITS_COLLECTION).valuesWithPrefix("");
  return rows.flatMap((row) =>
    typeof row.day === "string" && DAY.test(row.day) && typeof row.source === "string" && Number.isInteger(row.visits) && (row.visits as number) > 0
      && (row.source === UTM_OVERFLOW_KEY || sourceFromKey(row.source) !== null)
      ? [{ day: row.day, source: row.source, visits: row.visits as number }]
      : [],
  );
}

/* -------------------------------------------------------------- post codes */

export const POST_NETWORKS = ["x", "telegram", "youtube", "tiktok", "instagram", "other"] as const;
export type PostNetwork = (typeof POST_NETWORKS)[number];
export const POST_KINDS = ["post", "contest"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const PostCodeSchema = z
  .object({
    schema: z.literal("ryntra.growth-post-code"),
    schemaVersion: z.literal("1.0.0"),
    code: z.string().regex(POST_CODE_PATTERN),
    kind: z.enum(POST_KINDS),
    network: z.enum(POST_NETWORKS),
    /** What the post is, in the media session's words — for the panel only, never shown to people. */
    title: z.string().min(1).max(80),
    /** Where the link lands: a page of the Solana product or its site. */
    landing: z.string().min(1).max(300),
    createdAt: z.string().datetime({ offset: true }),
    createdBy: z.string().min(1).max(120),
  })
  .strict();
export type PostCode = z.output<typeof PostCodeSchema>;

export type NewPostCode = Readonly<{ kind: PostKind; network: PostNetwork; title: string; landing: string; createdBy: string; now: string }>;

export type IssueOutcome = Readonly<{ ok: true; post: PostCode }> | Readonly<{ ok: false; reason: "title" | "landing" | "busy" }>;

function freshCode(): string {
  let code = "";
  for (let index = 0; index < POST_CODE_LENGTH; index += 1) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

/** A new post code: a random seven, never one issued before — the store's `insertIfAbsent` decides. */
export async function issuePostCode(store: GuardStore, input: NewPostCode, nextCode: () => string = freshCode): Promise<IssueOutcome> {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (title.length === 0 || title.length > 80) return { ok: false, reason: "title" };
  const landing = touchLanding(input.landing.trim());
  if (!landing) return { ok: false, reason: "landing" };
  const collection = store.collection<PostCode>(POST_CODES_COLLECTION);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const post = PostCodeSchema.parse({
      schema: "ryntra.growth-post-code",
      schemaVersion: "1.0.0",
      code: nextCode(),
      kind: input.kind,
      network: input.network,
      title,
      landing,
      createdAt: input.now,
      createdBy: input.createdBy,
    });
    if (await collection.insertIfAbsent(post.code, post)) return { ok: true, post };
  }
  return { ok: false, reason: "busy" };
}

export async function readPostCode(store: GuardStore, code: string): Promise<PostCode | null> {
  const parsed = PostCodeSchema.safeParse(await store.collection<unknown>(POST_CODES_COLLECTION).get(code));
  return parsed.success ? parsed.data : null;
}

export async function listPostCodes(store: GuardStore): Promise<readonly PostCode[]> {
  const rows = await store.collection<unknown>(POST_CODES_COLLECTION).valuesWithPrefix("");
  return rows
    .flatMap((row) => {
      const parsed = PostCodeSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.code.localeCompare(b.code));
}

/* ----------------------------------------------------------- wallet touches */

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const TouchWalletSchema = z
  .object({
    schema: z.literal("ryntra.growth-touch-wallet"),
    schemaVersion: z.literal("1.0.0"),
    wallet: z.string().regex(BASE58_ADDRESS),
    channel: z.enum(["post", "contest", "friend", "utm"]),
    source: z.string().min(1).max(120),
    /** The first tagged visit of the browser that brought this wallet. */
    touchAt: z.string().datetime({ offset: true }),
    /** The moment the wallet appeared in that browser. */
    boundAt: z.string().datetime({ offset: true }),
    /** The browser had also proven the wallet by signing in. */
    proven: z.boolean(),
  })
  .strict();
export type TouchWallet = z.output<typeof TouchWalletSchema>;

export type BindOutcome = "bound" | "already" | "refused";

/** The mark a touch leaves once it has bound its wallet; never a wallet's key (no address starts with `~`). */
const nonceKey = (nonce: string) => `~${nonce}`;

/**
 * The source a wallet came from — written once, at the wallet's first appearance in a browser that carries a
 * touch; a later browser or a later link never rewrites it, and one touch binds one wallet: the wallet's row and
 * the touch's mark are inserted together or not at all. Whether the wallet was new to Ryntra then is the panel's
 * question (it reads the wallet's first appearance in the cabinet and the ledger), not this write's.
 */
export async function bindTouchWallet(store: GuardStore, args: Readonly<{ wallet: string; touch: Touch; now: string; proven: boolean }>): Promise<BindOutcome> {
  if (!BASE58_ADDRESS.test(args.wallet)) return "refused";
  const row = TouchWalletSchema.safeParse({
    schema: "ryntra.growth-touch-wallet",
    schemaVersion: "1.0.0",
    wallet: args.wallet,
    channel: args.touch.channel,
    source: args.touch.source,
    touchAt: new Date(args.touch.at).toISOString(),
    boundAt: args.now,
    proven: args.proven,
  });
  if (!row.success || !TOUCH_NONCE.test(args.touch.nonce)) return "refused";
  const collection = store.collection<unknown>(TOUCH_WALLETS_COLLECTION);
  const written = await collection.insertAllIfAbsent([
    { key: args.wallet, value: row.data },
    { key: nonceKey(args.touch.nonce), value: { nonce: args.touch.nonce, at: args.now } },
  ]);
  return written ? "bound" : "already";
}

export async function listTouchWallets(store: GuardStore): Promise<readonly TouchWallet[]> {
  const rows = await store.collection<unknown>(TOUCH_WALLETS_COLLECTION).valuesWithPrefix("");
  return rows.flatMap((row) => {
    const parsed = TouchWalletSchema.safeParse(row);
    return parsed.success && sourceFromKey(parsed.data.channel === "friend" ? "friend" : `${parsed.data.channel}:${parsed.data.source}`) ? [parsed.data] : [];
  });
}
