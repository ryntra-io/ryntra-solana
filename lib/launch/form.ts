/**
 * «Запустити токен» — what a creator fills in, and the rules it is held to
 * before anything is built.
 *
 * Name, ticker and picture go into the token's mint and its metadata for
 * ever: Token-2022 metadata in every preset is immutable, so a typo cannot be
 * fixed later by anyone. The rules are therefore checked twice — as the
 * creator types, and on the server before it stores or builds anything — by
 * this one module.
 *
 * Pure and client-safe.
 */

import { z } from "zod";

import { launchNameHits, type ModerationHit } from "../core/launch/moderation.ts";

export const NAME_MAX = 32;
export const SYMBOL_MAX = 10;
export const DESCRIPTION_MAX = 280;
/** The picture after the page has shrunk it: at most this many bytes, in one of the formats every wallet shows. */
export const IMAGE_MAX_BYTES = 256 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The picture's type from its first bytes — what the file is, not what its name says. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  const starts = (...head: number[]) => head.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export const LINK_KINDS = ["website", "x", "telegram"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

const LINK_HOSTS: Readonly<Record<LinkKind, readonly string[] | null>> = {
  website: null,
  x: ["x.com", "twitter.com"],
  telegram: ["t.me", "telegram.me"],
};

/** A link as the creator typed it, made whole (`https://` added), or why it is not one; empty is no link. */
export function normalizeLink(kind: LinkKind, raw: string): { ok: true; value: string | null } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || url.href.length > 200) return { ok: false };
  const hosts = LINK_HOSTS[kind];
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hosts && (!hosts.includes(host) || url.pathname.length < 2)) return { ok: false };
  return { ok: true, value: url.href };
}

/** What a creator wrote, each field as typed. */
export type LaunchFormFields = Readonly<{ name: string; symbol: string; description: string; website: string; x: string; telegram: string }>;

export type FieldProblem = "REQUIRED" | "TOO_LONG" | "SYMBOL_CHARS" | "LINK" | "BORROWED";

export type FormCheck = Readonly<{
  problems: Readonly<Partial<Record<keyof LaunchFormFields, FieldProblem>>>;
  /** The brands and people a name or ticker borrows. */
  hits: readonly ModerationHit[];
  /** The fields as they go on chain and into the metadata: trimmed, the ticker in capitals, the links whole. */
  clean: Readonly<{ name: string; symbol: string; description: string; links: Readonly<Record<LinkKind, string | null>> }>;
}>;

/** Every rule at once, so the page can mark each field and the server can refuse with the same words. */
export function checkLaunchForm(fields: LaunchFormFields): FormCheck {
  const problems: Partial<Record<keyof LaunchFormFields, FieldProblem>> = {};
  const name = fields.name.trim().replace(/\s+/g, " ");
  const symbol = fields.symbol.trim().replace(/^\$/, "").toUpperCase();
  const description = fields.description.trim();
  if (!name) problems.name = "REQUIRED";
  else if (new TextEncoder().encode(name).length > NAME_MAX) problems.name = "TOO_LONG";
  if (!symbol) problems.symbol = "REQUIRED";
  else if (symbol.length > SYMBOL_MAX) problems.symbol = "TOO_LONG";
  else if (!/^[A-Z0-9]+$/.test(symbol)) problems.symbol = "SYMBOL_CHARS";
  if ([...description].length > DESCRIPTION_MAX) problems.description = "TOO_LONG";
  const links = {} as Record<LinkKind, string | null>;
  for (const kind of LINK_KINDS) {
    const link = normalizeLink(kind, fields[kind]);
    if (link.ok) links[kind] = link.value;
    else {
      links[kind] = null;
      problems[kind] = "LINK";
    }
  }
  const hits = launchNameHits({ name, symbol });
  for (const hit of hits) if (!problems[hit.field]) problems[hit.field] = "BORROWED";
  return { problems, hits, clean: { name, symbol, description, links } };
}

/** The token's metadata, as the mint's URI serves it — the fields wallets and explorers read. */
export const TokenMetadataSchema = z
  .object({
    name: z.string().min(1).max(64),
    symbol: z.string().min(1).max(SYMBOL_MAX),
    description: z.string().max(DESCRIPTION_MAX * 4),
    image: z.string().url(),
    website: z.string().url().optional(),
    twitter: z.string().url().optional(),
    telegram: z.string().url().optional(),
    createdOn: z.literal("https://ryntra.io"),
  })
  .strict();
export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;
