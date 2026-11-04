import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { launchExecutorAddress, launchNetwork, launchPoolPayerAddress } from "@/lib/launch/config.server";
import { launchSignerCheck } from "@/lib/launch/signer/check.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const digest = (text: string) => createHash("sha256").update(text).digest();

/**
 * Whether this deployment reaches its KMS keys (CITY-163): the public keys read, nothing signed, no coin and no
 * transaction (`lib/launch/signer/check.server.ts`). There is no such route without `RYNTRA_LAUNCH_SIGNER_CHECK_TOKEN`,
 * which is set on one deployment for one check and never in the project's variables.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.RYNTRA_LAUNCH_SIGNER_CHECK_TOKEN?.trim();
  if (!expected) return new NextResponse(null, { status: 404, headers: privateNoStoreHeaders() });
  if (!timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${expected}`))) return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const network = launchNetwork();
  const check = await launchSignerCheck(process.env, (role) => (network ? (role === "executor" ? launchExecutorAddress(network) : launchPoolPayerAddress(network)) : null));
  return NextResponse.json(check, { headers: privateNoStoreHeaders() });
}
