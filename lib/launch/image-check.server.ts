/**
 * MC-1 — a token's picture checked before Ryntra stores it and serves it from its own domain (audit 24.10, B7).
 *
 * The check is OpenAI's moderation model, which reads images (`omni-moderation-latest`, `POST /v1/moderations`; the
 * endpoint is free of charge) through the key the assistant already holds (`OPENAI_API_KEY`). A picture it flags as
 * sexual, violent, graphic or self-harm is refused; a picture Ryntra took down before (its sha256) is refused without
 * asking. With the key set, a check that could not run refuses too — «unknown is not good»: the person is asked to try
 * again, nothing is stored. Without the key the check cannot run: on mainnet that refuses as well; a devnet stand or a
 * test stores the picture unchecked, as before MC-1. A picture the model cannot read (an animated GIF) is `UNREADABLE`:
 * another file, never «try again».
 *
 * What it does not do: read text inside a picture for a borrowed brand, or recognise a real person's face — the report
 * button and the takedown (`takedown.server.ts`) are for what slips through.
 */

import type { ImageType } from "./form.ts";

export const MODERATION_URL = "https://api.openai.com/v1/moderations";
export const MODERATION_MODEL = "omni-moderation-latest";
const CHECK_MS = 8_000;

/** The categories the model reads in images; any one flagged refuses the picture. */
export const IMAGE_CATEGORIES = ["sexual", "violence", "violence/graphic", "self-harm", "self-harm/intent", "self-harm/instructions"] as const;

export type ImageCheck =
  | Readonly<{ state: "PASSED" }>
  | Readonly<{ state: "REFUSED"; categories: readonly string[] }>
  | Readonly<{ state: "UNAVAILABLE"; reason: string }>
  | Readonly<{ state: "UNREADABLE" }>
  | Readonly<{ state: "UNCHECKED" }>;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export async function checkLaunchImage(
  image: Readonly<{ base64: string; contentType: ImageType }>,
  deps: Readonly<{ env: Readonly<Record<string, string | undefined>>; fetch?: Fetch; /** Mainnet: a check that cannot run refuses. */ required?: boolean }>,
): Promise<ImageCheck> {
  /* Off unless switched on (supervisor 25.10): sending pictures to OpenAI is a new data flow and makes every mainnet launch
     depend on its answer. */
  if (deps.env.RYNTRA_LAUNCH_IMAGE_CHECK?.trim() !== "openai") return { state: "UNCHECKED" };
  const key = deps.env.OPENAI_API_KEY?.trim();
  if (!key) return deps.required ? { state: "UNAVAILABLE", reason: "no moderation key" } : { state: "UNCHECKED" };
  const call = deps.fetch ?? ((input, init) => fetch(input, init));
  let response: Response;
  try {
    response = await call(MODERATION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODERATION_MODEL, input: [{ type: "image_url", image_url: { url: `data:${image.contentType};base64,${image.base64}` } }] }),
      signal: AbortSignal.timeout(CHECK_MS),
    });
  } catch (error) {
    return { state: "UNAVAILABLE", reason: error instanceof Error ? error.message.slice(0, 200) : "no answer" };
  }
  /* 400: the model could not read this file — another picture, not a later try. */
  if (response.status === 400) return { state: "UNREADABLE" };
  if (!response.ok) return { state: "UNAVAILABLE", reason: `moderation ${response.status}` };
  let body: { results?: readonly Readonly<{ flagged?: unknown; categories?: Readonly<Record<string, unknown>> }>[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { state: "UNAVAILABLE", reason: "moderation answered no JSON" };
  }
  const result = body.results?.[0];
  if (!result || typeof result.flagged !== "boolean" || !result.categories) return { state: "UNAVAILABLE", reason: "moderation answered no result" };
  const flagged = IMAGE_CATEGORIES.filter((category) => result.categories?.[category] === true);
  /* `flagged` alone, with no image category set, is a text category the picture cannot carry: it is not a refusal. */
  return flagged.length ? { state: "REFUSED", categories: flagged } : { state: "PASSED" };
}
