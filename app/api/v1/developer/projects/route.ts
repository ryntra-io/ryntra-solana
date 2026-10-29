import { DevProjectCreateRequestSchema, type DevProjectResponse, type DevProjectsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { consumeDevWrite, devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { createProject, listProjects } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `GET /api/v1/developer/projects?team=` (1.83.0, DEV-2) — the team's projects on this network, for a wallet whose role views. */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const team = new URL(request.url).searchParams.get("team") ?? "";
  if (!/^[0-9a-f]{24}$/.test(team)) return apiFailure("VALIDATION_ERROR", "team: the team's id.");
  const projects = await listProjects(served.deps, { teamId: team, wallet: proof.address });
  if (!projects.ok) return devFailure(projects, rateLimitHeaders(rate));
  return apiJson({ network: served.deps.network, projects: projects.projects } satisfies DevProjectsResponse, 200, rateLimitHeaders(rate));
}

/** `POST /api/v1/developer/projects` (1.83.0, DEV-2) — a project for a team the proven wallet may draft in. */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, DevProjectCreateRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const made = await createProject(served.deps, { teamId: read.body.team, wallet: proof.address, name: read.body.name });
  if (!made.ok) return devFailure(made, rate.headers);
  return apiJson({ project: made.project } satisfies DevProjectResponse, 200, rate.headers);
}
