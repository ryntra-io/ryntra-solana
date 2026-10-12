import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  JUPITER_ORDER_REVIEW_WINDOW_MS,
  MINIMUM_HUMAN_REVIEW_WINDOW_MS,
} from "./quotes.ts";

/**
 * The window a person has to answer their wallet in.
 *
 * This file exists because the number was 15,000 and a manual test could not
 * complete a single swap: the Review expired while the wallet was still open.
 * Every assertion here is that failure, written down so it cannot come back as
 * a tuning decision someone makes without meeting it.
 */

test("the review window is long enough for a human to answer a wallet", () => {
  assert.ok(
    JUPITER_ORDER_REVIEW_WINDOW_MS >= MINIMUM_HUMAN_REVIEW_WINDOW_MS,
    `The review window is ${JUPITER_ORDER_REVIEW_WINDOW_MS}ms. A person must read the exact Review, open a wallet, read it again and approve — and nothing in the signing path is bounded, so this clock is the only one running.`,
  );
});

test("the review window still fits inside one blockhash", () => {
  /* A blockhash is valid for 151 blocks — roughly 60 to 90 seconds — and part
     of that is already spent by the time the provider answers. The window has
     to leave `/execute` room to land inside the same blockhash, so it stays
     strictly under the 60-second ceiling the order normalizer enforces. */
  assert.ok(
    JUPITER_ORDER_REVIEW_WINDOW_MS < 60_000,
    "The review window must stay under the 60s ceiling normalizeJupiterOrderShared enforces.",
  );
  const source = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /meta\.reviewWindowMs > 60_000/,
    "The normalizer no longer bounds the review window it is handed.",
  );
});

test("the signing path is unbounded, which is why the window carries the whole budget", () => {
  /* If a timeout is ever added around signTransaction, this assertion should
     be revisited deliberately rather than left as a stale claim in a comment
     above the constant. */
  const wallet = readFileSync(new URL("./wallet.client.ts", import.meta.url), "utf8");
  /* This counted call sites and expected exactly one, which was a proxy for the
     real rule rather than the rule itself. The rule is that the timeout bounds
     the CONNECT HANDSHAKE and nothing else — and a second handshake appeared
     legitimately when the silent restore landed, so the count broke while the
     property it stood for was untouched. Asserted directly now: every call site
     wraps a connect, and none wraps signing. */
  const callSites = [...wallet.matchAll(/withWalletPromptTimeout\((.*)/g)].map((match) => match[1]);
  assert.ok(callSites.length >= 1, "The connect handshake is no longer bounded by the prompt timeout.");
  for (const site of callSites) {
    assert.match(
      site,
      /^connect\.connect\(/,
      "The wallet prompt timeout is applied to something other than the connect handshake; re-read the review-window reasoning in quotes.ts.",
    );
  }
  /* Both handshakes are present and bounded: the one a person answers, and the
     silent restore that must never raise a prompt at all. */
  assert.match(wallet, /withWalletPromptTimeout\(connect\.connect\(\)\)/);
  assert.match(wallet, /withWalletPromptTimeout\(connect\.connect\(\{ silent: true \}\)\)/);
  assert.ok(
    !/withWalletPromptTimeout\([^)]*signTransaction/.test(wallet),
    "Signing is now bounded by a timeout; the review window no longer carries the whole budget alone.",
  );
});
