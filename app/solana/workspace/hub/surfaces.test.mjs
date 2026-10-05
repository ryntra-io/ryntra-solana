import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { settingsEntry } from "../../../shell/modules.ts";
import { solanaNavigation, SOLANA_MANIFEST as MANIFEST } from "./manifest.ts";
import { SOLANA_MODULES as REGISTRY } from "./modules.ts";
import { needsDevelopmentRepository } from "../../../../lib/development-repository.mjs";
/**
 * The Solana Hub's source-checkable gates — the subset of the workspace's
 * design rules a machine can answer with certainty.
 *
 * Rendered geometry, contrast and screenshot evidence are deliberately
 * absent: they need a browser, and a test that pretended to measure a
 * rendered box from source would report green on exactly the defect class
 * that reaches a person. They stay live-measurement obligations.
 *
 * Every check strips comments first. Three separate Stellar tests once failed
 * against the paragraph explaining the very defect they guard; that lesson is
 * inherited, not relearned.
 */

const WORKSPACE = join("app", "solana", "workspace");

function walk(dir, match, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, found);
    else if (match(entry)) found.push(path);
  }
  return found;
}

const COMPONENTS = walk(WORKSPACE, (name) => name.endsWith(".tsx"));

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const stripJs = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripCss = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The registry, parsed once from source. The suite runs under `node --test`
 * with no TypeScript step, and the shape is stable — every entry is a
 * `railed({…})`, `gated({…})` or `mapped({…})` call at one indent. A parse
 * that stops matching fails loudly rather than silently checking nothing.
 */
function parseRegistry() {
  const source = read(join(WORKSPACE, "hub", "modules.ts"));
  const body = source.slice(source.indexOf("export const SOLANA_MODULES"));
  const entries = [];
  for (const [, kind, fields] of body.matchAll(/\n {2}(railed|gated|mapped)\(\{\n([\s\S]*?)\n {2}\}\),/g)) {
    const field = (name) => {
      const match = fields.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*(?:"([^"]*)"|\`([^\`]*)\`|(BASE)\\b|null)`));
      if (!match) return null;
      return match[1] ?? match[2] ?? (match[3] ? "" : null);
    };
    entries.push({
      kind,
      id: field("id"),
      gate: field("gate"),
      purpose: field("purpose"),
      /* `detail` is the disclosure body on the Hub Map card. It is parsed
         because the card is what a reader sees: a claim in the body and a
         claim in the gate are the same card to them. */
      detail: field("detail"),
      exists: field("exists"),
      missing: field("missing"),
      guided: /guided:\s*true/.test(fields),
      routeSuffix: field("route"),
    });
  }
  return entries;
}

// -------------------------------------------------- the reintroduced-route class --

test("every railed module points at a page that exists", () => {
  /* The registry throws at construction for a railed module with no route.
     What it cannot see is a route string pointing at a directory nobody
     created — a 404 in the navigation rail, the single most expensive mistake
     the registry file can make. */
  const registry = read(join(WORKSPACE, "hub", "modules.ts"));
  const routes = [...registry.matchAll(/route:\s*(?:`\$\{BASE\}([^`]*)`|BASE\b)/g)].map(([, suffix]) => suffix ?? "");
  assert.ok(routes.length >= 5, `Expected several railed routes, parsed ${routes.length}.`);

  for (const suffix of routes) {
    const expected =
      suffix === "" ? join(WORKSPACE, "page.tsx") : join(WORKSPACE, ...suffix.split("/").filter(Boolean), "page.tsx");
    assert.ok(existsSync(expected), `A railed module points at /solana/workspace${suffix}, but ${expected} does not exist.`);
  }

  /* And the footer's map link, which is a route no module registers. */
  assert.ok(existsSync(join(WORKSPACE, "map", "page.tsx")), "The Hub Map route is linked from the footer and must exist.");
});

test("the rail carries working routes only, and Simple and Pro carry the same ones", () => {
  /* This assertion is the inverse of the one it replaces, and the reversal is
     a decision of 2026-09-03, not a relaxation. The old rule — and the test
     that guarded it — required Pro to render the full end-state IA at once
     with inert `Soon` placeholders. What
     it produced was twenty-nine rows, nineteen of them disabled, while Simple
     hid four surfaces that work: the beginner's mode showed less product and
     the depth mode showed mostly things that do not exist. `Soon` was also
     false where `policy` and `sdk-mcp` are registered AVAILABLE, and the
     helper that drew those rows discarded each module's real gate for a
     generic "In development" — the exact shape `modules.ts` forbids, reached
     because the rail was typed by hand beside the registry.
     Nothing left the product: every one of those capabilities keeps its
     registry entry and its gate. What may no longer happen is a rail row that
     goes nowhere. */
  const groups = solanaNavigation("en", "pro");
  assert.deepEqual(groups.map((group) => group.title), ["Markets", "Portfolio", "Transfers", "Journal"]);
  assert.deepEqual(
    groups.map((group) => group.entries.map((entry) => entry.id)),
    [
      ["overview", "trade"],
      ["holdings", "assets"],
      ["send", "receive"],
      ["journal", "receipts"],
    ],
  );

  const railIds = groups.flatMap((group) => group.entries.map((entry) => entry.id));
  assert.ok(!railIds.includes("settings"), "Settings must stay pinned rather than enter a content group.");
  assert.ok(settingsEntry(MANIFEST), "The workspace must declare a Settings destination.");

  /* Every row routes, and no row carries a tag. A tag on the rail was only ever
     needed to label something that could not be opened. */
  const routes = new Set(REGISTRY.map((entry) => entry.route).filter(Boolean));
  for (const group of groups) {
    for (const entry of group.entries) {
      assert.ok(entry.href, `${entry.id} is a rail row with no route, which this rail no longer allows.`);
      assert.ok(routes.has(entry.href), `${entry.id} points at ${entry.href}, which the registry does not declare.`);
      assert.equal(entry.tag, undefined, `${entry.id} carries a rail tag; a routed row needs none.`);
      assert.equal(entry.gate, undefined, `${entry.id} carries a rail gate; a routed row is not gated.`);
    }
  }

  /* Pro is depth over the same product, never a longer list. If these two ever
     differ again, the difference has to be inside a page. */
  assert.deepEqual(solanaNavigation("en", "simple"), groups);
  assert.deepEqual(solanaNavigation("uk", "simple"), solanaNavigation("uk", "pro"));
});

test("the registry retains planned directions without projecting them into the rail", () => {
  /* The original sidebar, as a check: Overview, Assets, Trade, Receipts,
     Developers, Settings routed; Markets and Strategy gate-named. Trade moved
     from gated to railed when the swap preview shipped, and `send` —
     registered as `devnet-lifecycle` until the devnet ladder left the
     vocabulary — moved from map-only to railed the day it got a route. A
     module gets a rail entry the moment it has a page and not one commit
     earlier, because a sidebar link to a route that does not exist is a
     recorded defect class here. The set must not drift otherwise. Bridge left
     the set entirely on 2026-09-08: the cross-chain swap replaced it, so its
     page and its registry row are gone while its CCTP engine keeps running
     inside Swap. `journal` — the History surface — moved from a `Soon`
     placeholder in the rail to a routed entry the day the wallet-scoped action
     ledger and its page existed, which is the same rule applied again rather
     than an exception to it. A gated entry must name the phase that opens it;
     `gated()` already throws otherwise. */
  const entries = parseRegistry();
  const registeredOrRouted = entries.filter((entry) => entry.kind !== "mapped");

  assert.deepEqual(
    registeredOrRouted.map((entry) => entry.id).sort(),
    ["assets", "developers", "holdings", "journal", "markets", "overview", "receipts", "receive", "send", "settings", "strategy", "trade"].sort(),
    "The truthful registry set changed while only its customer projection was meant to move.",
  );

  for (const id of ["markets", "strategy"]) {
    const entry = entries.find((candidate) => candidate.id === id);
    assert.equal(entry?.kind, "gated", `"${id}" must be gate-named in the rail, not ${entry?.kind}.`);
    assert.match(
      entry.gate ?? "",
      /\bPhase [A-F]\b/,
      `"${id}" is gated without naming the phase that opens it.`,
    );
  }
  assert.equal(
    entries.find((candidate) => candidate.id === "trade")?.kind,
    "railed",
    "Trade has shipped and must stay a routed rail entry.",
  );
  assert.equal(
    entries.find((candidate) => candidate.id === "bridge")?.kind,
    "mapped",
    "The transfer kept its record when it lost its page; its CCTP engine runs inside Swap.",
  );

  /* What a gate may say, in three shapes: nothing is pending, no work is
     planned yet, or the condition itself — a phase, a canary, a review, a
     sign-in, a ladder, what it waits on or what must exist first. */
  const NOTHING_PENDING = /^None\b/;
  const NOT_PLANNED = /^No (?:[\w-]+ )*work is planned\b|\bis not planned\b/;
  /* A condition names its object: a phase, a named canary or canary gate, sign-in, what exactly a module waits
     on, or a release ladder. A bare «review», «canary» or «waits on later work» names nothing anybody can check. */
  const NAMED_CONDITION = /\bPhase [A-F]\b|\b(?:bridge|Token-2022|swap|ATA-create|general Send) canar(?:y|ies)\b|\bcanary gate\b|\bsign-in\b|\b[Ww]aits? on (?!(?:later|other|more|further|future|some) work\b)(?:the |a |an )?\S+|\brelease ladder\b/;
  const statesCondition = (gate) => NOTHING_PENDING.test(gate) || NOT_PLANNED.test(gate) || NAMED_CONDITION.test(gate);
  for (const entry of entries) {
    for (const fieldName of ["purpose", "exists", "missing", "gate"]) {
      assert.ok(
        (entry[fieldName] ?? "").length > 0,
        `Module "${entry.id}" has an empty ${fieldName} — a state word alone is not checkable.`,
      );
    }

    /* Every gate names something, however the entry was constructed.
       `gated()` has asserted this for its own entries since it existed, and the
       rail bypassed it: nineteen rows were drawn by a hand-written helper that
       discarded each module's real gate and wrote a generic "In development"
       instead. The registry forbade that shape and could not see it happen.
       So the rule moves here, where it covers the whole file: a gate either
       names the condition that opens the module, says plainly that no work is
       planned yet, or says plainly that nothing is pending. "In development",
       "Soon" or a sentence that only asserts other work exists somewhere is
       not a condition anybody can act on or check. */
    const gate = entry.gate ?? "";
    assert.ok(
      statesCondition(gate),
      `Module "${entry.id}" has a gate that names nothing: "${gate.slice(0, 80)}".`,
    );
  }

  /* And the vocabulary is a check rather than a formality: the shape the
     rail once wrote for nineteen modules fails it. */
  for (const vague of ["", "In development", "Soon", "A summary of History on this screen is its own row.", "Coming soon, pending review.", "Waits on later work.", "No second M2 canary."]) {
    assert.ok(!statesCondition(vague), `The gate vocabulary accepts a gate that names nothing: "${vague}".`);
  }
});

// ------------------------------------------------- the stale-model class --

/**
 * The stale-model defect, kept out by a test rather than by memory.
 *
 * Three live gate strings kept naming the owner-signed Devnet lifecycle after
 * it was cancelled, so three surfaces told a reader that the next thing to
 * happen was a signature nobody intends to give. Nothing in the suite could
 * notice: a gate is a free-text string, and every check on it asked whether it
 * was non-empty.
 *
 * Both halves are asserted over the whole Solana workspace, not just the
 * registry, because the gate strings were only half of it — the same
 * superseded model was written into page copy, an info control and a metadata
 * title.
 */
test("no Solana surface revives the cancelled devnet step or sells devnet as a step", () => {
  /* The cancelled step was the `devnet-lifecycle` module and the ladder it
     climbed: DEVNET_ACTION, DEVNET_EXECUTION, DEVNET_VERIFIED. It stays
     cancelled while no module carries that id or deals in a devnet
     environment, mode or maturity, no card or rendered copy spells the old
     ladder, and Send — the module that took its place — proves on mainnet. */
  const CANCELLED_MODULE = "devnet-lifecycle";
  const CANCELLED = /\bdevnet-lifecycle\b|\bDEVNET_(?:ACTION|EXECUTION|VERIFIED)\b/;
  assert.ok(
    !REGISTRY.some((entry) => entry.id === CANCELLED_MODULE),
    `The cancelled "${CANCELLED_MODULE}" module is registered again.`,
  );
  for (const entry of REGISTRY) {
    assert.ok(
      !/devnet/i.test(`${entry.environment} ${entry.mode} ${entry.maturity}`),
      `Module "${entry.id}" deals in a devnet environment, mode or maturity.`,
    );
  }
  assert.equal(
    REGISTRY.find((entry) => entry.id === "send")?.environment,
    "MAINNET",
    "Send took the cancelled devnet step's place and must prove on mainnet.",
  );

  /* What Devnet text has to say wherever it appears: that it is a regression
     fixture, and that it is not a step towards release. */
  const FIXTURE = /regression fixture/;
  const NOT_A_STEP = /never a release gate|not a step/;

  for (const entry of parseRegistry()) {
    for (const fieldName of ["purpose", "detail", "exists", "missing", "gate"]) {
      assert.ok(
        !CANCELLED.test(entry[fieldName] ?? ""),
        `Module "${entry.id}" names the cancelled devnet step in ${fieldName}. Name the mainnet gate that can still happen.`,
      );
    }

    /* The registry gets the file rule below, applied per card. Its strings are
       rendered on the Hub Map, so a module that names Devnet anywhere must say
       on the same card that it is a regression fixture and not a step — the
       reader sees one card, not a file. The live map once carried exactly one
       such mention, on the Send card, beside its gate; this is what keeps any
       later one honest. */
    const card = ["purpose", "detail", "exists", "missing", "gate"]
      .map((fieldName) => entry[fieldName] ?? "")
      .join(" ");
    if (/[Dd]evnet/.test(card)) {
      assert.ok(
        FIXTURE.test(card) && NOT_A_STEP.test(card),
        `Module "${entry.id}" names Devnet without calling it a regression fixture that is not a step, so the map reads it as a step.`,
      );
    }
  }

  /* Devnet survives in exactly two files now, and it is permitted in both for
     the same reason: their whole job is to state configuration — the endpoint
     table, and the answer to "why is there no network switch".

     **The Send pair has left this list**, as the previous version of this
     comment said it would, though it predicted the list would empty. It did
     not empty, it shrank, and the shrinking is the assertion —
     `send/page.tsx` and `send/send-card.tsx` now read, build and simulate on
     mainnet, so a Devnet mention in either of them is the wiring coming back
     rather than a fixture being described.

     Anywhere else the word is the ladder coming back, and the assertion is
     zero mentions rather than a judgement about framing. A file that leaves
     this list and a file that joins it both fail here first. */
  const FIXTURE_FILES = new Set([
    join(WORKSPACE, "developers", "page.tsx"),
    join(WORKSPACE, "settings", "page.tsx"),
  ]);

  const RENDERED_STRING = /\btext\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const path of COMPONENTS) {
    const source = read(path);
    const prose = stripJs(source);
    assert.ok(!CANCELLED.test(prose), `${path} spells the cancelled devnet step in rendered copy.`);

    if (!/[Dd]evnet/.test(prose)) continue;
    assert.ok(
      FIXTURE_FILES.has(path),
      `${path} prints Devnet. Only the endpoint table and the Settings network panel may, and only as a regression fixture.`,
    );
    /* `prose`, not `source`: the fixture has to be called one where a reader
       can see it. A file-level comment explaining the fixture to the next
       engineer is worth having and is not the thing this asserts.

       `assert.ok`, not `assert.match`: a failed match prints the whole file
       into the report, and the one that failed here first was 180 lines of
       JSX for a one-word finding. */
    assert.ok(
      FIXTURE.test(prose) && NOT_A_STEP.test(prose),
      `${path} names Devnet without saying where a reader sees it that it is a regression fixture and not a step.`,
    );
    /* And per string, because a reader meets one string at a time: every
       rendered string that names Devnet calls it a fixture in the same breath. */
    for (const [, literal] of prose.matchAll(RENDERED_STRING)) {
      assert.ok(
        !/[Dd]evnet/.test(literal) || /fixture/.test(literal),
        `${path} renders "${literal.slice(0, 80)}", which names Devnet without calling it a fixture.`,
      );
    }
  }
});

// ------------------------------------------------------------- environment --

/**
 * A cluster is never spelled by hand.
 *
 * `explorer.solana.com` defaults to mainnet-beta with no query and takes
 * `?cluster=devnet` with one, so the difference between a working link and a
 * link to an empty account is a query string an author has to remember. This
 * workspace has already shipped both halves of that: a shell that pinned every
 * address to devnet on behalf of one surface, and a Send console spelling its
 * cluster inline. `lib/solana/explorer.ts` owns the spelling; a literal here is
 * a second opinion about which network a person is looking at.
 */
test("every explorer link is built by the module that knows the cluster", () => {
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    assert.ok(
      !/explorer\.solana\.com\//.test(source),
      `${path} builds an explorer URL by hand. Use explorerAddressUrl / explorerTxUrl from lib/solana/explorer.ts.`,
    );
  }
});

/**
 * The connection surface cannot sign.
 *
 * Connection is shell-level and signing lives inside the action lifecycle with
 * the exact bytes — that split is why the Send console could once disagree
 * with its own chrome. A `signTransaction` import into the shell control would
 * be the same mistake in a new place, and it would arrive as a convenience.
 */
test("the connection control imports no signing capability", () => {
  /* Comments stripped first, and this test proved the point on itself: the
     file's own paragraph explaining that it does not import `signTransaction`
     failed the first run. Three Stellar tests learned this the same way. */
  const source = stripJs(read(join(WORKSPACE, "connection.tsx")));
  assert.ok(
    !/signTransaction/.test(source),
    "app/solana/workspace/connection.tsx reaches for signTransaction. Signing belongs to the action lifecycle.",
  );
});

/**
 * The wallet is chosen, not guessed.
 *
 * A browser with Phantom, MetaMask, OKX Wallet and SquadsX registers four
 * signers. The detector ranks them — a Solana account is worth two, devnet
 * one — and the workspace connected `wallets[0]`. A locked Phantom exposes no
 * account, which drops it to a four-way tie broken by `localeCompare`, so
 * `Connect` reached past the Phantom in the toolbar for the MetaMask that
 * sorts first. MetaMask answered `-32002` — a request it already had open —
 * and the panel titled that a refusal beside a retry that could not clear it.
 * Ranking may suggest; it may not decide alone.
 */
test("the workspace offers every detected wallet, and no failure is guessed to be a refusal", () => {
  const conn = stripJs(read(join(WORKSPACE, "connection.tsx")));
  assert.match(conn, /choices: wallets\.map\(/, "The control is handed a ranking instead of the wallets themselves.");
  assert.match(conn, /connect: \(id\) => connect\(id\)/, "The chosen wallet's name never reaches connect().");
  assert.match(conn, /kindOf\(result\.state\)/, "The failure reaches the panel without saying what kind it was.");

  const client = stripJs(read(join("lib", "solana", "wallet.client.ts")));
  /* The two codes that mean something, read as the hint they are. Everything
     else is `FAILED` — said out loud, never inferred into a refusal. */
  assert.match(client, /code === 4001/, "A user rejection is no longer recognised.");
  assert.match(client, /code === -32002/, "A request already open in the wallet is no longer recognised.");
  assert.ok(
    !/state: "REFUSED",\s*reason: failure instanceof Error/.test(client),
    "Every thrown failure is being reported as a refusal again.",
  );
});

/**
 * One screen, one network.
 *
 * The defect this closes was on the live site and a person found it: the
 * Send console asked the holdings route for `network: "devnet"`, so it printed
 * faucet dust and a devnet SOL balance under a page chip reading `MAINNET ·
 * USER-SIGNED`. Every fact on the screen was true of *a* network and the
 * screen named the other one, with the correction hidden behind an info icon.
 *
 * The chip is generated from the module registry's `environment` axis, so the
 * two are bound here rather than kept in step by hand. A console that changes
 * network without the registry, or a registry that changes without the
 * console, fails before it renders.
 */
test("the Send console reads the network its own surface claims", () => {
  const source = read(join(WORKSPACE, "send", "send-card.tsx"));
  const network = /const NETWORK = "([a-z]+)" as const/.exec(source)?.[1];
  assert.ok(network, "The Send console lost its single network constant, so nothing binds it to the chip.");

  const entry = REGISTRY.find((candidate) => candidate.id === "send");
  assert.ok(entry, "The send module left the registry.");
  assert.equal(
    entry.environment,
    network.toUpperCase(),
    `The Send console reads ${network} while its module chip claims ${entry.environment}.`,
  );

  /* And the constant is the only spelling. Six call sites each carrying their
     own literal is how the console and the chip drifted apart in the first
     place; a second literal here is that drift starting again. */
  const code = stripJs(source);
  assert.ok(
    !/network: "(mainnet|devnet)"/.test(code),
    "A network literal is back in the Send console. Every call site reads NETWORK.",
  );
  assert.ok(
    !/"solana:(mainnet|devnet)"/.test(code),
    "The wallet is handed a hard-coded chain instead of the console's own network.",
  );
});

/**
 * The signature exists only where the submit route would accept it.
 *
 * Two halves that used to be maintained separately: a server that refused
 * mainnet and a console that offered the button anyway, so the boundary was
 * something a person discovered by pressing it. One list now, imported by
 * both, and the surface renders **absence** rather than a disabled control —
 * the rule the trade surface already follows, because a greyed button is a
 * wired path with the switch off.
 */
test("Send is one card, not a numbered protocol printed on the page", () => {
  const source = stripJs(read(join(WORKSPACE, "send", "send-card.tsx")));
  assert.match(source, /Review transfer/, "The primary action no longer names what pressing it does.");
  assert.ok(!/Sign one transfer/.test(source), "The compose panel still titles itself a signing console.");
  assert.ok(!/Read the chain and build/.test(source), "The engineer-button copy is back.");
  assert.ok(!/A mainnet address that is not this one/.test(source), "The recipient field still lectures.");
  assert.match(source, /NATIVE_ASSET_ID/, "Native SOL is not a first-class asset on the picker.");
  assert.match(source, /setPicking\(true\)/, "The asset list is back on the card, covering the action.");
  assert.match(source, /preferredSendAsset/, "The last wallet asset is not restored after reload.");
  assert.match(source, /rememberSendAsset/, "Picking an asset is not remembered for this wallet.");
  assert.ok(!/setAsset\(native \? NATIVE_ASSET_ID : ""\)/.test(source), "Send silently falls back to SOL again.");
  assert.ok(!/h=\{6\}/.test(source), "A fixed panel height is clipping the action again.");
});

/**
 * Nothing on this card is written for the person who built it.
 *
 * Every item below was on the production Send screen: a rule identifier as the
 * heading of its own explanation, a readiness enum spelled out with its
 * underscores replaced by spaces, two fee tiles denominated in lamports, the
 * RPC provider's role and host under the wallet button, a line reporting the
 * result of comparing signed bytes, and an internal task id in two `data-testid`
 * hooks and the page lead. The Swap card carries the same rule
 * (`Raw codes or recovery vocabulary still leak into the customer flow`); this
 * is Send's half of it, and it is the gate that rule needs, because the
 * localization gate reads string literals and every one of these reached the
 * screen as a rendered expression instead.
 */
test("Send speaks to the person sending, not to the engine", () => {
  const card = read(join(WORKSPACE, "send", "send-card.tsx"));
  const page = read(join(WORKSPACE, "send", "page.tsx"));

  for (const [pattern, why] of [
    [/\{finding\.(code|rule)\}/, "A policy or capability identifier is rendered as its own label again."],
    [/replace\(\/_\/g/, "A raw enum is printed with its underscores swapped for spaces."],
    [/\blamports\b/, "A fee is denominated in lamports on the customer surface."],
    [/text\("Provider"\)|\{plan\.provider\.(role|host)\}/, "The RPC provider is named on the screen instead of in the receipt."],
    [/Signed bytes check/, "The byte comparison is reported to the sender as a result line."],
    [/data-testid/, "A test hook is back in shipping Send markup."],
    [/RYN-SOL-/, "An internal task id is back on the Send surface."],
    [/text\("[^"]*\b(canary|ATA|M1B)\b/i, "Programme vocabulary is back in customer copy."],
  ]) {
    assert.ok(!pattern.test(card), why);
    assert.ok(!pattern.test(page), why);
  }

  /* And the codes still exist — they are translated once, in front of the
     surface, rather than deleted. A card with no mapping would simply be a
     silent one. */
  assert.match(card, /sendWarningCopy|sendFailureCopy|sendReadinessCopy/,
    "Send renders machine answers without translating them into sentences.");
  /* `PageHead` itself is no longer the tell: every domain page carries one to
     name the domain it stands in. What was banned here was the *paragraph* —
     `lead` renders explanatory prose above the work — and that is what stays
     banned. */
  assert.ok(!/lead=/.test(page), "The Send page carries a lead paragraph again.");
});

test("Send offers a signature only where a signed transaction could be submitted", () => {
  const source = read(join(WORKSPACE, "send", "send-card.tsx"));
  assert.match(
    source,
    /const signingOpen = plan[\s\S]{0,180}canSubmitSendAction\(\{ network: NETWORK, safety: plan\.safety \}\)/,
    "The Send console decides for itself whether signing is open instead of reading the server's safety verdict.",
  );
  assert.ok(
    !/disabled=\{[^}]*SIGNING_OPEN/.test(source),
    "The gate renders a disabled sign control. Absence is the honest form; a greyed button is a promise.",
  );

  const settle = read(join("app", "api", "solana", "transfer", "settle", "route.ts"));
  assert.match(
    settle,
    /canSubmitSendAction\(\{ network: shaped\.data\.plan\.network, safety: settleSafety \}\)/,
    "The submit route enforces its own copy of the boundary instead of the shared safety gate.",
  );
  assert.match(
    settle,
    /evaluateSendSafety\(\{[\s\S]{0,400}state: resolveSendState\(\)/,
    "The submit route must re-derive safety here rather than trust a verdict the caller posted.",
  );
  assert.match(source, /post<PlanResponse>\("\/api\/solana\/transfer\/adopt"/);
  assert.match(source, /sendInFlight\.current/, "React can open two wallet money actions before the button rerenders.");
  assert.match(source, /post<SettleResponse>\("\/api\/solana\/transfer\/settle"/);
  assert.match(source, /text\("Confirm in wallet"\)/);
  /* The environment lock. The authorization was given over one exact world —
     wallet, network, amount, mint, provider, recipient — and the Review is
     rebuilt at the moment of signing because a blockhash expires. Without this
     the rebuild is free to change any of those six and still open the
     wallet. */
  assert.match(source, /checkEnvironmentLock\(\{[\s\S]{0,160}authorized/,
    "The rebuilt Review can change the authorized world and still reach a wallet.");
  assert.match(
    source,
    /if \(result\.signature\)[\s\S]{0,220}setSettled\(\{ state: "UNRESOLVED", signature: result\.signature, receipt: null \}\)/,
    "A post-submit ambiguity can expose another money action instead of holding the signature.",
  );
  assert.ok(
    !/text\("Submit"\)/.test(source),
    "The short-lived blockhash is still split across a second Submit button.",
  );

  const adopt = read(join("app", "api", "solana", "transfer", "adopt", "route.ts"));
  for (const boundary of [
    "verifySendReviewProof",
    "verifySignatureOnly",
    "compareWalletTransaction",
    "adoptWalletTransactionPlan",
    "simulateTransaction",
    "createSendReviewProof",
  ]) {
    assert.match(adopt, new RegExp(boundary), `${boundary} is absent from the wallet-adoption boundary.`);
  }

  /* The plan route is the other half of the same decision, in the opposite
     direction. It reads, builds and simulates — it reaches the network with no
     intent — and pinning it to devnet is what produced the devnet-under-a-
     MAINNET-chip screen while being described as safety. */
  const plan = read(join("app", "api", "solana", "transfer", "plan", "route.ts"));
  assert.ok(
    !/value\.network === "devnet"/.test(plan),
    "The plan route is pinned to devnet again. It moves nothing; the gate belongs on the route that submits.",
  );
  assert.match(
    plan,
    /createSolanaRpcHandle\(\{ network: input\.network \}\)/,
    "The plan route reads one network while the input names another.",
  );
});

test("Send binds the durable canary verdict and renders the canary control plane", () => {
  const plan = read(join("app", "api", "solana", "transfer", "plan", "route.ts"));
  for (const boundary of [
    "buildSendCanaryIntent",
    "readSolanaCanaryBudget",
    "evaluateSolanaCanaryIntent",
    "canaryIntent",
    "canaryVerdict",
  ]) {
    assert.match(plan, new RegExp(boundary), `The Send plan route does not bind ${boundary}.`);
  }

  const send = stripJs(read(join(WORKSPACE, "send", "send-card.tsx")));
  /* The owner canary is still evaluated and still carried, so M1B's evidence
     stays reproducible — but it stopped being what an ordinary Send is judged
     by, and a Review that led with it was telling a person their transfer was
     paused by a policy about a different transaction. Send now renders the
     capability decision, which is about the asset in front of them. */
  assert.match(send, /canaryVerdict/, "Send must still carry the canary verdict as historical evidence.");
  assert.match(send, /canSubmitSendAction\(\{ network: NETWORK, safety: plan\.safety \}\)/,
    "Send decides for itself whether a wallet may open instead of reading the server's safety verdict.");
  assert.match(send, /plan\.safety\.findings[\s\S]{0,80}plan\.support\.findings/,
    "Send does not show what a person must weigh before signing, from both verdicts.");

  const settings = stripJs(read(join(WORKSPACE, "settings", "page.tsx")));
  for (const truth of [
    "20 USD",
    "ALLOW",
    "REVIEW",
    "BLOCK",
    "PAUSE",
    "UNKNOWN",
    "DURABLE_MULTI_WRITER",
    "SOLANA_CANARY_ENV.state",
  ]) {
    assert.match(settings, new RegExp(truth), `Settings does not render ${truth}.`);
  }
  assert.ok(!/onClick=/.test(settings), "The public Settings surface must not mutate the operator kill switch.");
});

test("Settings shows what is left of the canary budget and what was spent it on", () => {
  const settings = stripJs(read(join(WORKSPACE, "settings", "page.tsx")));

  /* A ceiling and a spend without a remainder makes the reader do the
     subtraction, and the subtraction they would do is the wrong one: money
     already promised to an unfinished action is neither spent nor available.
     The page states the figure the next canary is actually measured against. */
  assert.match(settings, /remaining\(budget\.totalLimitUsdMicros/, "Settings does not render the remaining package budget.");
  assert.match(
    settings,
    /remaining\(rule\.maximumUsdMicros/,
    "Settings does not render what is left of each family's own ceiling.",
  );

  /* And the totals name their evidence. Every figure below has a transaction
     signature beside it, so the number can be read back on a public chain
     instead of believed. */
  assert.match(settings, /readSolanaCanarySpendEvidence/, "Settings does not read the spends behind the totals.");
  assert.match(settings, /solana-set-canary-evidence/, "Settings has no panel for the spend evidence.");
  assert.match(settings, /shortSignature\(entry\.signature\)/, "Settings does not print the signature beside a spend.");
  assert.match(
    settings,
    /held, outcome unknown/,
    "Settings does not distinguish a committed spend from exposure whose outcome is not yet known.",
  );
});

test("the bridge burn route settles the owner-canary budget it reserved", () => {
  const burn = read(join("app", "api", "solana", "bridge", "burn", "route.ts"));

  /* The bridge first shipped without this and the ledger reported zero spent
     after a real two-dollar transfer. The reservation is taken before the
     boundary and settled from what the chain said afterwards. */
  for (const boundary of [
    "openCctpCanaryExposure",
    "markCctpCanarySubmitted",
    "settleCctpCanaryExposure",
  ]) {
    assert.match(burn, new RegExp(boundary), `The bridge burn route does not call ${boundary}.`);
  }
  assert.match(
    burn,
    /markCctpCanarySubmitted\([\s\S]{0,120}\}\);\s*await beforeBurn\(signature\)/,
    "The canary submit marker must be written before the burn boundary is crossed, so a ledger failure cannot strand a burn.",
  );
  assert.match(
    burn,
    /CONFIRMED_CLEAN[\s\S]{0,240}CONFIRMED_REVERTED[\s\S]{0,240}UNDETERMINED/,
    "The burn route must map a clean confirmation, a revert and an unknown outcome to three different budget answers.",
  );
});

/**
 * The first screen shows the work, and the button never does nothing.
 *
 * This surface had a live Jupiter quote, both mints re-read on the visit and a
 * thirteen-rule verdict, all of it behind a button — and the button was inert.
 * `Get quote` on the untouched form submitted `?in=&out=&amount=`, which the
 * page scored as "nothing was asked" and answered by re-rendering itself,
 * unchanged and silent. What a person saw was two greyed mint addresses that
 * were placeholders, an amount that was a placeholder, and no way to tell a
 * broken button from an ignored one.
 */
test("the Swap surface answers on arrival and never suggests the trade it defaults to", () => {
  /* 2026-08-30: Swap stopped being a document. The surface is one client
     card that quotes from the server on a settled amount, so the old shape of
     this guard — a server-rendered default quote behind a GET form —
     describes a page that no longer exists. The PROPERTY it protected is the
     one that survives: a bare visit answers, and an answer nobody asked for
     says out loud that it is a default. */
  const page = stripJs(read(join(WORKSPACE, "swap", "page.tsx")));
  const card = stripJs(read(join(WORKSPACE, "trade", "swap-card.tsx")));

  /* Absent is not empty: each deep-link key is shape-checked, and a key that
     fails its shape seeds nothing rather than seeding a bad mint. */
  /* The two mints go through one shared resolver since the Swap/Bridge split,
     so the shape check is asserted where it now lives rather than inlined twice.
     The property is unchanged: a key that fails its shape seeds nothing. */
  assert.match(page, /MINT_SHAPE\.test\(mint\)/, "The deep link's mints are no longer shape-checked.");
  assert.match(page, /mintOf\(params\.in,/, "The input mint no longer reaches the resolver.");
  assert.match(page, /mintOf\(params\.out,/, "The output mint no longer reaches the resolver.");
  assert.match(page, /AMOUNT_SHAPE\.test\(params\.amount\)/, "The deep link's amount is no longer shape-checked.");
  assert.ok(!/\bconst asked\b/.test(page), "The quote is gated behind an `asked` flag that empty fields defeat.");

  /* A bare visit lands on a real pair, and on no amount at all. The rule
     changed on 2026-09-03 and the old one is worth recording: the card seeded
     `1`, which quoted immediately but was indistinguishable on screen from a
     figure the person had typed, and `replaceState` then published `amount=1`
     as though they had asked for it. A pair is a starting point the product
     may choose; an amount is a decision only the person may make. The pair
     defaults are therefore still pinned here and the amount is pinned empty. */
  assert.match(card, /\? initialSell : WRAPPED_SOL_MINT\)/, "The card lost its default sell leg.");
  assert.match(card, /\? initialBuy : SOLANA_MAINNET_USDC_MINT\)/, "The card lost its default buy leg.");
  assert.match(card, /useState\(initialAmount \?\? ""\)/, "The card seeds an amount again — a figure nobody typed reads as one they did.");
  assert.match(card, /"\/api\/solana\/swap\/quote"/, "Nothing on the card asks for a quote.");
  assert.ok(!/type="submit"/.test(card), "The card asks by settling, not by submitting into a page load.");

  assert.ok(!/not a recommendation|Default pair/.test(card), "The default quote still carries explanatory copy on the work surface.");
});

// ------------------------------------------------------------- stylesheets --

test("every class used in Solana markup resolves to a rule", () => {
  /* A class with no rule falls back silently and is invisible to every
     source-level check — `.tally` once produced a 173px column inside a
     sticky toolbar this way. */
  const sheets = [
    join(WORKSPACE, "hub", "hub.css"),
    join("app", "shell", "hub.css"),
    join("app", "shell", "panel.css"),
    join("app", "shell", "shell.css"),
    join("app", "globals.css"),
    join("app", "app", "product.css"),
  ];
  const defined = new Set();
  for (const sheet of sheets) {
    for (const [, name] of stripCss(read(sheet)).matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) defined.add(name);
  }

  const missing = [];
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    /* Plain string classNames only; `styles.x` is a CSS module, checked by
       the next test. */
    for (const [, classes] of source.matchAll(/className="([^"]+)"/g)) {
      for (const name of classes.split(/\s+/)) {
        if (name && !defined.has(name)) missing.push(`${name} — used in ${path}`);
      }
    }
  }

  assert.deepEqual(missing, [], `Classes with no rule:\n${missing.join("\n")}`);
});

test("every CSS-module class used resolves in its own module", () => {
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    if (!source.includes("styles.")) continue;

    const importMatch = source.match(/import\s+styles\s+from\s+"([^"]+)"/);
    assert.ok(importMatch, `${path} uses styles.* without importing a stylesheet.`);

    const sheet = stripCss(read(join(path, "..", importMatch[1])));
    const declared = new Set([...sheet.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(([, name]) => name));

    for (const [, name] of source.matchAll(/styles\.([a-zA-Z][a-zA-Z0-9_]*)/g)) {
      assert.ok(declared.has(name), `${path} uses styles.${name}, which ${importMatch[1]} does not define.`);
    }
  }
});

// ------------------------------------------------------------ the passport --

test("the passport surface handles all four read-failure codes and keeps its deep link native", () => {
  const page = read(join(WORKSPACE, "assets", "page.tsx"));

  /* The adapter's four failure codes each have a rendering path. The codes
     are the adapter's contract (`lib/solana/mint.ts`); a surface that only
     renders some of them turns the missing ones into blank screens. */
  const adapter = read(join("lib", "solana", "mint.ts"));
  const codes = [...adapter.matchAll(/"(ACCOUNT_NOT_FOUND|NOT_A_MINT|DECODE_FAILED|RPC_FAILED)"/g)].map(([, code]) => code);
  assert.ok(new Set(codes).size === 4, "The adapter's failure-code set changed; update this test and the surface.");
  assert.match(page, /role="alert"/, "Read failure needs an accessible message.");
  for (const code of new Set(codes)) assert.ok(page.includes(code), `Missing human message for ${code}`);

  /* The deep link works before hydration or not at all: a plain GET form
     whose one input is named `mint`. */
  assert.match(page, /<form[^>]*method="get"/, "The find form must submit natively as GET.");
  assert.match(page, /name="mint"/, "The find form's input must be named mint so the URL is the deep link.");
  assert.ok(page.includes("SharePassport"), "The shareable-link row is gone from the passport.");

  /* The unknowns rail is computed and always has the standing entries, so it
     can never render empty in this release. */
  assert.ok(page.includes("passport.unsupportedKinds.length"), "Unrecognized transfer rules must remain visible.");
});

test("the Swap surface quotes server-side, keeps its deep link, and renders every venue refusal", () => {
  const page = stripJs(read(join(WORKSPACE, "swap", "page.tsx")));
  const card = stripJs(read(join(WORKSPACE, "trade", "swap-card.tsx")));
  const route = stripJs(read(join("app", "api", "solana", "swap", "quote", "route.ts")));

  /* The deep link round-trips. The page reads `?in=&out=&amount=` (and, since
     Unified Swap V1, `?from=&fa=&to=&ta=`) and seeds the surface; the surface
     writes the pair and amount back into the address bar, so the URL a person
     copies is the question on their screen. The old GET form is gone with the
     document it belonged to, and the honest caption it carried moved into the
     card's own disclosure. The Solana engine, embedded, keeps its own URL
     mechanics for the standalone card and steps aside when the surface writes. */
  for (const seed of ["params.in", "params.out", "params.amount"]) {
    assert.match(page, new RegExp(seed.replace(".", "\\.")), `The page no longer seeds the card's ${seed} from the URL.`);
  }
  /* Since Swap and Bridge were split on 2026-09-10 this page mounts the
     Solana card directly. `fromAsset`/`toAsset` were the unified surface's
     network-aware seeds and have gone with it — Swap has no network selector
     to seed. */
  assert.match(page, /<SwapCard /, "The page no longer mounts the Solana card.");
  assert.doesNotMatch(page, /fromNetwork|toNetwork/, "Swap grew a network selector again.");
  assert.match(card, /history\.replaceState/, "The card no longer keeps the URL on the question it is showing.");
  assert.match(card, /searchParams\.set\("in", sellMint\)/, "The shareable URL lost its input mint.");
  assert.match(card, /searchParams\.set\("out", buyMint\)/, "The shareable URL lost its output mint.");
  assert.match(card, /searchParams\.set\("amount", amount\)/, "The shareable URL lost its amount.");
  /* And an empty field publishes no amount at all, rather than `amount=`.
     The address bar is the artifact: it may only claim what the screen says. */
  assert.match(card, /searchParams\.delete\("amount"\)/, "An empty amount is written into the URL as though it were a figure.");
  assert.ok(!/Shareable link|The pair and amount, not this quote/.test(card), "URL mechanics still print as a cheat sheet.");

  /* The browser never talks to the venue. Every quote is built by the server
     route, which holds the credential and reads both mints itself. */
  assert.ok(!/api\.jup\.ag/.test(card), "The card reaches the venue directly; the credential is server-only.");
  assert.match(route, /await chooseQuote\(\{/, "The quote route no longer asks fee policy v2's lane choice.");
  assert.match(route, /readMintAccount/, "The quote route no longer re-reads both mints live.");

  /* Every venue refusal the adapter can produce has a rendering path. The card
     renders the code and the message it was given rather than a per-code
     panel, which is why a new adapter code cannot become a blank screen — but
     the codes are still read from the adapter rather than retyped here. */
  const adapter = read(join("lib", "solana", "quotes.ts"));
  const codes = [...adapter.matchAll(/"(PRODUCTION_KEY_REQUIRED|NO_ROUTE|REFUSED|RATE_LIMITED|HTTP_ERROR|UNREACHABLE|MALFORMED)"/g)].map(([, code]) => code);
  assert.ok(new Set(codes).size === 7, "The adapter's failure-code set changed; update this test and the surface.");
  assert.match(card, /quoteFailure\.code/, "The card lost its quote-failure rendering path.");
  assert.match(card, /failureCopy\(quoteFailure\.code, text\)/, "The card no longer maps provider failures to customer copy.");
  assert.match(route, /QUOTE_\$\{result\.code\}/, "The route no longer forwards the adapter's own refusal code.");
  assert.match(route, /errorCode/, "The route no longer forwards the venue's own error code.");
  assert.match(route, /result\.code === "NO_ROUTE" \? 409/, "A missing route and a broken venue answer with the same status.");
  assert.match(route, /"RATE_LIMITED" \? 429/, "A rate limit is no longer told apart from a venue failure.");

  /* Execution exists and stays bounded — by what the bytes do, not by which
     pair they name. Any two distinct mints and any amount may be quoted, and
     a disabled control still states which condition refused: an asset the
     review policy blocks, a leg whose decimals nobody has answered for yet,
     or a quote that has expired. */
  assert.ok(!/CANARY_PAIR/.test(card), "The card still bounds the signature to one hard-coded pair.");
  assert.match(card, /Unavailable for this asset/, "A blocked output asset has no concise customer state.");
  assert.match(card, /Reading both assets…/, "A leg with unknown decimals is quoted instead of waited for.");
  assert.match(card, /legsResolved/, "The card quotes before both legs' decimals are known.");

  /* A stale quote must still stop before the signature — but stopping is not
     the same as stranding. The freshness branch comes BEFORE the one that
     offers the Review, and it now offers the refresh instead of disabling the
     only control and hiding the way forward in a secondary link. */
  const staleBranch = card.indexOf("} else if (!fresh) {");
  const reviewBranch = card.indexOf("Review swap");
  assert.ok(staleBranch > 0, "A stale quote no longer stops before the signature.");
  assert.ok(
    reviewBranch > staleBranch,
    "The Review branch now precedes the freshness check, so a stale quote can reach a signature.",
  );
  assert.match(card, /Refresh quote/, "A stale quote offers no way to ask for a new one.");
  assert.ok(!/signTransaction|signAndSend/.test(page), "The page must not sign; signing lives in the reviewed card.");

  /* The verdict's vocabulary stays closed: the surface never introduces the
     word the engine refuses to produce. Quoting it to state a limit ("has no
     word for safe") is the honest case and is excluded by matching claim
     shapes, not the bare word. */
  for (const source of [page, card]) {
    assert.ok(!/is safe\b|\bSAFE\b/.test(source), "The surface must not add a safety claim over the verdict.");
  }
});

test("the swap card is keyed V2, fee-honest, freshness-bound and canary-gated", () => {
  const card = stripJs(read(join(WORKSPACE, "trade", "swap-card.tsx")));
  const route = stripJs(read(join("app", "api", "solana", "swap", "quote", "route.ts")));
  const adapter = stripJs(read(join("lib", "solana", "quotes.ts")));

  /* Keyed production is the only customer-facing lane. A keyless diagnostic
     path may exist on the server, but it never becomes UI or a silent fallback. */
  assert.match(route, /access: z\.enum\(\["production", "degraded"\]\)\.default\("production"\)/, "Keyed production is not the default declared access mode.");
  assert.match(route, /resolveJupiterSwapEndpoint/, "The route no longer resolves the keyed endpoint.");
  assert.ok(!/setAccess\("degraded"\)|KEYLESS_FALLBACK_CODES|labelled degraded/.test(card), "Keyless diagnostics leaked into the customer Swap UI.");
  assert.match(card, /access:\s*"production"/, "The card no longer asks through the keyed production lane.");
  assert.ok(!/fetchJupiterQuote/.test(route), "Trade still calls the legacy V1 quote adapter.");

  /* Fee honesty survives in the exact Review and Receipt, not as a customer
     cheat sheet. The last pre-wallet surface carries only the three values a
     person decides on. */
  for (const label of ["You pay", "You receive at least", "Network fee estimate", "Account reserve"]) {
    assert.match(card, new RegExp(label), `The exact Review omits ${label}.`);
  }
  assert.match(card, /finding\.outcome === "REVIEW"[\s\S]*reviewWarningCopies/,
    "Signable REVIEW findings are no longer shown to the human in plain language.");
  assert.match(card, /const effectiveSlippageBps = Math\.max[\s\S]*warnings\.push\(text\("The quote and minimum received use different slippage\."\)\)[\s\S]*effectiveSlippageBps > 300[\s\S]*warnings\.push\(text\("The price may move by more than 3%\."\)\)/,
    "Combined slippage mismatch and high-slippage cases do not render both truthful warnings.");

  /* Grouped amounts are for the eye only. `scaleRawAmount` inserts thousands
     separators, `parseHumanAmount` refuses a comma and `Number` returns NaN
     for one — so anything read back into the amount field or into arithmetic
     goes through `plainAmount`. The rate line printed "NaN" and flip stopped
     quoting the first time a leg crossed a thousand. */
  assert.match(card, /function plainAmount/, "The ungrouped amount helper is gone; grouped values will reach parsing again.");
  assert.ok(!/setAmount\(scaleRawAmount/.test(card), "A grouped amount is being written back into the amount field.");
  assert.ok(!/Number\(scaleRawAmount/.test(card), "A grouped amount is being read as a number, which is NaN above 999.");

  /* Freshness is on the card and binding: a live countdown off the Review
     window, and an expired quote cannot reach a signature. */
  assert.match(card, /Date\.parse\(quote\.expiresAt\)/, "Freshness is no longer read from the Review window.");
  assert.match(card, /const fresh = quote !== null && Date\.parse\(quote\.expiresAt\) > Date\.now\(\)/, "Freshness must belong to the current matching quote.");
  assert.match(card, /Refresh quote/, "An expired quote has no explicit new-order recovery.");
  assert.match(card, /setRefreshTicket/, "Asking again is not a control; it needs an edit to the amount.");

  /* The signature is over bytes fetched at the moment of the click and checked
     back after the wallet returns them. */
  assert.match(card, /"\/api\/solana\/swap\/order"/, "The signature no longer runs on a freshly built order.");
  assert.match(card, /inspectJupiterSwapTransaction/, "The returned bytes are no longer inspected.");

  /* Byte equality was the rule, and it made every swap fail after the approval:
     Wallet Standard models browser signers as transaction-MODIFYING, and the
     wallet this product is used with re-prices the compute budget and attaches
     its own guards. The rule is now the Send path's comparator — bounded,
     recognised additions only — and everything else is still refused, still
     with the difference named rather than asserted. */
  assert.match(card, /assessSwapWalletAdoption/, "The card no longer judges a modifying wallet against the shared comparator.");
  assert.match(card, /setBytesChanged\(true\)/, "A wallet that changes the transaction is no longer refused.");
  assert.match(
    card,
    /reviewedTransactionBase64: prepared\.order\.transactionBase64/,
    "The server can no longer compare against the bytes that were actually reviewed.",
  );

  assert.match(adapter, /https:\/\/api\.jup\.ag\/swap\/v2/);
  assert.match(adapter, /method:\s*"GET"/);
  /* 2026-08-30: the adapter's execute path exists now — behind the activated
     canary row, not silently. What this guard pins instead is the execute
     DISCIPLINE: one shot, every post-send failure marked possibly
     submitted, recovery by signature and never a second execute; and the
     /build submission lane (tx.jup.ag) stays absent until /order+/execute has
     an owner-canary Receipt. */
  assert.match(adapter, /\/execute/, "M2's outbound adapter must carry the execute path.");
  assert.match(adapter, /possiblySubmitted/, "The execute client must mark post-send failures as possibly submitted.");
  assert.match(adapter, /[Nn]ever execute again/, "The execute client must state the no-second-execute rule.");
  assert.ok(!/tx\.jup\.ag/.test(adapter), "The /build submission lane stays closed until the swap canary Receipt exists.");

  /* The verdict is about the asset, not about a person: the route judges the
     output mint through two neutral stand-ins rather than a self-transfer the
     preflight would refuse. */
  assert.match(route, /const ANY_RECIPIENT/, "The quote route still evaluates policy through a self-transfer that preflight refuses.");
  assert.match(route, /sender: ANY_HOLDER/);
  assert.match(route, /recipient: ANY_RECIPIENT/);
});

test("M2 keeps exact Review, wallet approval and submit ambiguity as three separate states", () => {
  const card = stripJs(read(join(WORKSPACE, "trade", "swap-card.tsx")));
  /* Each route admits and answers; between them the swap's steps of the core
     pipeline and its shared safety chain run, so the path is read whole. */
  const orderRoute = stripJs([join("lib", "core", "solana-swap", "prepare.ts"), join("lib", "core", "solana-swap", "guard.ts"), join("app", "api", "solana", "swap", "order", "route.ts")].map(read).join("\n"));
  const executeRoute = stripJs([join("lib", "core", "solana-swap", "guard.ts"), join("lib", "core", "solana-swap", "settle.ts"), join("app", "api", "solana", "swap", "execute", "route.ts")].map(read).join("\n"));

  /* A server verdict is not display-only. Signable bytes leave `/order` only
     when every non-human rule passes and the sole remaining step is the
     person's visible approval. Removing this call reopens PAUSE/BLOCK before
     the wallet even if the browser is later fixed. */
  assert.match(orderRoute, /assessSwapClientReview/, "The order route releases bytes without the shared pre-sign assessment.");
  assert.match(orderRoute, /SWAP_PRE_SIGN_REFUSED/, "A blocking swap-policy verdict is returned with signable bytes.");
  assert.match(orderRoute, /evaluateSwapPolicy/, "The order route releases bytes without judging them against the swap policy.");
  assert.match(orderRoute, /PROOF_NOT_SIGNED/, "An unsigned execution proof can still reach the wallet.");
  /* The admin session is gone on purpose. It was never a capability check —
     `lib/session.ts` reads a Telegram cookie — and it made a swap of a
     person's own funds impossible for anyone but the admin, expiring after a
     day even for the admin. What replaced it is a real operator control that fails
     closed, plus the same-origin gate, which is CSRF and stays. */
  assert.ok(!/getAdminSession/.test(orderRoute), "A swap of a person's own funds requires a Ryntra admin login.");
  assert.match(orderRoute, /resolveSolanaLaneState\("SWAP"\)/, "The order route has no operator stop at all.");
  assert.match(orderRoute, /SWAP_PAUSED/, "A paused swap lane does not refuse before the wallet.");
  assert.match(orderRoute, /readSwapCarrier\(request, "/, "The order route has no same-origin gate.");
  assert.match(executeRoute, /resolveSolanaLaneState\("SWAP"\)/, "A Review issued before a pause stays submittable.");
  assert.match(orderRoute, /reserveSwapOwnerReview/, "A second tab can receive a second M2 requestId for the same owner.");
  assert.match(executeRoute, /claimSwapOwnerSignature/, "The wallet signature is not bound into the durable owner lock before submit.");
  assert.match(executeRoute, /markSwapOwnerSubmitted/, "The provider call can start without the durable owner lock crossing submit-unknown.");

  /* Quote A cannot be the authorization for executable order B. The first
     action asks for B and renders it; only a second distinct action signs the
     stored bytes. */
  assert.match(card, /const requestExactReview/, "The card has no separate exact-order Review action.");
  assert.match(card, /setPhase\("REVIEW"\)/, "The freshly built order is not held in a rendered Review state.");
  assert.match(card, /const signReviewedOrder/, "The wallet call is not isolated behind the rendered Review.");
  assert.match(card, /Review swap/, "The first action still claims to execute instead of preparing Review.");
  /* The label is the second action; what matters is that it exists, is
     distinct from the first, and opens the wallet on nothing but the stored
     reviewed bytes. Pinning one phrasing of it only pinned the phrasing. */
  assert.match(card, /ctaLabel = text\("Confirm in wallet"\)/, "The second human action is missing from the exact Review.");

  /* A signature is durable client evidence before the execute fetch starts.
     Any lost/unreadable answer transitions to recovery for that signature and
     locks a new order, rather than falling back to IDLE. */
  const persist = card.indexOf("sessionStorage.setItem");
  const execute = card.indexOf('post<ExecuteResponse>("/api/solana/swap/execute"');
  assert.ok(persist >= 0 && execute > persist, "The execute request can leave before its signature is persisted.");
  assert.match(card, /transitionSwapClientAttempt/, "Execute ambiguity is not classified by the signed-attempt state machine.");

  /* A signature the server refused BEFORE it claimed anything never reached
     the network, and keeping it locked the wallet behind a recovery that could
     only answer 409. The server says which side of the submit boundary a
     refusal falls on, and the card releases only on that word. */
  const executeSource = stripJs(read(join("app", "api", "solana", "swap", "execute", "route.ts")));
  assert.match(executeSource, /refuseBeforeSubmit/, "Pre-submit refusals no longer say the network never saw the bytes.");
  assert.match(executeSource, /submitBoundary: "NOT_CROSSED"/, "The submit-boundary marker is gone from the refusal body.");
  assert.match(
    card,
    /submitBoundary === "NOT_CROSSED"/,
    "The card keeps an attempt the server proved was never submitted.",
  );

  /* And a signature this server never recorded is settled by the chain rather
     than by a permanent refusal. */
  const recoverRoute = stripJs(read(join("app", "api", "solana", "swap", "recover", "route.ts")));
  assert.match(recoverRoute, /UNKNOWN_TO_CHAIN/, "An unrecorded signature has no chain-read escape.");
  assert.match(recoverRoute, /readSignatureStatus/, "The unrecorded-signature path does not read the chain.");
  assert.match(card, /UNKNOWN_TO_CHAIN/, "The card cannot release a signature the chain never saw.");
  assert.match(card, /RECOVERY_DEADLINE_MS/, "Recovery makes the person press the button instead of waiting for them.");
  assert.match(card, /SUBMITTED_UNKNOWN/, "A lost execute answer has no locked recovery state.");

  /* And a broadcast the whole ledger never saw, past the block that could have
     carried it, is settled rather than pending forever. Without a terminal
     state on that side of the boundary the wallet stays locked for good. */
  const recovery = stripJs(read(join("lib", "solana", "swap-recovery.ts")));
  assert.match(recovery, /EXPIRED_AFTER_SUBMIT/, "An unseen broadcast past its block has no terminal state.");
  assert.match(recovery, /readLandingWindow/, "Recovery closes on a single blockhash read with no second answer.");
  const attempts = stripJs(read(join("lib", "solana", "send-attempt.ts")));
  assert.match(
    attempts,
    /record\.state === "SUBMITTED_UNKNOWN"[\s\S]{0,200}record\.state === "RECOVERY_REQUIRED"[\s\S]{0,200}record\.state === "EXPIRED_AFTER_SUBMIT"/,
    "EXPIRED_AFTER_SUBMIT must be reached only from a crossed boundary or idempotently from itself.",
  );
  assert.match(card, /EXPIRED_AFTER_SUBMIT/, "The card cannot end a stranded broadcast.");
});

test("Swap constrains its implicit grid track inside the workspace panel", () => {
  const css = read(join(WORKSPACE, "trade", "swap-card.module.css"));
  assert.match(
    css,
    /\.card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    "The quote-expiry control can widen the card past its clipped workspace panel.",
  );

  const cardRule = /\.card\s*\{([^}]*)\}/s.exec(stripCss(css))?.[1] ?? "";
  const maxWidth = Number(/max-width:\s*(\d+)px/.exec(cardRule)?.[1]);
  assert.ok(
    Number.isFinite(maxWidth) && maxWidth >= 560 && maxWidth <= 720,
    `The desktop Swap interaction measure is ${maxWidth || "unbounded"}px; keep it between 560px and 720px.`,
  );
  assert.match(cardRule, /margin-inline:\s*auto/, "The focused Swap ticket is not centred inside its full-width workspace panel.");
});

test("Swap keeps one accessible page heading and the workspace mobile interaction floor", () => {
  const page = read(join(WORKSPACE, "swap", "page.tsx"));
  const card = read(join(WORKSPACE, "trade", "swap-card.tsx"));
  const css = stripCss(read(join(WORKSPACE, "trade", "swap-card.module.css")));

  /* The H1 is `PageHead`'s now, and it is visible: it names the page a person
     is standing in. It was `sr-only` while the page was one panel whose own
     header already said `Swap` — two identical headings stacked is a defect
     this product has already had to repair once, and the fix is to name
     different things rather than to hide one of them. */
  assert.match(page, /<PageHead title="Swap" \/>/,
    "Swap is the only routed Solana page without an H1 for document navigation, and its H1 must name the page.");
  assert.ok(!/<h1/.test(page), "The Swap page writes its own H1 beside the one PageHead renders.");
  assert.match(card, /h=\{tall \? 8 : 6\}/,
    "The Swap ticket reserves rows it has nothing to put in.");

  const mobileStart = css.indexOf("@media (max-width: 620px)");
  assert.ok(mobileStart >= 0, "Swap has no mobile rules at its supported phone breakpoint.");
  const mobile = css.slice(mobileStart);
  const declarationsFor = (selector) =>
    [...mobile.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(([, selectors]) => selectors.split(",").some((value) => value.trim() === `.${selector}`))?.[2] ?? "";
  for (const selector of ["tokenPill", "shareButton", "refreshButton"]) {
    assert.match(declarationsFor(selector), /min-height:\s*44px/,
      `${selector} falls below the workspace 44px mobile touch floor.`);
  }
  assert.match(declarationsFor("flipButton"), /width:\s*44px[\s\S]*height:\s*44px/,
    "The pair-flip control falls below the workspace 44px mobile touch floor.");

  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/,
    "Swap animations ignore the user's reduced-motion preference.");
});

test("Swap is full-width, clean, and leaves technical evidence to the Receipt", () => {
  const modules = read(join(WORKSPACE, "hub", "modules.ts"));
  const page = read(join(WORKSPACE, "swap", "page.tsx"));
  const legacy = read(join(WORKSPACE, "trade", "page.tsx"));
  const card = read(join(WORKSPACE, "trade", "swap-card.tsx"));

  assert.match(modules, /id:\s*"trade"[\s\S]*?label:\s*"Swap"[\s\S]*?route:\s*`\$\{BASE\}\/swap`/);
  assert.ok(!/lead=/.test(page), "The customer Swap still opens with an explanatory header or info essay.");
  assert.match(legacy, /permanentRedirect/);
  /* Four columns, not twelve. The ticket keeps the whole canvas to itself no
     longer: the panels beside it read the same order it would sign, and the
     card's own engine is untouched by any of them. */
  assert.match(card, /id="trade-swap"[\s\S]*?w=\{4\}/);
  assert.match(card, /<SwapContext[\s\S]{0,200}facts=\{contextFacts\}/,
    "The Swap ticket no longer hands its own order to the panels beside it.");
  assert.ok(!/id="trade-asset-review"/.test(card), "Asset evidence still owns a second workspace panel.");
  assert.ok(!/<details|Every rule and its evidence|Default pair · not a recommendation/.test(card), "The Swap still prints a technical cheat sheet.");
  assert.ok(!/className=\{styles\.errorCode\}|Recover by signature/.test(card), "Raw codes or recovery vocabulary still leak into the customer flow.");
  assert.ok(!/\{secondsLeft\}s/.test(card), "The quote countdown still competes with the action.");
  assert.match(card, /Receipt JSON|Receipt/, "A completed swap no longer exposes its Receipt.");
  assert.match(card, /storeBoundSolanaReceipt/, "A settled Swap Receipt never reaches the wallet-bound Solana receipt journal.");
  assert.match(card, /href="\/app\/receipts"/, "A settled swap has no direct handoff to Receipts.");
  assert.match(card, /recordSettlement\(executed\.value,\s*connection\.address\)/,
    "Direct settlement is not bound to the wallet that signed it.");
  const recoverySource = card.slice(card.indexOf("const recoverAttempt"));
  assert.equal(
    (recoverySource.match(/recordSettlement\(\{/g) ?? []).length,
    3,
    "The three recovery result branches are not all routed through the wallet-bound settlement helper.",
  );
  assert.equal(
    (recoverySource.match(/\},\s*attempt\.taker\);/g) ?? []).length,
    3,
    "Recovered receipts must bind to attempt.taker even while another wallet is connected or none is connected.",
  );
});

test("Send and Receipts keep the working-product journey customer-first", () => {
  const send = read(join(WORKSPACE, "send", "send-card.tsx"));
  const catalog = read(join(WORKSPACE, "i18n", "catalog.ts"));
  const receipts = read(join(WORKSPACE, "receipts", "page.tsx"));

  /* One panel, the width of the canvas, the way Swap is. The two-panel desk
     this replaced put a compose form beside a Review rail that had nothing in
     it until both were filled, so a disconnected wallet rendered a narrow inert
     form beside a dead column. */
  assert.match(send, /<Panel[\s\S]{0,120}id="send-transfer"[\s\S]{0,200}w=\{4\}/,
    "The Send ticket is not the domain's four-column card.");
  assert.match(send, /<MoneyContext span=\{transferRows\} holdings=\{holdings\} \/>/,
    "Send does not mount the Money domain beside its ticket, or makes it read balances a second time.");
  /* One balance read per page. `/api/solana/holdings` was measured at 46.5s on
     production against 1.7s for the same wallet's activity, so a panel asking
     again is not a rounding error. The card that already asked hands it over. */
  assert.equal((send.match(/api\/solana\/holdings/g) ?? []).length, 1,
    "Send reads holdings more than once for one page.");
  assert.ok(!/<Panel id="send-review"/.test(send),
    "Send renders a prerequisite-error Review panel before a wallet or asset exists.");
  assert.match(send, /const transferRows = plan \? \(warnings\.length >= 3 \? 7 : 6\) : settled \? 6 : 5;/,
    "The Send panel reserves rows it has nothing to put in.");
  assert.match(send, /className=\{styles\.cta\}/,
    "The single full-width action is gone; Send is back to scattered buttons.");
  assert.match(catalog, /"Wallet":\s*"Гаманець"/,
    "The primary Ukrainian mobile wallet action falls back to English.");

  /* Bridge stopped being a five-panel read-only preview when it gained an
     execution path. It is now one card in Send's shape: the journey and one
     next action in Simple, the evidence behind Pro. */
  const bridgeCard = read(join(WORKSPACE, "bridge", "bridge-card.tsx"));
  assert.match(bridgeCard, /<Panel[\s\S]{0,120}id="bridge-transfer"[\s\S]{0,200}w=\{4\}/,
    "The Bridge ticket is not the domain's four-column card.");
  assert.match(bridgeCard, /className=\{styles\.cta\}/,
    "Bridge lost its single full-width action.");
  assert.match(bridgeCard, /id="bridge-evidence"[\s\S]{0,400}advanced/,
    "Bridge evidence is not held behind Pro.");
  assert.ok(!/styles\.technical/.test(bridgeCard),
    "The sixteen-row technical disclosure is back on Bridge.");
  assert.match(bridgeCard, /aria-describedby=\{recipient\.length > 0 && !recipientValid/,
    "Bridge does not associate an invalid recipient with its control.");
/* The transfer no longer has a page to head; it is a card inside Swap.
     What the page contributed to this rule — no lead paragraph, no second H1 —
     is now Swap's, and `bridge.test.mjs` owns the card's own shape. */
  
  /* The three recorded canary receipts and the Agent Control projection are
     gone from this page. They belonged to one wallet and were rendered in full
     to every visitor as worked examples — amounts, counterparties, signatures.
     Somebody else's transaction history is not example copy. They remain in the
     task evidence, which is where they were always the record. */
  for (const gone of [
    'id="solana-receipt-m1"',
    'id="solana-receipt-m1b"',
    'id="solana-receipt-m2"',
    'id="solana-agent-control-projection"',
  ]) {
    assert.ok(!receipts.includes(gone), `Receipts still shows one wallet's private history to everyone: ${gone}`);
  }
  /* The archive block behind the account switch is a prop, not a second
     list. */
  assert.match(receipts, /<LocalReceiptList\s+filter=\{filter\}(?:\s+archiveOn=\{accountLoginEnabled\(\)\})?\s*\/>/,
    "Receipts ignores the browser-local artifacts created by Send and Swap.");
  /* The recorded canary receipts moved off the customer Receipts page — they
     were one wallet's private history rendered to every visitor as worked
     examples. They are still the record, and they are still verifiable: the
     artifacts live with the evidence records and the recorded-run projections
     below are still asserted against them. What is no longer asserted is that
     a stranger can read them on a product page. */
});

test("the asset picker is race-safe, keyboard-modal, and customer-readable", () => {
  const card = read(join(WORKSPACE, "trade", "swap-card.tsx"));
  assert.match(card, /const searchTicket = useRef\(0\)/, "Older token searches can overwrite the current query.");
  assert.match(card, /const my = \+\+searchTicket\.current[\s\S]*searchTicket\.current !== my[\s\S]*setSearchRows/,
    "Search results are committed without a request-generation check.");

  for (const contract of ["pickerDialogRef", 'event.key === "Escape"', 'event.key !== "Tab"', "querySelectorAll", "trigger.focus"] ) {
    assert.match(card, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Picker modal is missing ${contract}.`);
  }

  const picker = card.slice(card.indexOf("{picker ?"));
  assert.ok(!/label\.program/.test(picker), "The customer picker prints token-program internals.");
  assert.match(picker, /title=\{text\("Verified by Jupiter"\)\}/, "Verification must name its source.");
  assert.match(picker, /title=\{text\("Flagged by Jupiter"\)\}/, "A suspicious-token warning must name its source.");
});

test("M2 recovery is a read-only signature path and cannot submit bytes", () => {
  const card = stripJs(read(join(WORKSPACE, "trade", "swap-card.tsx")));
  const executeRoute = stripJs([join("lib", "core", "solana-swap", "guard.ts"), join("lib", "core", "solana-swap", "settle.ts"), join("app", "api", "solana", "swap", "execute", "route.ts")].map(read).join("\n"));
  const recoveryPath = join("app", "api", "solana", "swap", "recover", "route.ts");
  assert.ok(existsSync(recoveryPath), "The unknown swap has no dedicated recovery endpoint.");
  const recovery = stripJs(read(recoveryPath));
  assert.match(recovery, /recoverSwapOutcome/, "The endpoint does not run the bound independent recovery lifecycle.");
  assert.match(recovery, /readSwapOwnerRecovery/, "Recovery still trusts a browser-supplied bundle instead of the durable server record.");
  assert.ok(!/executeJupiterOrder|signedTransactionBase64|\/execute/.test(recovery), "Recovery can reach submission or accepts signed bytes.");
  assert.match(card, /"\/api\/solana\/swap\/recover"/, "The locked card cannot ask for an independent read by signature.");
  assert.match(
    executeRoute,
    /messageDigest:\s*`0x\$\{bundle\.inspection\.messageHashHex\}`/,
    "The 64-byte message hash is not normalized into the durable ledger's 0x digest domain.",
  );
});

test("unclaimed Review cancellation is exact-blockhash-gated and reachable by the wallet that owns it", () => {
  const cancelPath = join("app", "api", "solana", "swap", "cancel-review", "route.ts");
  assert.ok(existsSync(cancelPath), "An ordinary cancelled wallet prompt permanently bricks the swap lane.");
  const cancel = stripJs(read(cancelPath));
  /* No admin session, and deliberately no lane stop either: a person whose
     wallet prompt was dismissed must be able to clear their own unclaimed
     Review even while an operator has the lane closed, or a pause would strand
     them behind a lock they cannot release. What keeps it narrow is that only
     an issued, unsigned Review naming its exact requestId can be cancelled,
     against an independently proven-dead blockhash. */
  assert.ok(!/getAdminSession/.test(cancel), "Clearing your own stuck Review requires a Ryntra admin login.");
  assert.ok(!/resolveSolanaLaneState/.test(cancel), "A paused lane strands a wallet behind its own unclaimed Review.");
  assert.match(cancel, /readSwapCarrier\(request, "/, "The cancellation route has no same-origin gate.");
  assert.match(cancel, /isBlockhashValid/, "Cancellation uses time instead of the exact stored blockhash.");
  assert.match(cancel, /expireUnclaimedSwapOwnerReview/, "The exact durable Review is not transitioned by CAS.");
  assert.ok(!/executeJupiterOrder|signedTransaction|\/execute/.test(cancel), "Review cancellation can reach transaction submission.");
});

test("History shows four words a person knows and none a lane speaks", () => {
  /* The three lanes speak twenty-eight states between them. Not one belongs on
     a screen a customer reads, and the collapse into four outcomes happens in
     `lib/solana/action-ledger.ts` — so this surface must contain no lane
     vocabulary at all. The check is on the source with comments stripped,
     because the file explains the rule it obeys. */
  const card = stripJs(read(join(WORKSPACE, "history", "history-card.tsx")));

  for (const laneWord of [
    "SUBMITTED_UNKNOWN",
    "EXPIRED_AFTER_SUBMIT",
    "EXPIRED_BEFORE_SUBMIT",
    "RECOVERY_REQUIRED",
    "BURN_CONFIRMED",
    "MINT_OBSERVED",
    "ATTESTED",
    "REVIEW_ISSUED",
    "intentDigest",
    "messageDigest",
    "reviewDigest",
  ]) {
    assert.ok(!card.includes(laneWord), `History renders the lane word "${laneWord}"; that vocabulary stops at the ledger.`);
  }

  /* Every outcome gets its own sentence. The one that matters is IN_FLIGHT:
     rounding an unresolved transfer to either success or failure is the single
     most expensive thing this screen could say. */
  for (const word of ["Arrived", "Did not happen", "Needs you", "On its way"]) {
    assert.ok(card.includes(word), `History has no word for one of its four outcomes: "${word}".`);
  }

  /* Coverage is stated, never implied. A history that does not say where it
     begins reads as a claim that nothing else ever happened. */
  assert.match(card, /Some activity could not be loaded/);

  /* Disconnected is the shared gate, not a fifth hand-rolled connect block. */
  assert.match(card, /<WalletGate/);

  /* An amount is shown only when its scale is known. The swap lane stores no
     decimals anywhere in this product, and printing a number against an
     unknown scale is the same defect class as pricing an unpriced asset at
     zero. */
  assert.match(card, /if \(movement\.decimals === null\) return name;/);
});

test("the history route reads by address, on the read budget, and holds no session", () => {
  const route = stripJs(read(join("app", "api", "solana", "activity", "route.ts")));

  /* Public by address, exactly as Holdings is: anybody can put an address into
     an explorer, so a signature gate over public chain facts is theatre. */
  assert.match(route, /consumeSolanaReadRequest/, "The history read must sit on the read limiter, not the mutating one.");
  assert.ok(!route.includes("getSession"), "A public-by-address read must not take a session.");

  /* State is never trusted from the index. A bridge burned yesterday would say
     "on its way" forever if nothing re-read the lane that owns it. */
  assert.match(route, /readCctpBurnClaim/);
  assert.match(route, /readSendAttempt/);
  assert.match(route, /bridgeOutcome/);
  assert.match(route, /sendOutcome/);

  /* Bounded: one page load may not become one store read per lifetime row. */
  assert.match(route, /ENRICHMENT_LIMIT/);
});

test("the Developers page names exactly the schema files that exist", { skip: needsDevelopmentRepository("the published schema files under docs/solana/schemas/") }, () => {
  const page = stripJs(read(join(WORKSPACE, "developers", "page.tsx")));
  const named = [...page.matchAll(/"([a-z0-9-]+\.schema\.json)"/g)].map(([, file]) => file);
  assert.ok(named.length >= 4, `Expected the four published schemas, found ${named.length}.`);

  for (const file of named) {
    assert.ok(existsSync(join("docs", "solana", "schemas", file)), `${file} is named on the page and missing on disk.`);
  }

  const onDisk = readdirSync(join("docs", "solana", "schemas")).filter((file) => file.endsWith(".schema.json"));
  assert.deepEqual([...named].sort(), onDisk.sort(), "The page's schema list and the directory disagree.");
});

// ---------------------------------------------------------------- claims --

test("no Solana surface uses a forbidden claim shape", () => {
  /* The CI-wide FORBIDDEN scan covers app/solana since A4; this local copy
     exists so the suite fails at the desk before a push. Phrase shapes only —
     a sentence *quoting* the word "safe" to state a limit is exactly the
     honest case the A3 verdict test protects, so bare words are not matched. */
  const forbidden =
    /first-ever|no competitors|guaranteed safe|transaction is safe|institutional-grade|fully compliant|production-ready|risk[- ]free|mainnet live/i;

  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    assert.ok(!forbidden.test(source), `${path} carries a forbidden claim shape.`);
  }
});
