import assert from "node:assert/strict";
import test from "node:test";

import { DAS_MAX_HOLDERS, DAS_PAGE_LIMIT, TOKEN_HOLDERS_DAILY_CREDITS, TOKEN_HOLDERS_DAILY_ENV, holderAccountsOfDas, holdersDasEndpoint, readHolderAccountsWhole, resetHoldersDas } from "./token-holders-das.server.ts";

/*
 * Up to a hundred holders, but only from a whole list — every account of a small coin through Helius DAS
 * `getTokenAccounts` (shape: helius-sdk 3.5.0 `GetTokenAccountsResponse`), behind a closed switch; else null and
 * the node's twenty largest.
 */

const MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OWNER = "MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X";
const ACCOUNT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=0123abcd-4567-89ef-0123-456789abcdef";
const helius = { url: ENDPOINT, host: "mainnet.helius-rpc.com", fromEnv: true };

const page = (accounts, extra = {}) => ({ jsonrpc: "2.0", id: "holders-1", result: { total: accounts.length, limit: DAS_PAGE_LIMIT, page: 1, token_accounts: accounts, ...extra } });
const row = (amount, overrides = {}) => ({ address: ACCOUNT, mint: MINT, owner: OWNER, amount, delegated_amount: 0, frozen: false, ...overrides });

test("closed unless the deployment says das and the node is Helius's from the environment", () => {
  assert.equal(holdersDasEndpoint({}, [helius]), null);
  assert.equal(holdersDasEndpoint({ RYNTRA_SPOT_TOKEN_HOLDERS: "das" }, [helius]), ENDPOINT);
  assert.equal(holdersDasEndpoint({ RYNTRA_SPOT_TOKEN_HOLDERS: "das" }, [{ ...helius, fromEnv: false }]), null);
  assert.equal(holdersDasEndpoint({ RYNTRA_SPOT_TOKEN_HOLDERS: "das" }, [{ url: "https://solana-rpc.publicnode.com", host: "solana-rpc.publicnode.com", fromEnv: true }]), null);
});

test("a page's accounts in the holders' shape: exact amounts, empty and foreign accounts left out", () => {
  const read = holderAccountsOfDas(page([row(12_345), row(0), row(5, { mint: OWNER }), row(7, { owner: "nope" }), row(9_007_199_254_740_993n)]), MINT);
  assert.equal(read.count, 5);
  assert.deepEqual(read.accounts, [
    { account: ACCOUNT, owner: OWNER, amountRaw: "12345" },
    { account: ACCOUNT, owner: OWNER, amountRaw: "9007199254740993" },
  ]);
  assert.throws(() => holderAccountsOfDas({ result: {} }, MINT));
});

test("a small coin is read whole; a large one, an uncounted one or an unfinished list is not used", async () => {
  const bodies = [];
  const fetchPages = (pages) => async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(pages[bodies.length - 1]), { status: 200 });
  };
  const whole = await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch: fetchPages([page([row(10), row(20)])]) });
  assert.equal(whole.length, 2);
  assert.deepEqual(bodies[0], { jsonrpc: "2.0", id: "holders-1", method: "getTokenAccounts", params: { mint: MINT, page: 1, limit: DAS_PAGE_LIMIT } });
  assert.equal(await readHolderAccountsWhole(MINT, DAS_MAX_HOLDERS + 1, { endpoint: ENDPOINT, fetch: async () => assert.fail("not asked") }), null);
  assert.equal(await readHolderAccountsWhole(MINT, null, { endpoint: ENDPOINT, fetch: async () => assert.fail("not asked") }), null);
  assert.equal(await readHolderAccountsWhole(MINT, 2, { endpoint: null, fetch: async () => assert.fail("not asked") }), null);
  const full = Array.from({ length: DAS_PAGE_LIMIT }, () => row(1));
  bodies.length = 0;
  assert.equal(await readHolderAccountsWhole(MINT, 1_500, { endpoint: ENDPOINT, fetch: fetchPages([page(full), page(full)]) }), null, "two full pages: the list did not end");
  bodies.length = 0;
  assert.equal((await readHolderAccountsWhole(MINT, 1_500, { endpoint: ENDPOINT, fetch: fetchPages([page(full), page([row(3)])]) })).length, DAS_PAGE_LIMIT + 1);
  assert.equal(await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch: async () => new Response("{}", { status: 429 }) }), null);
  assert.equal(await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch: async () => { throw new Error(`down ${ENDPOINT}`); } }), null);
});

test("a day's ceiling of credits per instance: past it the whole read is not asked — the node's twenty largest answer — until the next UTC day", async () => {
  resetHoldersDas();
  assert.equal(TOKEN_HOLDERS_DAILY_ENV, "RYNTRA_SPOT_TOKEN_HOLDERS_DAILY_CREDITS");
  assert.equal(TOKEN_HOLDERS_DAILY_CREDITS, 10_000);
  const noon = Date.parse("2026-11-20T12:00:00.000Z");
  /* Twenty-five credits: a whole read may take two pages of ten, so one read fits and a second does not. */
  const env = { [TOKEN_HOLDERS_DAILY_ENV]: "25" };
  let asked = 0;
  const fetch = async () => {
    asked += 1;
    return new Response(JSON.stringify(page([row(10)])), { status: 200 });
  };
  assert.equal((await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch, env, now: () => noon })).length, 1);
  assert.equal(await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch, env, now: () => noon + 1 }), null, "ten spent, and a whole read's twenty more would pass the ceiling");
  assert.equal((await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch, env: { [TOKEN_HOLDERS_DAILY_ENV]: "30" }, now: () => noon + 2 })).length, 1, "a raised ceiling is read at once");
  assert.equal(await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch, env, now: () => Date.parse("2026-11-20T23:59:59.000Z") }), null);
  assert.equal(asked, 2);
  assert.equal((await readHolderAccountsWhole(MINT, 2, { endpoint: ENDPOINT, fetch, env, now: () => Date.parse("2026-11-21T00:00:00.000Z") })).length, 1, "midnight UTC: a new day");
  resetHoldersDas();
});
