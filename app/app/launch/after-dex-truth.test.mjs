// SOL-L1a «Після виходу на DEX — та сама правда» (audit SOL-L0, findings З1, З4, З9, З10, З14, З15): what a token's page
// says after the DEX and after any burn is what the chain says, each figure by one definition, and a read that failed is
// said as not read — never «0», never as the rules refusing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LAUNCH_WORDS } from "./launch-words.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const PAGE = read("app/app/launch/[mint]/page.tsx");
const TOKEN = read("app/app/launch/[mint]/token-market.tsx");
const HEALTH = read("app/app/launch/[mint]/market-health.tsx");
const POOL = read("app/app/launch/[mint]/pool-panel.tsx");
const MINE = read("app/app/launch/mine/creator-cabinet.tsx");

const both = (key) => [LAUNCH_WORDS[key].en, LAUNCH_WORDS[key].uk];

test("«not read» and «the rules refused» are two states with two sentences (З1, З15)", () => {
  assert.match(PAGE, /receiptRefusedByRules\(token\.receiptProblems\) \? "marksRefused" : "marksUnread"/);
  const [refusedEn, refusedUk] = both("marksRefused");
  const [unreadEn, unreadUk] = both("marksUnread");
  assert.notEqual(refusedEn, unreadEn);
  assert.notEqual(refusedUk, unreadUk);
  assert.match(unreadUk, /не прочитано/);
  assert.doesNotMatch(refusedUk, /не прочитано/, "a refusal is a fact of the chain, not a read that failed");
  /* A lock not read is said, never a mark that silently goes ($WICK, 18.10). */
  assert.match(PAGE, /lockUnread \? <p className=\{styles\.unread\}>\{word\("marksLockUnread"\)\}/);
  assert.match(PAGE, /word\("marksImmutableOnly"\)/, "a receipt that stands in from the last good read says it shows only what cannot change");
  assert.match(PAGE, /word\("marksExitUnread"\)/, "an exit not read is said as such, its marks not dropped silently");
  /* A lock not read settles nothing in the store (it would otherwise become LOCKED for good). */
  const view = read("lib/launch/view.server.ts");
  assert.match(view, /if \(lock === "UNREAD"\) problems\.push\(RECEIPT_LOCK_UNREAD\);\n\s*else record = await settleLaunchLock\(deps, record, lock !== null\);/);
  assert.match(read("lib/launch/health.server.ts"), /rulesComplete:\s*receiptRefusedByRules\(view\?\.receiptProblems \?\? \[\]\) \|\|\s*\(receipt !== null && !\(view\?\.receiptProblems \?\? \[\]\)\.some\(\(problem\) => problem === RECEIPT_EXIT_UNREAD \|\| problem === RECEIPT_LOCK_UNREAD\)/, "Market Health says its rules are incomplete when the exit or the lock was not read");
});

test("«LP замкнено назавжди» names the creator's share also when «Спільнота» holds it in a vault", () => {
  assert.match(PAGE, /creatorRoles = new Set\(\[receipt\.creator, \.\.\.\(receipt\.feeSharing \? \[receipt\.feeSharing\.vault\] : \[\]\)\]\)/);
  assert.match(PAGE, /creatorRoles\.has\(owner\) \? "mark_LP_LOCKED_FOREVER_creator" : partners\.has\(owner\) \? "mark_LP_LOCKED_FOREVER_partner" : "mark_LP_LOCKED_FOREVER"/, "an exit NFT held by anyone else is never called Ryntra's");
});

test("the Market Engine's first sentence says a budget and a ladder only where Ryntra keeps one; on people's markets it watches and sends the move (З4)", () => {
  assert.match(HEALTH, /\{word\(engineLedeKey\(health\)\)\}/);
  assert.match(HEALTH, /if \(health\.budget\.ladder !== "NONE" \|\| health\.budget\.state === "COUNTED"\) return "engineLede";/);
  assert.match(HEALTH, /if \(health\.venue === "pool"\) \{[\s\S]*?if \(!health\.engine\.acts\) return health\.engine\.actsUnread \? "engineLedeDexUnread" : "engineLedeDexIdle";\n\s*if \(health\.budget\.state === "IN_POOL"\) return health\.budget\.claims \? "engineLedeDexClaims" : "engineLedeDexWaiting";\n\s*return "engineLedeDex";/);
  assert.match(both("engineLedeDexUnread")[1], /не прочитано/);
  assert.match(HEALTH, /if \(!health\.engine\.acts\) return health\.engine\.actsUnread \? "engineLedeUnread" : "engineLedeIdle";\n\s*if \(health\.budget\.state === "IN_POOL"\) return health\.budget\.claims \? "engineLedeClaims" : "engineLedeWaiting";\n\s*return "engineLedeWatch";/, "the move is Ryntra's to send only while its executor acts");
  /* SOL-L6: a budget the executor claims but has not yet — a person's Micro market while people's markets are open — is said as claimed, with its ladder (in people's words since B17: buy orders under the price). */
  for (const key of ["engineLedeClaims", "engineLedeDexClaims"]) {
    const [en, uk] = both(key);
    assert.match(uk, /виконавець Ryntra забирає бюджет ринку на заявки на купівлю нижче ціни/);
    assert.match(en, /executor claims the market's budget for buy orders under the price/);
  }
  assert.match(both("engineLedeClaims")[1], /стежить за цим ринком і надсилає вихід на DEX/);
  assert.match(both("engineLedeDexClaims")[1], /стежить за цим ринком; вихід на DEX уже відбувся/);
  assert.match(both("engineLedeIdle")[1], /не ходить.*може надіслати будь-хто/);
  assert.match(both("engineLedeUnread")[1], /не прочитано.*може надіслати будь-хто/);
  for (const key of ["engineLedeWatch", "engineLedeWaiting"]) {
    const [en, uk] = both(key);
    assert.match(uk, /стежить за цим ринком і надсилає вихід на DEX/);
    assert.match(en, /watches this market and sends its move to the DEX/);
  }
  for (const key of ["engineLedeDex", "engineLedeDexWaiting"]) assert.match(both(key)[1], /стежить за цим ринком; вихід на DEX уже відбувся/, "after the DEX the move is said as done");
  for (const key of ["engineLedeWatch", "engineLedeWaiting", "engineLedeDex", "engineLedeDexWaiting"]) {
    assert.doesNotMatch(both(key).join(" "), /ladder|драбин|buy orders|заявк/, "no ladder where there is none");
  }
});

test("the move to the DEX: the executor sends it once the curve reaches its threshold, and anyone may (З9)", () => {
  const [en, uk] = both("rule_GRADUATION_BY_RYNTRA");
  assert.equal(uk, "Вихід на DEX надсилає виконавець Ryntra, щойно крива набере поріг; надіслати може будь-хто");
  assert.match(en, /as soon as the curve reaches its threshold; anyone may send it/);
  for (const words of Object.values(LAUNCH_WORDS)) assert.doesNotMatch(`${words.en} ${words.uk}`, /If no one sends|не надішле ніхто/);
});

test("the collector's state is its passes' freshness, not the permission alone (З10)", () => {
  assert.match(TOKEN, /collectorRuns=\{collectorRunsOf\(healthNow\)\}/, "the token page hands the executor's passes to the pool panel");
  assert.match(TOKEN, /if \(health\.engine\.pause\?\.code === "OPERATOR"\) return false;/, "a market the operator stopped has no collector");
  assert.match(TOKEN, /if \(health\.engine\.actsUnread\) return null;\n\s*return health\.engine\.acts;/, "whether the executor acts, not read, is never «the collector does not go» (1.47.0)");
  assert.match(POOL, /collectorRuns === true \? "GRANTED" : collectorRuns === false \? "GRANTED_IDLE" : "GRANTED_UNREAD"/, "«Збирач увімкнено» only when the passes are fresh");
  assert.match(POOL, /runs === false \? <p className=\{styles\.collectorIdle\}>\{word\("collectorIdle"\)\}/);
  assert.match(POOL, /position\.nextCollection && collectorRuns === true/, "no queue promised unless the collector is known to go");
  assert.match(both("grantChip_GRANTED_IDLE")[1], /збирач не ходить/);
});

test("the ten largest and the holders on the page are «Здоров'я ринку»'s — the open API's — and no other definition (З14)", () => {
  assert.match(TOKEN, /const HEALTH_DEFINED: ReadonlySet<LaunchRiskFactView\["code"\]> = new Set\(\["TOP10_HOLD", "FEW_HOLDERS", "HOLDERS_UNCOUNTED"\]\)/);
  assert.doesNotMatch(TOKEN, /market\.holders\.count/, "no holder count of the market's own definition is drawn");
  assert.doesNotMatch(TOKEN, /groups\.top10Bps/, "no top 10 over the supply is drawn");
  assert.doesNotMatch(TOKEN, /market\.risk\.filter\(\(fact\) => fact\.level === "attention"\)/, "the risk tab's count leaves the market's own holder facts out");
  assert.match(TOKEN, /<Stat label=\{word\("hHolders"\)\} value=\{<HoldersFigure/);
  assert.doesNotMatch(HEALTH, /top10Listed/, "the concentration is always «Здоров'я ринку»'s own tile");
  assert.match(HEALTH, /health\.holders\.count < FEW_HOLDERS \? <p className=\{styles\.healthMark\}>\{word\("hFewHolders"/);
});

test("«Мої лаунчі» never says «На DEX 0» for launches it did not read (З1)", () => {
  assert.match(MINE, /if \(card\.unread === 0\) return String\(card\.graduated\);/);
  assert.match(MINE, /return card\.graduated > 0 \? `\$\{card\.graduated\}\+` : word\("mineOnDexUnread"\);/);
});

test("the launch's reads after the DEX ask no node for an indexed request it refuses", () => {
  const paths = [
    "lib/launch/view.server.ts",
    "lib/core/venues/meteora-dbc/launch.server.ts",
    "lib/core/venues/meteora-dbc/creator-lock.server.ts",
    "lib/core/venues/meteora-dbc/exit-positions.server.ts",
  ];
  for (const path of paths) {
    /* The creator's claim keeps its build as on master while SOL-L1d's claims are closed: a transaction to
       sign, not a read of the page. */
    const code = read(path)
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
      .replace("const indexed = (await cpAmm.getUserPositionByPool(dammPool, signer))[0];", "");
    assert.doesNotMatch(code, /getUserPositionByPool\(|getPositionsByUser\(|getTokenAccountBalance\(|getTokenAccountsByOwner\(/, path);
  }
  /* «Мої лаунчі» name their readers; the executor's pass names none and reads as it always has — MarketOS unchanged. */
  const claim = read("lib/core/venues/meteora-dbc/claim.server.ts");
  assert.equal(claim.match(/getUserPositionByPool\(/g)?.length, 1);
  assert.match(claim, /if \(options\.readers\) \{[\s\S]*readExitPositions\([\s\S]*\} else \{[\s\S]*getUserPositionByPool\(dammPool, state\.creator\)/);
  assert.match(read("lib/launch/creator.server.ts"), /readCreatorFees\(deps\.connection, \{ token: record\.token, pool: record\.pool \}, \{ readers: \[deps\.second \?\? null, launchHistoryConnection\(deps\.network\)\], exitSignature \}\)/);
  assert.doesNotMatch(read("lib/core/venues/meteora-dbc/launch.server.ts"), /getTokenMetadata\(/, "the metadata comes from the mint's bytes already read");
  const market = read("lib/core/venues/meteora-dbc/market.server.ts");
  assert.match(market, /const REFUSAL_PAUSE_MS = 60 \* 1000;/, "one refusal silences a node for a minute, not five");
  const health = read("lib/launch/health.server.ts");
  assert.match(health, /const holdersRead = \(holders: HoldersRead\) => !holders\.atLeast \|\| holders\.top10Bps !== null;/);
  assert.match(market, /return fromAny\(`holders:\$\{mint\.toBase58\(\)\}`/, "one mint's refused scan pauses that mint, not every market");
});

test("whether the executor acts, not read, is said as not read: the server marks it, the contract carries it (1.47.0)", () => {
  const health = read("lib/launch/health.server.ts");
  assert.match(health, /: \{ acts: false, ladder: false, unread: true \};/, "no recent read stands in: not read, not «does not act»");
  assert.match(health, /const actsUnread = Boolean\(read\.runs\.unread \|\| read\.executorFacts\.unread\);/);
  assert.match(health, /\.\.\.\(actsUnread \? \{ actsUnread: true \} : \{\}\)/);
  assert.match(health, /&& !\(actsUnread && ladder\.state !== "NONE"\)\),/, "the ladder's policy unread leaves the rules incomplete");
  assert.match(read("lib/api/v1/contract.ts"), /actsUnread: z\.boolean\(\)\.optional\(\)/);
});

test("SOL-L1d open: «Забрати» after the DEX takes the locked LP's fee from the creator role's exit position", () => {
  const venue = read("lib/core/venues/meteora-dbc/launch.server.ts");
  assert.match(venue, /let found = options\.position \?\? null;/, "the caller's exit position first");
  assert.match(venue, /const exit = await readExitPositions\(\{ connection, curve: pool\.publicKey\.toBase58\(\), pool: dammPool\.toBase58\(\)/, "with fromExit, the exit read from the move itself");
  const claim = read("lib/core/venues/meteora-dbc/claim.server.ts");
  assert.match(claim, /venue\.claimFeeInstructions\("creator", observation\.token, source, source === "lp" && exit \? \{ position: \{ position: exit\.position, positionNftAccount: exit\.positionNftAccount \} \} : \{\}\)/);
  assert.match(claim, /lp: taken\.includes\("lp"\) \? exit : null,/, "shared: the vault's funding from the same exit position");
  /* Open, the build reads what the page reads: the exit, through the node with older transactions. */
  assert.match(read("lib/launch/creator.server.ts"), /const built = launchClaimsV2Open\(deps\.network\)\n\s*\? await buildCreatorClaim\(deps\.connection, \{ observation: await creatorFeesOf\(deps, record\),/);
});

test("SOL-L1d closed: the creator's claim is built as before — what a wallet signs does not change", () => {
  const venue = read("lib/core/venues/meteora-dbc/launch.server.ts");
  /* No position named and no fromExit — every caller before SOL-L1d —: the node's index, as it always was. */
  assert.match(venue, /if \(!found && !options\.fromExit\) \{\n[^\n]*\n\s*const indexed = \(await cpAmm\.getUserPositionByPool\(dammPool, signer\)\)\[0\];/);
  assert.match(venue, /if \(!indexed\) throw new LaunchRefusal\("NO_POSITION", `No position of \$\{signer\.toBase58\(\)\} in the graduated pool\.`\);/);
  const claim = read("lib/core/venues/meteora-dbc/claim.server.ts");
  const before = claim.slice(claim.indexOf("export async function buildCreatorClaimBefore"), claim.indexOf("export function withoutSurplusRead"));
  assert.match(before, /const observation = withoutSurplusRead\(args\.observation\);/, "the surplus is not counted");
  assert.match(before, /const sources = \(\["curve", "graduation", "lp"\] as const\)\.filter\(holding\);/, "never the surplus");
  assert.match(before, /await venue\.claimFeeInstructions\("creator", observation\.token, source\) \}\);/, "the LP's position from the node's index");
  assert.doesNotMatch(before, /surplus:|simulated\(/, "no surplus funding, no simulation dropping a source");
  assert.equal((before.match(/BigInt\(earnings\.mine\.unclaimedRaw\)\)/g) ?? []).length, 2, "what the wallet is paid is its whole unclaimed part, as before");
  const server = read("lib/launch/creator.server.ts");
  assert.match(server, /: await buildCreatorClaimBefore\(deps\.connection, \{ observation: await readCreatorFees\(deps\.connection, \{ token: record\.token, pool: record\.pool \}\), wallet,/, "the read it always was");
  assert.match(server, /return launchClaimsV2Open\(deps\.network\) \? observation : withoutSurplusRead\(observation\);/, "the cabinet counts no surplus «Забрати» does not take");
  /* The treasury offers and runs no launch claims while closed. */
  const treasury = read("lib/solana/treasury/service.server.ts");
  assert.match(treasury, /return launch && launch\.network\.cluster === deps\.network && launchClaimsV2Open\(launch\.network\) \? launch : null;/);
  assert.match(treasury, /proposal\.type === "claims" && proposal\.readable && launchClaimDeps\(deps\)\) \{/, "no «for» here while closed");
  assert.match(treasury, /\|\| \(proposal\.type === "claims" && !launchClaimDeps\(deps\)\)\) return fail\("TREASURY_EXECUTE_ELSEWHERE"/, "no run here while closed");
});

test("SOL-L1d's switch: the devnet stand open, mainnet only with RYNTRA_LAUNCH_CLAIMS_V2=open", async () => {
  const { launchClaimsV2Open } = await import("../../../lib/launch/config.server.ts");
  assert.equal(launchClaimsV2Open({ cluster: "devnet" }, {}), true);
  assert.equal(launchClaimsV2Open({ cluster: "mainnet" }, {}), false);
  for (const value of ["", "1", "true", "on", "OPEN", "opened"]) assert.equal(launchClaimsV2Open({ cluster: "mainnet" }, { RYNTRA_LAUNCH_CLAIMS_V2: value }), false, value);
  assert.equal(launchClaimsV2Open({ cluster: "mainnet" }, { RYNTRA_LAUNCH_CLAIMS_V2: " open " }), true);
});

test("the engine's last line says not read when whether the executor acts was not read (1.47.0)", () => {
  assert.match(HEALTH, /word\(engine\.acts \? "hNoAction" : engine\.actsUnread \? "hExecutorUnread" : health\.venue === "curve" \? "hExecutorIdle" : "hExecutorIdleDex"\)/);
  assert.match(both("hExecutorUnread")[1], /не прочитано/);
  assert.match(HEALTH, /\{engine\.actsUnread \? <span className=\{styles\.cellSub\}>\{word\("hExecutorUnread"\)\}<\/span> : null\}/, "beside its last act too");
  assert.match(read("lib/launch/health.server.ts"), /if \(args\.runs\.unread\) return null;/, "no STOPPED pause on a guess");
});
