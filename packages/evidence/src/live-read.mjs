#!/usr/bin/env node
/**
 * A live read with your own key — the adapter, the mapper, the rights map
 * and a one-process governor, against the real provider.
 *
 *   NANSEN_API_KEY=<your key> node packages/evidence/src/live-read.mjs [mint] [24h|7d] [--ceiling 4] [--rule "dex_volume_usd gte 1000000"]
 *
 * Reads the observation for one Solana mint (BONK by default) over one
 * window — two governed calls, one credit each on the provider's published
 * prices — prints the normalized snapshot with its times and attribution,
 * judges an optional rule against it, and prints the governor's ledger. The
 * key is read from the environment and never printed; the ceiling defaults
 * to four credits, so a mistyped loop cannot spend more than that.
 */

import { createMemoryGovernor, createNansenAdapter, createNansenClient, evidenceMetric, judgeEvidenceCondition, nansenKeyFromEnv } from "./index.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const positional = args.filter((arg, index) => !arg.startsWith("--") && (index === 0 || !args[index - 1].startsWith("--")));
const mint = positional[0] ?? "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const window = positional[1] === "7d" ? "7d" : "24h";
const ceiling = Number(flag("--ceiling", "4"));
const ruleText = flag("--rule", null);

const key = nansenKeyFromEnv(process.env);
if (!key) {
  console.error("NANSEN_API_KEY is not set. Nothing was called.");
  process.exit(2);
}

const governor = createMemoryGovernor(ceiling);
const adapter = createNansenAdapter({ client: createNansenClient({ key }), governor });
const nowMs = Date.now();
const provided = await adapter.read({ mint, window, nowMs });
const read = provided.state === "FRESH" ? { state: "FRESH", snapshot: provided.snapshot, reason: null, served: "provider" } : { state: provided.state, snapshot: null, reason: provided.reason, served: "provider" };

console.log(`state: ${read.state}${read.reason ? ` — ${read.reason}` : ""}`);
if (read.snapshot) {
  const { snapshot } = read;
  console.log(`subject: ${snapshot.subject.symbol ?? "?"} · ${snapshot.subject.mint} · ${snapshot.window}`);
  console.log(`asked at ${snapshot.fetchedAt} · the source may be up to ${snapshot.providerLagSeconds} s behind · current until ${snapshot.expiresAt}`);
  for (const metric of snapshot.metrics) {
    const words = evidenceMetric(metric.id)?.words.en.label ?? metric.id;
    console.log(`  ${words}: ${metric.value === null ? `— (${metric.coverage}${metric.note ? `: ${metric.note}` : ""})` : `${metric.value} ${metric.unit}`}`);
  }
  if (snapshot.warnings.length > 0) console.log(`coverage notes: ${snapshot.warnings.join(" | ")}`);
  console.log(`${snapshot.attribution.text} — ${snapshot.attribution.href}`);
}

if (ruleText) {
  const [metric, operator, threshold] = ruleText.split(/\s+/);
  const condition = { metric, window, operator, threshold: Number(threshold), mode: "advisory", onUnknown: "warn" };
  const judged = judgeEvidenceCondition(condition, read, Date.now());
  console.log(`rule: ${judged.expected} → ${judged.outcome} (${judged.reason})${judged.actual ? ` · ${judged.actual}` : ""}`);
}

console.log(`governor: ${JSON.stringify(governor.state())}`);
