import assert from "node:assert/strict";
import test from "node:test";

import { DEV_ACTION_PERMISSION, DEV_LIMITS } from "../core/developer/console.ts";
import { decideTeamPermission } from "../core/team/roles.ts";
import {
  authenticateKey,
  changeEndpoint,
  changeKey,
  createEndpoint,
  createProject,
  issueKey,
  listProjects,
  readDeliveries,
  readProject,
  revokeKey,
  rotateKey,
  sendTestDelivery,
  verifyDelivery,
} from "./service.server.ts";

/**
 * The behaviour every developer-console store passes (DEV-2): the memory adapter in `service.test.mjs`, Postgres in
 * `store-postgres.test.mjs` against a throwaway database the migration ran on. Not a test file by itself.
 */

/* Wallets: base58, the shape a proven wallet has. */
export const OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
export const DEVELOPER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const ANALYST = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
export const OUTSIDER = "So11111111111111111111111111111111111111112";
export const TEAM = "a".repeat(24);
const OTHER_TEAM = "b".repeat(24);

/** The team as the console asks it — the real matrix, not a table written for the test. */
const MEMBERS = {
  [OWNER]: { role: "OWNER", status: "ACTIVE" },
  [DEVELOPER]: { role: "DEVELOPER", status: "ACTIVE" },
  [ANALYST]: { role: "ANALYST", status: "ACTIVE" },
};

export function matrixAuthorize({ teamId, wallet, permission }) {
  if (teamId !== TEAM) return Promise.resolve({ allowed: false, role: null, refusal: "NOT_A_MEMBER" });
  const member = MEMBERS[wallet] ?? null;
  if (!member) return Promise.resolve({ allowed: false, role: null, refusal: "NOT_A_MEMBER" });
  const decision = decideTeamPermission({ member, permission, treasury: null });
  return Promise.resolve({ allowed: decision.allowed, role: decision.role, refusal: decision.refusal });
}

/** A receiver that records what reached it and answers what it was told to. */
export function receiver(answers = [200]) {
  const got = [];
  let turn = 0;
  const send = async (request) => {
    got.push(request);
    const answer = answers[Math.min(turn, answers.length - 1)];
    turn += 1;
    if (answer instanceof Error) throw answer;
    return { status: answer };
  };
  return { send, got };
}

let clock = Date.parse("2026-10-26T12:00:00.000Z");
export const tick = (ms) => {
  clock += ms;
};
export const setClock = (iso) => {
  clock = Date.parse(iso);
};

export const depsOf = (store, over = {}) => ({
  store,
  network: "solana:mainnet",
  now: () => new Date(clock),
  authorize: matrixAuthorize,
  send: receiver().send,
  quota: { minute: null, day: null, month: null },
  ...over,
});

const ok = (answer, what) => {
  assert.equal(answer.ok, true, `${what}: ${answer.ok ? "" : `${answer.code} ${answer.message}`}`);
  return answer;
};

/** A project with one secret key, one public key and one endpoint, for the tests that start from something. */
export async function seed(deps, { origins = ["https://app.example.com"] } = {}) {
  const project = ok(await createProject(deps, { teamId: TEAM, wallet: OWNER, name: "Квиток" }), "project").project;
  const secret = ok(await issueKey(deps, { projectId: project.id, wallet: OWNER, environment: "live", kind: "SECRET", name: "server", scopes: ["read:key", "read:usage", "read:events"] }), "secret key");
  const open = ok(await issueKey(deps, { projectId: project.id, wallet: OWNER, environment: "live", kind: "PUBLIC", name: "browser", scopes: ["read:key"], origins }), "public key");
  const endpoint = ok(await createEndpoint(deps, { projectId: project.id, wallet: OWNER, environment: "live", url: "https://hooks.example.com/ryntra", events: ["ping"] }), "endpoint");
  return { projectId: project.id, secret, open, endpoint };
}

export function devSuite(label, makeStore) {
  const fresh = async (over) => depsOf(await makeStore(), over);

  test(`${label}: a project is made by a role that drafts, and read by the team only`, async () => {
    const deps = await fresh();
    const made = ok(await createProject(deps, { teamId: TEAM, wallet: DEVELOPER, name: "  Перший   проєкт " }), "made");
    assert.equal(made.project.name, "Перший проєкт", "the name is cleaned, not stored as typed");
    assert.equal(made.project.teamId, TEAM);
    assert.deepEqual(
      made.project.usage.map((row) => row.environment),
      ["test", "live"],
      "both environments exist from the first day",
    );

    const mine = ok(await listProjects(deps, { teamId: TEAM, wallet: ANALYST }), "an analyst views");
    assert.equal(mine.projects.length, 1);

    const stranger = await readProject(deps, { id: made.project.id, wallet: OUTSIDER });
    assert.equal(stranger.ok, false);
    assert.equal(stranger.code, "NOT_FOUND", "a wallet outside the team is told nothing about the project");
    const otherTeam = await listProjects(deps, { teamId: OTHER_TEAM, wallet: OWNER });
    assert.equal(otherTeam.code, "NOT_FOUND");
  });

  test(`${label}: a secret is shown once and never again`, async () => {
    const deps = await fresh();
    const { projectId, secret } = await seed(deps);
    assert.match(secret.issued.secret, /^rsk_live_[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(secret.issued.shownOnce, true);
    assert.equal(secret.issued.key.id, secret.issued.secret.split(".")[0], "the id is the token's first half and is not itself a secret");

    /* Nothing that reads the project afterwards carries it — not the key's own view, not the whole answer. */
    const again = ok(await readProject(deps, { id: projectId, wallet: OWNER }), "read again");
    const key = again.project.keys.find((row) => row.id === secret.issued.key.id);
    assert.ok(key, "the key is listed");
    assert.equal(Object.hasOwn(key, "secret"), false);
    assert.equal(JSON.stringify(again).includes(secret.issued.secret.split(".")[1]), false, "the secret half appears nowhere in the project read");

    /* And the rotation that replaces it does not re-show the old one. */
    const rotated = ok(await rotateKey(deps, { projectId, wallet: OWNER, keyId: secret.issued.key.id, graceHours: 0 }), "rotate");
    assert.notEqual(rotated.issued.secret, secret.issued.secret);
    assert.equal(JSON.stringify(rotated.project).includes(secret.issued.secret.split(".")[1]), false);
  });

  test(`${label}: a public key has no secret at all, and names the origins it answers from`, async () => {
    const deps = await fresh();
    const { open } = await seed(deps);
    assert.equal(open.issued.secret, null, "there is nothing to leak from a browser");
    assert.match(open.issued.key.id, /^rpk_live_/);
    assert.deepEqual(open.issued.key.origins, ["https://app.example.com"]);

    const project = (await createProject(deps, { teamId: TEAM, wallet: OWNER, name: "Другий" })).project;
    const noOrigin = await issueKey(deps, { projectId: project.id, wallet: OWNER, environment: "live", kind: "PUBLIC", name: "x", scopes: ["read:key"], origins: [] });
    assert.equal(noOrigin.code, "INVALID");
    const secretWithOrigin = await issueKey(deps, { projectId: project.id, wallet: OWNER, environment: "live", kind: "SECRET", name: "x", scopes: ["read:key"], origins: ["https://a.example.com"] });
    assert.equal(secretWithOrigin.code, "INVALID", "a secret key holds no origins: it answers no browser at all");
    const badOrigin = await issueKey(deps, { projectId: project.id, wallet: OWNER, environment: "live", kind: "PUBLIC", name: "x", scopes: ["read:key"], origins: ["https://a.example.com/app"] });
    assert.equal(badOrigin.code, "INVALID");
  });

  test(`${label}: a revoked key stops answering, and so does one past its rotation grace`, async () => {
    const deps = await fresh();
    const { projectId, secret } = await seed(deps);
    const token = secret.issued.secret;
    ok(await authenticateKey(deps, { token, scope: "read:key", origin: null }), "it answers before");

    ok(await revokeKey(deps, { projectId, wallet: OWNER, keyId: secret.issued.key.id }), "revoke");
    const after = await authenticateKey(deps, { token, scope: "read:key", origin: null });
    assert.equal(after.ok, false);
    assert.equal(after.code, "KEY_INVALID", "a revoked key does not answer from the next request on");

    /* A rotation with a grace: both answer, until the clock passes the grace. */
    const second = ok(await issueKey(deps, { projectId, wallet: OWNER, environment: "live", kind: "SECRET", name: "second", scopes: ["read:key"] }), "second key");
    const rotated = ok(await rotateKey(deps, { projectId, wallet: OWNER, keyId: second.issued.key.id, graceHours: 1 }), "rotate with grace");
    ok(await authenticateKey(deps, { token: second.issued.secret, scope: "read:key", origin: null }), "the old one answers inside the grace");
    ok(await authenticateKey(deps, { token: rotated.issued.secret, scope: "read:key", origin: null }), "the new one answers");
    tick(3_600_001);
    const expired = await authenticateKey(deps, { token: second.issued.secret, scope: "read:key", origin: null });
    assert.equal(expired.code, "KEY_INVALID", "past the grace the old key is gone");
    ok(await authenticateKey(deps, { token: rotated.issued.secret, scope: "read:key", origin: null }), "the successor still answers");
    tick(-3_600_001);
  });

  test(`${label}: a secret key is refused in a browser; a public key only outside its origins`, async () => {
    const deps = await fresh();
    const { secret, open } = await seed(deps);
    const fromBrowser = await authenticateKey(deps, { token: secret.issued.secret, scope: "read:key", origin: "https://app.example.com" });
    assert.equal(fromBrowser.code, "ORIGIN_REFUSED", "a request carrying an Origin is a browser's: a secret key is refused whatever it names");

    ok(await authenticateKey(deps, { token: open.issued.key.id, scope: "read:key", origin: "https://app.example.com" }), "the public key answers its own origin");
    const elsewhere = await authenticateKey(deps, { token: open.issued.key.id, scope: "read:key", origin: "https://evil.example.com" });
    assert.equal(elsewhere.code, "ORIGIN_REFUSED");
    const noOrigin = await authenticateKey(deps, { token: open.issued.key.id, scope: "read:key", origin: null });
    assert.equal(noOrigin.code, "ORIGIN_REFUSED", "a public key is a browser's and says which browser");
  });

  test(`${label}: a scope the key does not hold is refused rather than served`, async () => {
    const deps = await fresh();
    const { projectId, secret } = await seed(deps);
    ok(await authenticateKey(deps, { token: secret.issued.secret, scope: "read:events", origin: null }), "it holds read:events");
    ok(await changeKey(deps, { projectId, wallet: OWNER, keyId: secret.issued.key.id, scopes: ["read:key"] }), "narrow it");
    const refused = await authenticateKey(deps, { token: secret.issued.secret, scope: "read:events", origin: null });
    assert.equal(refused.code, "SCOPE_REFUSED");
    ok(await authenticateKey(deps, { token: secret.issued.secret, scope: "read:key", origin: null }), "what it does hold still answers");
  });

  test(`${label}: a wrong secret half does not answer, and neither does a token of the other shape`, async () => {
    const deps = await fresh();
    const { secret, open } = await seed(deps);
    const [id] = secret.issued.secret.split(".");
    assert.equal((await authenticateKey(deps, { token: `${id}.${"A".repeat(43)}`, scope: "read:key", origin: null })).code, "KEY_INVALID");
    assert.equal((await authenticateKey(deps, { token: id, scope: "read:key", origin: null })).code, "KEY_INVALID", "a secret key is sent whole");
    assert.equal((await authenticateKey(deps, { token: `${open.issued.key.id}.x`, scope: "read:key", origin: null })).code, "KEY_INVALID", "a public key is the id alone");
    assert.equal((await authenticateKey(deps, { token: null, scope: "read:key", origin: null })).code, "KEY_INVALID");
    assert.equal((await authenticateKey(deps, { token: "sk_live_whatever", scope: "read:key", origin: null })).code, "KEY_INVALID");
  });

  test(`${label}: a spent quota window is refused, and says when it starts again`, async () => {
    const deps = await fresh({ quota: { minute: 3, day: null, month: null } });
    const { secret } = await seed(deps);
    const token = secret.issued.secret;
    for (let call = 1; call <= 3; call += 1) {
      const answer = ok(await authenticateKey(deps, { token, scope: "read:key", origin: null }), `call ${call}`);
      const minute = answer.principal.quota.find((row) => row.window === "minute");
      assert.equal(minute.used, call);
      assert.equal(minute.left, 3 - call);
    }
    const spent = await authenticateKey(deps, { token, scope: "read:key", origin: null });
    assert.equal(spent.ok, false);
    assert.equal(spent.code, "QUOTA_EXCEEDED");
    assert.match(spent.message, /minute/);
    assert.equal(spent.quota.find((row) => row.window === "minute").left, 0);

    /* The next minute is its own window: nothing is swept, the name simply changes. */
    tick(60_000);
    const next = ok(await authenticateKey(deps, { token, scope: "read:key", origin: null }), "the next minute");
    assert.equal(next.principal.quota.find((row) => row.window === "minute").used, 1);
    assert.equal(next.principal.quota.find((row) => row.window === "day").used, 5, "the day counts every call, refused ones included");
    tick(-60_000);
  });

  test(`${label}: a window this deployment states no number for is counted and never refused`, async () => {
    const deps = await fresh();
    const { secret } = await seed(deps);
    for (let call = 0; call < 5; call += 1) ok(await authenticateKey(deps, { token: secret.issued.secret, scope: "read:key", origin: null }), "unlimited");
    const answer = ok(await authenticateKey(deps, { token: secret.issued.secret, scope: "read:key", origin: null }), "still served");
    for (const row of answer.principal.quota) {
      assert.equal(row.limit, null, `${row.window}: no number is stated here`);
      assert.equal(row.left, null, "what is left of a number nobody set is not zero");
      assert.ok(row.used > 0, "and the calls are counted all the same");
    }
  });

  test(`${label}: an action a role's row denies is refused by the server, not hidden`, async () => {
    const deps = await fresh();
    const { projectId, secret } = await seed(deps);

    /* ANALYST: view ALLOW, draft DENY, submit DENY, receipts ALLOW — straight from the matrix. */
    ok(await readProject(deps, { id: projectId, wallet: ANALYST }), "an analyst views");
    ok(await readDeliveries(deps, { projectId, wallet: ANALYST }), "and reads receipts");
    const issued = await issueKey(deps, { projectId, wallet: ANALYST, environment: "live", kind: "SECRET", name: "mine", scopes: ["read:key"] });
    assert.equal(issued.ok, false);
    assert.equal(issued.code, "FORBIDDEN", "issuing needs submit, which an analyst's row denies");
    assert.equal(issued.refusal, "ROLE_DENIES");
    assert.equal((await revokeKey(deps, { projectId, wallet: ANALYST, keyId: secret.issued.key.id })).code, "FORBIDDEN");
    assert.equal((await createEndpoint(deps, { projectId, wallet: ANALYST, environment: "live", url: "https://a.example.com/h", events: ["ping"] })).code, "FORBIDDEN");
    assert.equal((await createProject(deps, { teamId: TEAM, wallet: ANALYST, name: "no" })).code, "FORBIDDEN");

    /* A DEVELOPER's row allows every console action, and the project says so before anything is tried. */
    const asDeveloper = ok(await readProject(deps, { id: projectId, wallet: DEVELOPER }), "developer reads");
    for (const action of Object.keys(DEV_ACTION_PERMISSION)) assert.equal(asDeveloper.project.you.may[action], true, action);
    const asAnalyst = ok(await readProject(deps, { id: projectId, wallet: ANALYST }), "analyst reads");
    assert.equal(asAnalyst.project.you.may.issueKey, false);
    assert.equal(asAnalyst.project.you.may.readProject, true);
    ok(await issueKey(deps, { projectId, wallet: DEVELOPER, environment: "test", kind: "SECRET", name: "dev", scopes: ["read:key"] }), "a developer issues");
  });

  test(`${label}: an endpoint is made off, and a delivery is signed and logged`, async () => {
    const got = receiver([200]);
    const deps = await fresh({ send: got.send });
    const { projectId, endpoint } = await seed(deps);
    assert.equal(endpoint.endpoint.enabled, false, "nothing is delivered to an address until somebody turns it on");
    assert.match(endpoint.secret, /^whsec_/);
    assert.equal(endpoint.shownOnce, true);

    const off = await sendTestDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id });
    assert.equal(off.code, "INVALID");

    ok(await changeEndpoint(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, enabled: true }), "turn it on");
    const sent = ok(await sendTestDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id }), "send");
    assert.equal(sent.delivery.state, "DELIVERED");
    assert.equal(sent.delivery.attempts, 1);
    assert.equal(got.got.length, 1);
    assert.equal(got.got[0].url, "https://hooks.example.com/ryntra");
    assert.match(got.got[0].headers["Ryntra-Webhook-Signature"], /^v1,/);
    assert.match(got.got[0].headers["Ryntra-Webhook-Id"], /^[0-9a-f]{32}$/);

    const log = ok(await readDeliveries(deps, { projectId, wallet: OWNER }), "the log");
    assert.equal(log.deliveries.length, 1);
    assert.equal(log.deliveries[0].id, sent.delivery.id);
    /* And the endpoint's signing secret is not in any read of the project. */
    const project = ok(await readProject(deps, { id: projectId, wallet: OWNER }), "project");
    assert.equal(JSON.stringify(project).includes(endpoint.secret), false);
  });

  test(`${label}: a replayed delivery is refused although its signature is right`, async () => {
    const got = receiver([200]);
    const deps = await fresh({ send: got.send });
    const { projectId, endpoint } = await seed(deps);
    ok(await changeEndpoint(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, enabled: true }), "on");
    ok(await sendTestDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id }), "send");
    const delivered = got.got[0];
    const verify = (over = {}) => verifyDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, body: delivered.body, headers: delivered.headers, ...over });

    const first = ok(await verify(), "first");
    assert.equal(first.verified, true);
    assert.equal(first.deliveryId, delivered.headers["Ryntra-Webhook-Id"]);

    const second = ok(await verify(), "the same bytes again");
    assert.equal(second.verified, false);
    assert.equal(second.refusal, "REPLAYED", "the signature is still right; the delivery id has been seen");

    /* The other two grounds, for completeness: tampered bytes and a delivery outside the window. */
    const tampered = ok(await verify({ body: `${delivered.body} ` }), "tampered");
    assert.equal(tampered.refusal, "SIGNATURE_INVALID");
    tick(DEV_LIMITS.webhookWindowSeconds * 1000 + 2_000);
    const stale = ok(await verify({ headers: { ...delivered.headers, "Ryntra-Webhook-Id": "f".repeat(32) } }), "stale");
    /* A different id with the old signature fails on the signature first — the payload names the id. */
    assert.equal(stale.refusal, "SIGNATURE_INVALID");
    const old = ok(await verify(), "the original, now too old");
    assert.equal(old.refusal, "TIMESTAMP_OUTSIDE_WINDOW");
    tick(-(DEV_LIMITS.webhookWindowSeconds * 1000 + 2_000));
  });

  test(`${label}: a rotated endpoint secret keeps the old one verifying for one window`, async () => {
    const got = receiver([200, 200]);
    const deps = await fresh({ send: got.send });
    const { projectId, endpoint } = await seed(deps);
    ok(await changeEndpoint(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, enabled: true }), "on");
    ok(await sendTestDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id }), "send on the old secret");
    const beforeRotation = got.got[0];

    const rotated = ok(await changeEndpoint(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, rotateSecret: true }), "rotate");
    assert.ok(rotated.secret && rotated.secret !== endpoint.secret);
    const still = ok(await verifyDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, body: beforeRotation.body, headers: beforeRotation.headers }), "verified by the previous secret");
    assert.equal(still.verified, true);

    ok(await sendTestDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id }), "send again");
    assert.equal(got.got[1].headers["Ryntra-Webhook-Signature"].split(" ").length, 2, "both secrets sign while the window is open");
  });

  test(`${label}: a receiver that refuses is recorded as failed, and a server error is retried`, async () => {
    const refusing = receiver([404]);
    const deps = await fresh({ send: refusing.send });
    const { projectId, endpoint } = await seed(deps);
    ok(await changeEndpoint(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id, enabled: true }), "on");
    const refused = ok(await sendTestDelivery(deps, { projectId, wallet: OWNER, endpointId: endpoint.endpoint.id }), "send");
    assert.equal(refused.delivery.state, "FAILED");
    assert.equal(refused.delivery.status, 404);
    assert.equal(refusing.got.length, 1, "a refusal the receiver meant is not asked again");

    const broken = receiver([500]);
    const second = await fresh({ send: broken.send });
    const other = await seed(second);
    ok(await changeEndpoint(second, { projectId: other.projectId, wallet: OWNER, endpointId: other.endpoint.endpoint.id, enabled: true }), "on");
    const tried = ok(await sendTestDelivery(second, { projectId: other.projectId, wallet: OWNER, endpointId: other.endpoint.endpoint.id }), "send");
    assert.equal(tried.delivery.state, "FAILED");
    assert.equal(broken.got.length, DEV_LIMITS.deliveryAttempts);
  });

  test(`${label}: the bounds hold — projects a team keeps, live keys of one kind, endpoints`, async () => {
    const deps = await fresh();
    const made = [];
    for (let n = 0; n < DEV_LIMITS.projectsPerTeam; n += 1) made.push(ok(await createProject(deps, { teamId: TEAM, wallet: OWNER, name: `П${n}` }), `project ${n}`).project);
    assert.equal((await createProject(deps, { teamId: TEAM, wallet: OWNER, name: "over" })).code, "LIMIT");

    const projectId = made[0].id;
    const keys = [];
    for (let n = 0; n < DEV_LIMITS.keysPerEnvironment; n += 1) keys.push(ok(await issueKey(deps, { projectId, wallet: OWNER, environment: "live", kind: "SECRET", name: `k${n}`, scopes: ["read:key"] }), `key ${n}`));
    assert.equal((await issueKey(deps, { projectId, wallet: OWNER, environment: "live", kind: "SECRET", name: "over", scopes: ["read:key"] })).code, "LIMIT");
    /* A revoked key holds no place, and the other environment has its own. */
    ok(await revokeKey(deps, { projectId, wallet: OWNER, keyId: keys[0].issued.key.id }), "revoke one");
    ok(await issueKey(deps, { projectId, wallet: OWNER, environment: "live", kind: "SECRET", name: "replacement", scopes: ["read:key"] }), "its place is free");
    ok(await issueKey(deps, { projectId, wallet: OWNER, environment: "test", kind: "SECRET", name: "test", scopes: ["read:key"] }), "test is its own count");

    for (let n = 0; n < DEV_LIMITS.endpointsPerProject; n += 1) ok(await createEndpoint(deps, { projectId, wallet: OWNER, environment: "live", url: `https://hooks.example.com/${n}`, events: ["ping"] }), `endpoint ${n}`);
    assert.equal((await createEndpoint(deps, { projectId, wallet: OWNER, environment: "live", url: "https://hooks.example.com/over", events: ["ping"] })).code, "LIMIT");
  });

  test(`${label}: an endpoint address that could reach inside the network is refused`, async () => {
    const deps = await fresh();
    const project = ok(await createProject(deps, { teamId: TEAM, wallet: OWNER, name: "Адреси" }), "project").project;
    for (const url of ["http://hooks.example.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://10.0.0.5/h", "https://metadata.internal/h", "https://box/h", "ftp://hooks.example.com/h"]) {
      const answer = await createEndpoint(deps, { projectId: project.id, wallet: OWNER, environment: "live", url, events: ["ping"] });
      assert.equal(answer.code, "INVALID", url);
    }
    ok(await createEndpoint(deps, { projectId: project.id, wallet: OWNER, environment: "live", url: "https://hooks.example.com/h?x=1", events: ["ping"] }), "a public https address is fine");
  });
}
