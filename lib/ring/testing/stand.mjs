/*
 * A stand for the Ring on a developer's machine (CITY-217): a throwaway PostgreSQL database with the Ring's two
 * migrations applied (`pg.mjs`), and in front of it the one door of Supabase the server uses — PostgREST's
 * `POST /rest/v1/rpc/<function>` with the app secret in the body — so `next dev` runs the Ring on the database exactly as
 * a deployment would, through `lib/ring/supabase-store.ts` and `lib/ring/duel/supabase-store.ts`.
 *
 *   RING_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres node lib/ring/testing/stand.mjs [port]
 *
 * then, in another shell, the lines it prints, e.g.:
 *
 *   SUPABASE_URL=http://127.0.0.1:54330 SUPABASE_ANON_KEY=stand BETA_APP_SECRET=world-test-secret \
 *   RYNTRA_RING_STORE=database RYNTRA_RING_MODELS=stub RYNTRA_RING_STAND=1 \
 *   NEXT_PUBLIC_RYNTRA_CITY_RING=open NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS=open npm run dev
 *
 * Only `ring_*` functions answer; anything else is a 404, as an unapplied function would be. Ctrl-C drops the
 * database. Never point it at a real project.
 */
import { createServer } from "node:http";

import { TEST_SECRET, throwawayDatabase } from "./pg.mjs";

const url = process.env.RING_TEST_DATABASE_URL;
if (!url) {
  console.error("RING_TEST_DATABASE_URL names a local PostgreSQL server.");
  process.exit(1);
}
const port = Number(process.argv[2] ?? 54330);
const db = await throwawayDatabase(url);

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const match = /^\/rest\/v1\/rpc\/(ring_\w+)$/.exec(req.url ?? "");
  if (req.method !== "POST" || !match) return send(404, { message: "not on the stand" });
  let text = "";
  for await (const chunk of req) text += chunk;
  try {
    const { p_secret: secret, ...args } = JSON.parse(text || "{}");
    const answer = await db.rpc(match[1], args, secret);
    return answer.ok ? send(200, answer.data) : send(400, { message: answer.error });
  } catch (error) {
    return send(400, { message: error instanceof Error ? error.message : "bad request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`the Ring's stand: database ${db.name}, PostgREST's door on http://127.0.0.1:${port}`);
  console.log(`SUPABASE_URL=http://127.0.0.1:${port} SUPABASE_ANON_KEY=stand BETA_APP_SECRET=${TEST_SECRET} RYNTRA_RING_STORE=database`);
});

const stop = async () => {
  server.close();
  await db.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
