import assert from "node:assert/strict";
import test from "node:test";
import { CUSTOMER_REDIRECTS, LAB_RECORD_SOURCE, customerHref } from "./customer-routing.ts";

/** The row the router would answer a path with — the way Next reads the table: the first one for its source. */
function answer(path) {
  return CUSTOMER_REDIRECTS.find((row) => row.source === path) ?? null;
}

test("legacy entries arrive directly at their customer screen without a redirect cycle", () => {
  /* One answer per source, and no condition on any row: there is one version
     for everyone, so nothing here reads who is looking. */
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
  /* The product root is Home — the first of the five places, for every
     person and every guest. */
  assert.equal(customerHref("/app"), "/app/home");
  assert.equal(answer("/app").destination, "/app/home");
  /* `/app/bridge` is its own page again since 2026-09-10, so it resolves to
     itself. The alias it used to carry is gone rather than repointed — which
     is the correct end for a temporary redirect whose destination stopped
     being the right answer. */
  assert.equal(customerHref("/app/bridge"), "/app/bridge");
  assert.equal(customerHref("/app/agents"), "/app/bots");
  assert.equal(customerHref("/app/alerts"), "/app/alerts");
  /* Markets is a page again, for everyone. */
  assert.equal(customerHref("/app/markets"), "/app/markets");
  /* `/app/plans` leads to «Мої боти» since the menu v6.2: the old 308
     (`/app/strategies → /app/plans`) cached in browsers ends there, because
     `/app/bots` redirects nowhere — no loop. */
  assert.equal(customerHref("/app/plans"), "/app/bots");
  assert.equal(customerHref("/app/journal"), "/app/bots");
  /* Ideas is no longer a place: it and the two names it had taken over lead
     to the assistant, each directly. */
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
  /* `/app/markets` never took a permanent row, and now it takes none at all: it is a page for everyone. */
  assert.equal(permanence.has("/app/markets"), false);
  /* And a row that has always meant the same thing keeps its 308. */
  assert.equal(permanence.get("/solana/workspace/swap"), true);
  assert.equal(permanence.get("/app/holdings"), true);
});

test("the recovery tools stay served even though their menu entry is gone", () => {
  /* The work moves rather than being deleted: the Agents entry was a place,
     the inspection and verification tools are work. Redirecting them would
     delete a route somebody may be mid-way through. */
  const sources = new Set(CUSTOMER_REDIRECTS.map((row) => row.source));
  for (const kept of ["/app/agents/inspect", "/app/agents/verify", "/app/strategies/new", "/app/alerts", "/app/swap", "/app/portfolio", "/app/ryn", "/app/spot", "/app/bots"]) {
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
  /* Since 2026-09-23 only what is built is drawn: Perps, Ideas and the
     Strategy Lab are not places a person lands; their code stays. */
  assert.equal(customerHref("/app/perps"), "/app/spot");
  assert.equal(customerHref("/app/strategy-lab"), "/app/bots");
  assert.equal(customerHref("/solana/workspace/spot"), "/app/spot");
  assert.equal(customerHref("/solana/workspace/rewards"), "/app/rewards");
  const sources = new Set(CUSTOMER_REDIRECTS.map((row) => row.source));
  for (const direct of ["/app/spot", "/app/strategies/new", "/app/rewards", "/app/markets", "/app/bots"]) {
    assert.ok(!sources.has(direct), `${direct} was given to a person and must open directly`);
    assert.equal(customerHref(direct), direct);
  }
  /* The menu v6.2 moved the rest, and each address a person was given leads to its new place in one hop — never a 404. */
  for (const [given, place] of [["/app/stocks", "/app/markets?tab=stocks"], ["/app/stocks/screener", "/app/markets?tab=stocks"], ["/app/trends", "/app/markets"], ["/app/strategies", "/app/bots"], ["/app/results", "/app/bots"], ["/app/autoinvest", "/app/bots"]]) {
    assert.equal(customerHref(given), place, `${given} must lead to ${place}`);
  }
  /* The prediction demo left the surface on 2026-09-24: its address and
     every one under it lead to Markets, temporarily, and its documentation to
     the cabinet page. */
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
  assert.equal(CUSTOMER_REDIRECTS.find((row) => row.source === LAB_RECORD_SOURCE).destination, "/app/bots");
});

test("the parked ecosystems lead to the landing", () => {
  /* Since 2026-09-23 Stellar's and Robinhood's workspaces are history: an old
     link lands on the front door in one hop — the app's Home while `/` led
     into the app, the landing again since the new site took `/` back. The
     other pages this deployment still serves assert beside themselves that no
     customer redirect sends them away. */
  const rows = new Map(CUSTOMER_REDIRECTS.map((row) => [row.source, row]));
  for (const source of ["/stellar", "/stellar/:path*", "/robinhood", "/robinhood/:path*"]) {
    assert.equal(rows.get(source)?.destination, "/", `${source} must lead to the landing`);
    assert.equal(rows.get(source)?.permanent, false, `${source} stays revocable`);
  }
});

test("one version: the five places and every former «Профі» address answer everyone the same", () => {
  /* The root opens on Home for everyone; Home, Markets and «Поповнити» are
     served to everyone — a browser that once chose «Профі» is no longer led
     to Portfolio, Trends or Receive. */
  assert.equal(answer("/app").destination, "/app/home");
  for (const place of ["/app/home", "/app/markets", "/app/top-up", "/app/ryn", "/app/portfolio"]) {
    assert.equal(answer(place), null, `${place} is redirected`);
  }
  /* The addresses «Профі» used — and a judge was given — open directly, or, where the menu v6.2 moved them, lead to their new place for everyone alike. */
  for (const direct of ["/app/spot", "/app/swap", "/app/strategies/new", "/app/activity", "/app/send", "/app/receive", "/app/bridge", "/app/rewards", "/app/alerts"]) {
    assert.equal(answer(direct), null, `${direct} is redirected`);
    assert.equal(customerHref(direct), direct);
  }
  for (const moved of ["/app/stocks", "/app/stocks/screener", "/app/trends", "/app/strategies", "/app/results", "/app/autoinvest"]) {
    assert.equal(answer(moved)?.permanent, false, `${moved} moved with a permanent redirect`);
  }
});
