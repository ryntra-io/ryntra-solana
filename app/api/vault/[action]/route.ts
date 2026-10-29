import { vaultApi } from "@/lib/vault/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The Vault's three routes in one handler — POST /attempt, GET /state, GET /feed. Instances do not share memory, so a
 * deployment keeps the limits, progress, feed and request keys in the database (`lib/vault/supabase-store.ts`) and
 * every instance reads the same rows; the vault does not open in production on one instance's memory
 * (`lib/vault/server.ts`). The memory store serves tests and a developer's machine.
 */
type Context = { params: Promise<{ action: string }> };

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "There is no such route." } }, { status: 404 });

export async function GET(req: Request, { params }: Context) {
  const { action } = await params;
  if (action === "state") return vaultApi().state(req);
  if (action === "feed") return vaultApi().feed(req);
  return notFound();
}

export async function POST(req: Request, { params }: Context) {
  const { action } = await params;
  if (action === "attempt") return vaultApi().attempt(req);
  return notFound();
}
