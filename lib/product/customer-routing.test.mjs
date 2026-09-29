import assert from "node:assert/strict";
import test from "node:test";
import { CUSTOMER_REDIRECTS, LAB_RECORD_SOURCE, customerHref } from "./customer-routing.ts";

/** The row the router would answer a path with — the way Next reads the table: the first one for its source. */
function answer(path) {
  return CUSTOMER_REDIRECTS.find((row) => row.source === path) ?? null;
}

test("legacy entries arrive directly at their customer screen without a redirect cycle", () => {
  /* One answer per source, and no condition on any row: since canon v5.3
     (В28) nothing here reads who is looking. */
  assert.equal(new Set(CUSTOMER_REDIRECTS.map((row) => row.source)).size, CUSTOMER_REDIRECTS.length);
  for (const row of CUSTOMER_REDIRECTS) assert.equal("has" in row, false, `${row.source} answers by a condition`);
  /* A redirect lands where no second redirect waits. */
  for (const row of CUSTOMER_REDIRECTS) {
    const first = answer(row.source);
    assert.equal(answer(first.destination.split(/[?#]/)[0]), null, `${row.source} introduces an extra redirect`);
    assert.notEqual(first.source, first.destination);
  }
  /* The old overview addresses still land on Portfolio. */
  assert.equal(customerHref("/product"), "/app/portfolio");
  assert.equal(customerHref("/agents/workspace/passport"), "/app/agents/inspect");
  /* The product root is Home since canon v5.0 §3 — the first of the five
     places, for every person and every guest. */
  assert.equal(customerHref("/app"), "/app/home");
  assert.equal(answer("/app").destination, "/app/home");
  /* `/app/bridge` is a page again since the Owner's split of 2026-09-10, so it
     resolves to itself. The alias it used to carry is gone rather than
     repointed — which is the correct end for a temporary redirect whose
     destination stopped being the right answer. */
  assert.equal(customerHref("/app/bridge"), "/app/bridge");
  assert.equal(customerHref("/app/agents"), "/app/strategies");
  assert.equal(customerHref("/app/alerts"), "/app/alerts");
  /* Markets is a page again, for everyone. */
  assert.equal(customerHref("/app/markets"), "/app/markets");
  /* `/app/plans` is deliberately absent from the table: it *serves* My
     strategies rather than redirecting to it, because the old alias ran the
     other way as a permanent 308 and redirecting back would loop every browser
     that had cached it. */
  assert.equal(customerHref("/app/plans"), "/app/plans");
  assert.equal(customerHref("/app/journal"), "/app/results");
  /* Since canon v5.0 (RYN-SURFACE-CLEAN-001) Ideas is not a place: it and
     the two names it had taken over lead to the assistant, each directly. */
  assert.equal(customerHref("/app/research"), "/app/ryn");
  assert.equal(customerHref("/app/adviser"), "/app/ryn");
  assert.equal(customerHref("/app/ideas"), "/app/ryn");
});

test("a row this wave repointed is temporary, because a 308 cannot be recalled", () => {
  /* Three of them point at pages that are `In the plan` today. A cached
     permanent redirect would keep sending people there after the real page
     arrives, which is the trap `/app/markets` was already written to avoid. */
  const permanence = new Map(CUSTOMER_REDIRECTS.map((row) => [row.source, row.permanent]));
  for (const source of ["/app", "/app/agents", "/app/journal", "/app/research", "/app/ideas", "/app/perps", "/app/strategy-lab", LAB_RECORD_SOURCE]) {
    assert.equal(permanence.get(source), false, `${source} was repointed with a permanent redirect`);
  }
  /* `/app/markets` never took a permanent row, and since canon v5.3 it takes none at all: it is a page for everyone. */
  assert.equal(permanence.has("/app/markets"), false);
  /* And a row that has always meant the same thing keeps its 308. */
  assert.equal(permanence.get("/solana/workspace/swap"), true);
  assert.equal(permanence.get("/app/holdings"), true);
});

test("the recovery tools stay served even though their menu entry is gone", () => {
  /* Canon 10.3 moves the work rather than deleting it: the Agents entry was a
     place, the inspection and verification tools are work. Redirecting them
     would delete a route somebody may be mid-way through. */
  const sources = new Set(CUSTOMER_REDIRECTS.map((row) => row.source));
  for (const kept of ["/app/agents/inspect", "/app/agents/verify", "/app/strategies", "/app/plans", "/app/alerts", "/app/swap", "/app/portfolio", "/app/ryn", "/app/spot"]) {
    assert.ok(!sources.has(kept), `${kept} is redirected away, so its work has nowhere to happen`);
  }
});

test("asset, operation and return parameters survive legacy navigation", () => {
  assert.equal(customerHref("/solana/workspace/assets?mint=USDC&returnTo=%2Fapp%2Fportfolio#supply"), "/app/assets?mint=USDC&returnTo=%2Fapp%2Fportfolio#supply");
  assert.equal(customerHref("/solana/workspace/history?action=swap%3A123"), "/app/activity?action=swap%3A123");
  assert.equal(customerHref("/app/connect?returnTo=%2Fapp%2Fstrategies"), "/app/settings?returnTo=%2Fapp%2Fstrategies#account");
  assert.equal(customerHref("/assets/USDC?returnTo=%2Fapp%2Fportfolio#supply"), "/app/assets?returnTo=%2Fapp%2Fportfolio&mint=USDC#supply");
});

test("canonical, off-site and unrecognized links are preserved", () => {
  for (const href of ["/app/swap?in=SOL", "https://explorer.solana.com/tx/abc", "//example.com/path", "/api/solana/receipts/m2", "/unknown"]) assert.equal(customerHref(href), href);
});

test("what is not built leaves the surface, and every address a judge was given still opens directly", () => {
  /* Canon v5.0 §0.0 rule 10 (2026-09-23, RYN-SURFACE-CLEAN-001): Perps, Ideas
     and the Strategy Lab are not places a person lands; their code stays. */
  assert.equal(customerHref("/app/perps"), "/app/spot");
  assert.equal(customerHref("/app/strategy-lab"), "/app/strategies");
  assert.equal(customerHref("/solana/workspace/spot"), "/app/spot");
  assert.equal(customerHref("/solana/workspace/rewards"), "/app/rewards");
  const sources = new Set(CUSTOMER_REDIRECTS.map((row) => row.source));
  for (const direct of ["/app/stocks", "/app/spot", "/app/strategies", "/app/strategies/new", "/app/results", "/app/rewards", "/app/trends"]) {
    assert.ok(!sources.has(direct), `${direct} was given to a person and must open directly`);
    assert.equal(customerHref(direct), direct);
  }
  /* The prediction demo left the surface on the Owner's word (canon v5.4 В32,
     2026-09-24): its address and every one under it lead to Markets,
     temporarily, and its documentation to the cabinet page. */
  assert.equal(customerHref("/app/predictions"), "/app/markets");
  const rows = new Map(CUSTOMER_REDIRECTS.map((row) => [row.source, row]));
  for (const [source, destination] of [["/app/predictions", "/app/markets"], ["/app/predictions/:path*", "/app/markets"], ["/docs/trade/predictions", "/docs/start/cabinet"]]) {
    assert.equal(rows.get(source)?.destination, destination, `${source} must lead to ${destination}`);
    assert.equal(rows.get(source)?.permanent, false, `${source} stays revocable`);
  }
  /* A lab record is matched by the lab's UUID only: the plan builder and the
     plans can never be caught by it. The pattern is the one Next compiles. */
  const pattern = /^\/app\/strategies\/:id\((.+)\)$/.exec(LAB_RECORD_SOURCE);
  assert.ok(pattern, "the lab record row is not a single-segment UUID route");
  const uuid = new RegExp(`^${pattern[1]}$`);
  assert.ok(uuid.test("3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b"));
  for (const segment of ["new", "plans", "plan_1a2b3c4d", "NVDAx"]) assert.equal(uuid.test(segment), false, `${segment} would be sent away`);
  assert.equal(CUSTOMER_REDIRECTS.find((row) => row.source === LAB_RECORD_SOURCE).destination, "/app/strategies");
});

test("the parked ecosystems lead to the landing", () => {
  /* The Owner's word of 2026-09-23: Stellar's and Robinhood's workspaces are
     history, an old link lands on the front door in one hop — the app's Home
     while `/` led into the app (`RYN-SITE-NOW-001`), the landing again since
     the new site took `/` back (`RYN-SITE-V5-001`, the plan's address map).
     The other pages this deployment still serves assert beside themselves
     that no customer redirect sends them away. */
  const rows = new Map(CUSTOMER_REDIRECTS.map((row) => [row.source, row]));
  for (const source of ["/stellar", "/stellar/:path*", "/robinhood", "/robinhood/:path*"]) {
    assert.equal(rows.get(source)?.destination, "/", `${source} must lead to the landing`);
    assert.equal(rows.get(source)?.permanent, false, `${source} stays revocable`);
  }
});

test("one version: the five places and every former «Профі» address answer everyone the same (canon v5.3 В28)", () => {
  /* The root opens on Home for everyone; Home, Markets and «Поповнити» are
     served to everyone — a browser that once chose «Профі» is no longer led
     to Portfolio, Trends or Receive. */
  assert.equal(answer("/app").destination, "/app/home");
  for (const place of ["/app/home", "/app/markets", "/app/top-up", "/app/ryn", "/app/portfolio"]) {
    assert.equal(answer(place), null, `${place} is redirected`);
  }
  /* The addresses «Профі» used — and a judge was given — open directly. */
  for (const direct of ["/app/spot", "/app/swap", "/app/stocks", "/app/stocks/screener", "/app/trends", "/app/strategies", "/app/strategies/new", "/app/results", "/app/activity", "/app/send", "/app/receive", "/app/bridge", "/app/rewards", "/app/alerts", "/app/autoinvest"]) {
    assert.equal(answer(direct), null, `${direct} is redirected`);
    assert.equal(customerHref(direct), direct);
  }
});
