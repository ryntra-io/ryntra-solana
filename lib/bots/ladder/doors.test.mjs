// Run from repo root: node --test lib/bots/ladder/doors.test.mjs
//
// CITY-219 — the routes' doors: each network by its own switch (closed — the route is not there), a request that names
// no network is devnet's, and on mainnet the limits lane's two doors: this site or the app's session for this wallet,
// and a placement only while trading is on — reading and cancelling never wait.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* The carrier's modules import by the `@/` alias and without extensions, as Next resolves them. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = pathResolve(specifier.slice(2));
      for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts"]) if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && context.parentURL) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const ext of [".ts", ".tsx", ".js", "/index.ts"]) if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
      }
      if (!specifier.startsWith(".") && !specifier.startsWith("node:") && specifier.includes("/") && !/\.[cm]?js$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
      throw error;
    }
  },
});

import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

const { mainnetDoors, openLadder, openLadderPost, requestedNetwork } = await import("./http.server.ts");

const OPEN = { RYNTRA_BOTS_LADDER_MAINNET: "OPEN", RYNTRA_SOLANA_SWAP_STATE: "OPEN" };
const SITE = "https://ryntra.io";
const post = (path, body, headers = { origin: SITE }) => new Request(`${SITE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const Schema = z.object({ network: z.enum(["devnet", "mainnet"]).optional(), owner: z.string() }).strict();
const options = { acts: () => true, owner: (body) => body.owner };

test("a network opens by its own switch only; a request naming none is devnet's, a name that is no network is nothing", async () => {
  assert.equal(requestedNetwork(undefined), "devnet");
  assert.equal(requestedNetwork(""), "devnet");
  assert.equal(requestedNetwork("mainnet"), "mainnet");
  assert.equal(requestedNetwork("mainnet-beta"), null);
  assert.equal(requestedNetwork(7), null);
  const status = (url, env) => openLadder(new Request(url), "status", requestedNetwork(new URL(url).searchParams.get("network")), env);
  assert.equal(status(`${SITE}/api/bots/ladder?network=mainnet`, {}).status, 404, "mainnet closed by default");
  assert.equal(status(`${SITE}/api/bots/ladder?network=mainnet`, { RYNTRA_BOTS_LADDER: "devnet" }).status, 404, "devnet's switch never opens mainnet");
  assert.equal(status(`${SITE}/api/bots/ladder`, OPEN).status, 404, "mainnet's switch never opens devnet");
  assert.equal(status(`${SITE}/api/bots/ladder?network=solana`, OPEN).status, 404);
  assert.equal(status(`${SITE}/api/bots/ladder?network=mainnet`, OPEN).network, "mainnet");
  assert.equal(status(`${SITE}/api/bots/ladder?network=mainnet`, OPEN).maxUsd, 100);
  assert.equal((await openLadderPost(post("/api/bots/ladder/review", { owner: "a" }), "review", Schema, options, OPEN)).status, 404, "no network named: devnet's, closed");
  assert.equal((await openLadderPost(post("/api/bots/ladder/review", { network: "mainnet", owner: "a" }), "review", Schema, options, {})).status, 404);
  const opened = await openLadderPost(post("/api/bots/ladder/review", { network: "mainnet", owner: "a" }), "review", Schema, options, OPEN);
  assert.equal(opened.gate.network, "mainnet");
  assert.deepEqual(opened.body, { network: "mainnet", owner: "a" });
  assert.equal((await openLadderPost(post("/api/bots/ladder/review", { network: "mainnet", owner: "a", extra: 1 }), "review", Schema, options, OPEN)).status, 400);
  assert.equal((await openLadderPost(post("/api/bots/ladder/review", "{not json"), "review", Schema, options, { RYNTRA_BOTS_LADDER: "devnet" })).status, 400);
  assert.equal((await openLadderPost(post("/api/bots/ladder/review", JSON.stringify({ network: "mainnet", owner: "x".repeat(70_000) })), "review", Schema, options, OPEN)).status, 404, "an oversized body names no network it can be trusted with");
  assert.equal((await openLadderPost(post("/api/bots/ladder/review", JSON.stringify({ owner: "x".repeat(70_000) })), "review", Schema, options, { RYNTRA_BOTS_LADDER: "devnet" })).status, 413);
});

test("mainnet's doors: this site only; a placement waits on the trading stop, reading and cancelling never do", async () => {
  const gate = openLadder(new Request(`${SITE}/api/bots/ladder?network=mainnet`), "review", "mainnet", OPEN);
  assert.equal(await mainnetDoors(post("/api/bots/ladder/review", {}), gate, { acts: true, owner: "a" }, OPEN), null);
  assert.equal((await mainnetDoors(post("/api/bots/ladder/review", {}, { origin: "https://evil.example" }), gate, { acts: true, owner: "a" }, OPEN)).status, 403);
  assert.equal((await mainnetDoors(post("/api/bots/ladder/review", {}, {}), gate, { acts: false, owner: "a" }, OPEN)).status, 403, "no origin, not same-origin: refused");
  assert.equal(await mainnetDoors(new Request(`${SITE}/api/bots/ladder?network=mainnet`, { headers: { "sec-fetch-site": "same-origin" } }), gate, { acts: false, owner: null }, OPEN), null, "the window's own read");
  const paused = { ...OPEN, RYNTRA_SOLANA_SWAP_STATE: "PAUSED" };
  assert.equal((await mainnetDoors(post("/api/bots/ladder/review", {}), gate, { acts: true, owner: "a" }, paused)).status, 409);
  assert.equal(await mainnetDoors(post("/api/bots/ladder/cancel", {}), gate, { acts: false, owner: "a" }, paused), null, "taking back is never stopped");
  /* Devnet passes as CITY-135 did. */
  const devnet = openLadder(new Request(`${SITE}/api/bots/ladder`), "review", "devnet", { RYNTRA_BOTS_LADDER: "devnet" });
  assert.equal(await mainnetDoors(post("/api/bots/ladder/review", {}, { origin: "https://evil.example" }), devnet, { acts: true, owner: "a" }, {}), null);
});

test("the rollback: `CLOSING` keeps taking back — orders, cancellations, a cancellation's relay — and closes placing", async () => {
  const closing = { RYNTRA_BOTS_LADDER_MAINNET: "CLOSING", RYNTRA_SOLANA_SWAP_STATE: "OPEN" };
  const Body = z.object({ network: z.literal("mainnet"), owner: z.string(), kind: z.enum(["place", "cancel"]) }).strict();
  const submit = (kind) => openLadderPost(post("/api/bots/ladder/submit", { network: "mainnet", owner: "a", kind }), "submit", Body, { acts: (b) => b.kind === "place", owner: (b) => b.owner, takeBack: (b) => b.kind === "cancel" }, closing);
  assert.equal((await submit("place")).status, 404, "no placing while closing");
  assert.equal((await submit("cancel")).gate.network, "mainnet", "taking back stays");
  assert.equal(openLadder(new Request(`${SITE}/api/bots/ladder?network=mainnet`), "status", "mainnet", closing).status, 404, "the composer is gone from the window");
  const Orders = z.object({ network: z.literal("mainnet"), owner: z.string() }).strict();
  assert.equal((await openLadderPost(post("/api/bots/ladder/orders", { network: "mainnet", owner: "a" }), "orders", Orders, { acts: () => false, owner: (b) => b.owner, takeBack: () => true }, closing)).gate.network, "mainnet");
  /* Unset, nothing at all: closing is a step the operator takes on purpose. */
  assert.equal((await openLadderPost(post("/api/bots/ladder/orders", { network: "mainnet", owner: "a" }), "orders", Orders, { acts: () => false, owner: (b) => b.owner, takeBack: () => true }, {})).status, 404);
  /* A body that does not parse never passes as «taking back». */
  assert.equal((await openLadderPost(post("/api/bots/ladder/submit", { network: "mainnet", owner: "a", kind: "cancel", extra: 1 }), "submit", Body, { acts: () => true, owner: (b) => b.owner, takeBack: (b) => b.kind === "cancel" }, closing)).status, 404);
});
