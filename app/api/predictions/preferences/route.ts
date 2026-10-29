import { z } from "zod";

import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { LAYOUT_BYTES_LIMIT, isLayoutPage, storableLayout } from "@/lib/predictions/preferences";
import { readProfile, saveProfile } from "@/lib/predictions/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    prefs: z.record(z.string(), z.unknown()).optional(),
    layout: z.object({ page: z.string().refine(isLayoutPage, "not a layout page"), value: z.record(z.string(), z.unknown()) }).strict().optional(),
  })
  .strict()
  .refine((body) => body.prefs !== undefined || body.layout !== undefined, "nothing to save");

/** The person's settings and layouts, as their account keeps them. */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const profile = await readProfile(actor.store, actor.wallet);
  if (!profile.ok) return predictionFailure(profile);
  return predictionJson({ wallet: actor.wallet, ...profile.value });
}

/** Saves the settings, or one page's layout; the later change wins, and the answer is the profile after. */
export async function PUT(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body, LAYOUT_BYTES_LIMIT + 4_096);
  if (!read.ok) return read.response;
  const { prefs, layout } = read.body;
  if (layout && !storableLayout(layout.value)) return predictionFailure(failure("VALIDATION_ERROR", "The layout does not match the workspace's shape."));
  const { actor } = resolved;
  const saved = await saveProfile(actor.store, actor.wallet, { ...(prefs ? { prefs } : {}), ...(layout ? { layout } : {}) });
  if (!saved.ok) return predictionFailure(saved);
  return predictionJson({ wallet: actor.wallet, ...saved.value });
}
