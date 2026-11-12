// Hack's windows on a stand (CITY-227): the real routes of CITY-226 over the memory store, a seeded world of orders,
// takes and findings, and the real step runner's journal (CITY-225, the stub brain on the made-up copy — no network,
// no key) served as the run's own route, which no server serves yet. Not a test file: the view's tests and the
// windows' shots (`city/components/arena/hack/hack-shots.mjs`) import it.
//
//   const stand = await createStand();
//   stand.as(OWNER_A);                              // whose wallet the routes see
//   await stand.fetch("/api/arena/hack/orders");    // a Response, as the browser would get it
//
// Every answer but the run's is the real service's, on the library's real rules; the only fakes are the signature
// check (the library fixtures' `"good"`) and the sandbox's verdict per finding (`prove`), as in CITY-226's own tests.
import { addr, makeGrant, makeOrder, makeProof, verify, hashOf, PROTOCOL, OWNER_A, OWNER_B, PROGRAM, PROGRAM2, AT } from "../fixtures.mjs";

const { createHackApi } = await import("../store/api.ts");
const { createHackService } = await import("../store/service.ts");
const { createMemoryHackDb } = await import("../store/memory.ts");

export { PROTOCOL, OWNER_A, OWNER_B, AT };
export const PROTOCOL_2 = addr(7);
export const OWNER_C = addr(8);

/** The agents of the stand, by ids shaped as the Ring's (a uuid): each looks its own way (a body and four characters). */
export const A7 = "7f3ka1c2-0b5e-4d1a-9c77-1e2f3a4b5c6d";
export const A8 = "8e21b9d0-5c4a-4f3e-8a1b-2c3d4e5f6a7b";
export const A9 = "9c4d7e12-3a5b-4c6d-8e7f-0a1b2c3d4e5f";
export const A5 = "5ab0c3f4-6d7e-4f80-9a1b-3c4d5e6f7a8b";

const ACCOUNT = { [PROTOCOL]: "a:protocol", [PROTOCOL_2]: "a:protocol-2", [OWNER_A]: "a:owner-a", [OWNER_B]: "a:owner-b", [OWNER_C]: "a:owner-c" };
const ROSTER = new Map([
  [A7, { account: ACCOUNT[OWNER_A], active: true }],
  [A8, { account: ACCOUNT[OWNER_A], active: true }],
  [A9, { account: ACCOUNT[OWNER_B], active: true }],
  [A5, { account: ACCOUNT[OWNER_C], active: true }],
]);

const HOUR = 3_600_000;

/** The sandbox's verdict per finding title on the stand: reproduced, or left for the owner's review. */
const VERDICTS = {
  "Withdraw skips the owner check": "PASS",
  "Deposit rounds in the caller's favour": "NEEDS_REVIEW",
  "Liquidation pays twice on one call": "PASS",
  "Claim ignores the cooldown": "PASS",
  "Split keeps the dust": "PASS",
  "Swap rounds the fee down twice": "PASS",
};

/** The journal of a run, as the harness writes it: the real runner's, a miss first and then the break. */
async function realJournal() {
  const fx = await import("../runner/fixtures.mjs");
  const { runAgent, stubBrain } = fx.runner;
  const opts = { view: fx.view(), maxTurns: 10, classCeilingMicroUsd: 1_000_000, moveMicroUsd: 50 };
  const miss = await runAgent(fx.session(fx.inProc()), stubBrain({ plan: fx.stubPlan({ exploit: fx.f.NOT_REPRODUCED }), moveMicroUsd: 50 }), opts);
  const hit = await runAgent(fx.session(fx.inProc()), stubBrain({ plan: fx.stubPlan(), moveMicroUsd: 50 }), opts);
  const plain = (value) => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
  const [read, assemble, held] = plain(miss.history);
  const [, build, broke, submit] = plain(hit.history);
  return [read, assemble, held, build, broke, submit];
}

export async function createStand({ now: start = AT } = {}) {
  let t = start;
  const now = () => t;
  let who = null;
  const db = createMemoryHackDb({ now });
  let ids = 0;
  const service = createHackService({
    db,
    verify,
    prove: async ({ finding }) => {
      const verdict = VERDICTS[finding.title];
      return verdict && finding.logHash ? makeProof({ verdict, logHash: finding.logHash }) : null;
    },
    agentOf: async (hunter) => ROSTER.get(hunter) ?? null,
    now,
    newId: () => `f-${++ids}`,
  });
  const api = createHackApi({
    service: () => service,
    open: () => true,
    caller: async () => (who ? { status: "ok", caller: { wallet: who, account: ACCOUNT[who] ?? null } } : { status: "absent" }),
    network: () => `ip:${hashOf("stand").slice(0, 32)}`,
    store: db,
    now,
  });

  let keys = 0;
  async function write(action, body, wallet) {
    const before = who;
    who = wallet;
    try {
      const res = await api[action](
        new Request(`https://ryntra.io/api/arena/hack/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://ryntra.io", "idempotency-key": `stand-${++keys}-seed` },
          body: JSON.stringify(body),
        }),
      );
      const answer = await res.json();
      if (res.status >= 300) throw new Error(`${action}: ${res.status} ${JSON.stringify(answer)}`);
      return answer;
    } finally {
      who = before;
    }
  }

  const open = (protocol, over) => {
    const o = makeOrder({ protocol, ...over });
    return write("open", { order: o, grant: makeGrant(o) }, protocol).then(() => o);
  };
  const take = (order, hunter, role, owner) => write("take", { order, hunter, role }, owner);
  const file = (order, hunter, owner, over) =>
    write("submit", { order, hunter, target: { program: PROGRAM, instruction: over.instruction }, vulnClass: over.vulnClass, severity: over.severity, title: over.title, logHash: hashOf(over.title) }, owner);

  // The world: two protocols, four orders, four agents of three owners, five findings.
  const vault = await open(PROTOCOL, {
    id: "vault-audit",
    title: "Vault program — training audit",
    scope: { programs: [PROGRAM], instructions: ["withdraw", "deposit"], excluded: ["The admin keys", "The price feed"] },
    reward: { pool: "pool-vault", note: "Training run · rating" },
    opensAt: start - 2 * HOUR,
    closesAt: start + 5 * 24 * HOUR,
  });
  const swap = await open(PROTOCOL_2, {
    id: "swap-rounding",
    title: "Swap pool — fee rounding",
    target: { kind: "fork", program: PROGRAM2, slot: 250_000_000 },
    scope: { programs: [PROGRAM2] },
    reward: { pool: "pool-swap", note: "Training run · rating" },
    opensAt: start - HOUR,
    closesAt: start + 6 * HOUR,
  });
  const lending = await open(PROTOCOL, {
    id: "lending-liquidation",
    title: "Lending desk — liquidation path",
    scope: { programs: [PROGRAM], instructions: ["liquidate"] },
    reward: { pool: "pool-lending" },
    opensAt: start - 3 * HOUR,
    closesAt: start + 2 * HOUR,
  });
  const staking = await open(PROTOCOL_2, {
    id: "staking-claims",
    title: "Staking vault — reward claims",
    scope: { programs: [PROGRAM], instructions: ["claim", "split", "stake"] },
    reward: { pool: "pool-staking", note: "Training run · rating" },
    opensAt: start - HOUR,
    closesAt: start + 3 * 24 * HOUR,
  });

  await take(vault.id, A7, "attacker", OWNER_A);
  await take(vault.id, A9, "defender", OWNER_B);
  await take(lending.id, A8, "attacker", OWNER_A);
  await take(lending.id, A9, "defender", OWNER_B);
  await take(staking.id, A5, "attacker", OWNER_C);
  await take(staking.id, A9, "defender", OWNER_B);

  t += 10 * 60_000;
  await file(vault.id, A7, OWNER_A, { instruction: "withdraw", vulnClass: "auth-bypass", severity: "high", title: "Withdraw skips the owner check" });
  t += 20 * 60_000;
  await file(vault.id, A7, OWNER_A, { instruction: "deposit", vulnClass: "rounding", severity: "medium", title: "Deposit rounds in the caller's favour" });
  await file(lending.id, A8, OWNER_A, { instruction: "liquidate", vulnClass: "double-pay", severity: "critical", title: "Liquidation pays twice on one call" });
  await file(staking.id, A5, OWNER_C, { instruction: "claim", vulnClass: "cooldown", severity: "low", title: "Claim ignores the cooldown" });
  await file(staking.id, A5, OWNER_C, { instruction: "split", vulnClass: "dust", severity: "medium", title: "Split keeps the dust" });

  // Past the lending order's window: the system closes it on the next read.
  t += 3 * HOUR;

  /* The run's own route — no server serves it yet. A run starts when an agent is sent (a take through this stand) and
     shows one more turn of the real journal at each read; at the end it files its finding through the real route. */
  const journal = await realJournal();
  const runs = new Map();
  let held = false;
  const runOf = async (order, hunter) => {
    const run = runs.get(`${order}:${hunter}`);
    if (!run) return null;
    if (!held && run.shown < journal.length) run.shown += 1;
    const done = run.shown >= journal.length;
    if (done && !run.finding) {
      const filed = await write(
        "submit",
        { order, hunter, target: { program: PROGRAM2, instruction: "swap" }, vulnClass: "fee-rounding", severity: "high", title: "Swap rounds the fee down twice", logHash: journal[5].result.logHash },
        run.owner,
      ).catch(() => null);
      run.finding = filed?.finding?.id ?? null;
    }
    return { order, hunter, role: run.role, status: done ? "done" : "running", maxTurns: 10, history: journal.slice(0, run.shown), result: done ? "submitted" : null, finding: run.finding ?? null, startedAt: run.startedAt };
  };

  /** What the browser gets for a call to `/api/arena/hack/**`, as the wallet set by `as` (or none). */
  async function fetchHack(url, init = {}) {
    const u = new URL(url, "https://ryntra.io");
    const action = u.pathname.replace(/^\/api\/arena\/hack\//, "");
    if (action === "run") {
      const run = await runOf(u.searchParams.get("order") ?? "", u.searchParams.get("hunter") ?? "");
      return Response.json({ run });
    }
    const handler = api[action];
    if (!handler) return Response.json({ error: { code: "NOT_FOUND", message: "There is no such route." } }, { status: 404 });
    // The stand stands for the site wherever the page is served from (a developer's port too): one origin for the
    // request and the browser's own headers, so the routes' same-site rule is walked as on the site.
    const headers = new Headers(init.headers ?? {});
    headers.delete("sec-fetch-site");
    if ((init.method ?? "GET") === "POST") headers.set("origin", "https://ryntra.io");
    const res = await handler(new Request(`https://ryntra.io${u.pathname}${u.search}`, { method: init.method ?? "GET", headers, body: init.body }));
    if (action === "take" && res.status === 200 && who) {
      const body = JSON.parse(init.body);
      const key = `${body.order}:${body.hunter}`;
      if (!runs.has(key)) runs.set(key, { role: body.role, owner: who, shown: 0, startedAt: t, finding: null });
    }
    return res;
  }

  /** The Ring's «my agent» for the wallet set by `as` (`/api/ring/mine`): A7 for OWNER_A. */
  function mine() {
    if (!who) return { signedIn: false, agents: [], bay: null };
    const agents = who === OWNER_A ? [ringAgent(A7, "Engineer 7F3K", "engineer")] : [];
    return { signedIn: true, agents, bay: { quarter: "bay-0123456789abcdef0123456789abcdef", slot: 0 } };
  }

  return {
    api,
    fetch: fetchHack,
    mine,
    as: (wallet) => {
      who = wallet;
    },
    tick: (ms) => (t += ms),
    /** Hold a run where it is (a shot of it live), or let it go on. */
    hold: (on) => {
      held = on;
    },
    now,
    journal,
    orders: { vault, swap, lending, staking },
  };
}

function ringAgent(id, name, archetype) {
  return {
    id,
    quarterId: "bay-0123456789abcdef0123456789abcdef",
    slot: 0,
    name,
    archetype,
    brain: { id: "openai/gpt-6-luna", name: "GPT-6 Luna", provider: "openai", providerName: "OpenAI", weight: "light", matchMicroUsd: 14_000 },
    formats: ["duo-crack"],
    ratings: [],
    status: "active",
    version: 1,
    createdAt: "",
    updatedAt: "",
  };
}
