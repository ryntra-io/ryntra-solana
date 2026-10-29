/**
 * «Знайомство» in the Guard store (AI-06) — one collection,
 * `assistantProfiles`, no DDL.
 *
 * - `profile:solana:mainnet:<wallet>` — the person's five answers (the goal,
 *   the experience, the risk per trade, the horizon) or that they skipped
 *   them; versioned, so two tabs never write over each other. Where notes go
 *   is not kept here: it is Нагляд's preferences, read and written as they are.
 */

import { z } from "zod";

import { ASSISTANT_EXPERIENCE, ASSISTANT_GOALS, ASSISTANT_HORIZONS, type AssistantProfile } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";

export const PROFILES_COLLECTION = "assistantProfiles" as const;

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });

export const ProfileRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.profile"),
    version: z.number().int().min(1),
    owner: Wallet,
    skipped: z.boolean(),
    goal: z.enum(ASSISTANT_GOALS).nullable(),
    experience: z.enum(ASSISTANT_EXPERIENCE).nullable(),
    riskPct: z.union([z.literal(0.5), z.literal(1), z.literal(2)]).nullable(),
    horizon: z.enum(ASSISTANT_HORIZONS).nullable(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

export const profileKey = (owner: string) => `profile:solana:mainnet:${owner}`;

type Versioned = { version: number };
const profiles = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(PROFILES_COLLECTION);

export async function readProfileRecord(store: GuardStore, owner: string): Promise<ProfileRecord | null> {
  const parsed = ProfileRecordSchema.safeParse(await profiles(store).get(profileKey(owner)));
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

/** The stored row's version whatever its shape — what a write is pinned to when the row is not one this code reads. */
export async function readProfileVersion(store: GuardStore, owner: string): Promise<number | null> {
  const raw = await profiles(store).get(profileKey(owner));
  return raw && typeof raw.version === "number" ? raw.version : null;
}

/** Write over the version read; false when someone else wrote first. */
export async function writeProfileRecord(store: GuardStore, next: ProfileRecord, expected: number | null): Promise<boolean> {
  return profiles(store).compareAndSet(profileKey(next.owner), expected, ProfileRecordSchema.parse(next));
}

export function profileOf(record: ProfileRecord | null): AssistantProfile | null {
  if (record === null) return null;
  return { skipped: record.skipped, goal: record.goal, experience: record.experience, riskPct: record.riskPct, horizon: record.horizon, updatedAt: record.updatedAt };
}
