import { LaunchMetadataRequestSchema, type LaunchMetadataResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { checkLaunchForm } from "@/lib/launch/form";
import { storeLaunchImage, storeLaunchMetadata } from "@/lib/launch/metadata.server";
import { consumeLaunchWrite, launchDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/launch/metadata` (contract 1.25.0) — the token's picture and
 * fields, checked by the same rules the form shows (a name or ticker that
 * borrows a known brand or person is refused with the names), stored once
 * each under the sha256 of their bytes, and the metadata URI the mint will
 * name for ever. Builds and signs nothing.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused for a moment; try again later.");
  const rate = consumeLaunchWrite("metadata", request.headers);
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
  const bytes = Buffer.from(body.imageBase64, "base64");
  const image = await storeLaunchImage(deps.store, new Uint8Array(bytes), now);
  if (!image.ok) return apiFailure("LAUNCH_IMAGE_INVALID", image.code === "IMAGE_TOO_LARGE" ? "The picture is too large." : "The picture is not a PNG, JPEG, WebP or GIF.");
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
