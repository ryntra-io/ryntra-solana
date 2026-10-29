import { LaunchMetadataRequestSchema, type LaunchMetadataResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { checkLaunchForm } from "@/lib/launch/form";
import { checkLaunchImage } from "@/lib/launch/image-check.server";
import { isTakenDown, launchImageOf, storeLaunchImage, storeLaunchMetadata } from "@/lib/launch/metadata.server";
import { consumeSharedLaunchWrite, launchDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/launch/metadata` (contract 1.25.0) — the token's picture and
 * fields, checked by the same rules the form shows (a name or ticker that
 * borrows a known brand or person is refused with the names), stored once
 * each under the sha256 of their bytes, and the metadata URI the mint will
 * name for ever. Builds and signs nothing. 1.71.0 (MC-1): the picture is checked
 * first — one Ryntra took down, or (when the operator switched the check on)
 * one the moderation model flags, is `LAUNCH_IMAGE_REFUSED`; a check that
 * could not run stores nothing (`LAUNCH_IMAGE_CHECK_UNAVAILABLE`).
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("metadata", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchMetadataRequestSchema, 420_000);
  if (!read.ok) return read.response;
  const body = read.body;
  const check = checkLaunchForm(body);
  if (check.hits.length) {
    return apiFailure("LAUNCH_NAME_BORROWED", `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(", ")}.`);
  }
  const problem = Object.entries(check.problems)[0];
  if (problem) return apiFailure("VALIDATION_ERROR", `${problem[0]}: ${problem[1]}`);
  const now = deps.now().toISOString();
  const bytes = new Uint8Array(Buffer.from(body.imageBase64, "base64"));
  const picture = launchImageOf(bytes, now);
  if (!picture.ok) return apiFailure("LAUNCH_IMAGE_INVALID", picture.code === "IMAGE_TOO_LARGE" ? "The picture is too large." : "The picture is not a PNG, JPEG, WebP or GIF.");
  /* MC-1: a picture Ryntra took down is not stored again; every other is checked before Ryntra's domain serves it. */
  if (await isTakenDown(deps.store, "image", picture.image.sha256)) return apiFailure("LAUNCH_IMAGE_REFUSED", "Ryntra took this picture down before; choose another.");
  const checked = await checkLaunchImage(picture.image, { env: deps.env ?? process.env, required: deps.network.cluster === "mainnet" });
  if (checked.state === "UNREADABLE") return apiFailure("LAUNCH_IMAGE_INVALID", "The picture could not be read by the check; use a still PNG, JPEG or WebP.");
  if (checked.state === "REFUSED") return apiFailure("LAUNCH_IMAGE_REFUSED", `The picture reads as ${checked.categories.join(", ")}; choose another.`);
  if (checked.state === "UNAVAILABLE") return apiFailure("LAUNCH_IMAGE_CHECK_UNAVAILABLE", "The picture could not be checked right now; nothing was stored. Try again in a moment.");
  const image = await storeLaunchImage(deps.store, bytes, now);
  if (!image.ok) return apiFailure("LAUNCH_IMAGE_INVALID", "The picture is not a PNG, JPEG, WebP or GIF.");
  const imageUrl = `${deps.origin}/api/launch/image/${image.image.sha256}`;
  const metadata = await storeLaunchMetadata(
    deps.store,
    {
      name: check.clean.name,
      symbol: check.clean.symbol,
      description: check.clean.description,
      image: imageUrl,
      ...(check.clean.links.website ? { website: check.clean.links.website } : {}),
      ...(check.clean.links.x ? { twitter: check.clean.links.x } : {}),
      ...(check.clean.links.telegram ? { telegram: check.clean.links.telegram } : {}),
      createdOn: "https://ryntra.io",
    },
    now,
  );
  return apiJson({ metadataUri: `${deps.origin}/api/launch/metadata/${metadata.sha256}`, imageUrl, name: check.clean.name, symbol: check.clean.symbol } satisfies LaunchMetadataResponse, 201);
}
