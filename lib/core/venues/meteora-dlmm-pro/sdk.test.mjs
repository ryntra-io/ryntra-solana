// What the DLMM Pro venue stands on, and that it stands closed.
//
// The program is a beta whose interface Meteora may still break, so the SDK is pinned to one exact version and this
// file holds the pin to what is installed. And the venue is in the engine only: nothing a person can reach imports it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { DLMM_PRO_PROGRAM_ID, DlmmProIDL, PoolErrorCode } from "@meteora-ag/dlmm-pro-sdk";
import { Connection } from "@solana/web3.js";

import { inDevelopmentRepository } from "../../../development-repository.mjs";

const { DLMM_PRO_ACCESS_REGISTRY, DLMM_PRO_PROGRAM, DLMM_PRO_PROGRAM_VERSION, DLMM_PRO_SDK_VERSION, DlmmProRefusal, accountDiscriminator, dlmmProClientOf, dlmmProErrorName, dlmmProIdlVersion, refusalOf } = await import("./sdk.server.ts");
const { DLMM_PRO_CAPABILITIES, DLMM_PRO_EARN_ON_MAINNET, DLMM_PRO_LIMITS_MAINNET, DLMM_PRO_OPEN_TO_PEOPLE, DLMM_PRO_STATE } = await import("./gate.ts");
const { earnProGate } = await import("../../../earn-pro/gate.ts");
const { CAPABILITY_REGISTRY, resolveCapabilityState } = await import("../../capabilities.ts");
const { SWAP_USER_INDEX } = await import("./events.server.ts");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const require = createRequire(import.meta.url);
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");

test("the SDK is pinned to one exact version, and it is the one installed", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.dependencies["@meteora-ag/dlmm-pro-sdk"], DLMM_PRO_SDK_VERSION, "no range: a beta is upgraded on purpose, with the changelog read and the rehearsal run");
  assert.equal(require("@meteora-ag/dlmm-pro-sdk/package.json").version, DLMM_PRO_SDK_VERSION);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages["node_modules/@meteora-ag/dlmm-pro-sdk"].version, DLMM_PRO_SDK_VERSION);
  assert.match(lock.packages["node_modules/@meteora-ag/dlmm-pro-sdk"].integrity, /^sha512-/);
  /* And it is installed under no other name: an alias of it would be imported past the guard below, which knows the package by its own. */
  for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "resolutions"]) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      if (name !== "@meteora-ag/dlmm-pro-sdk") assert.ok(!name.includes("dlmm-pro-sdk") && !JSON.stringify(version).includes("dlmm-pro-sdk"), `${group}: ${name}`);
    }
  }
});

test("the program is the one Meteora deployed, at the release the IDL describes", () => {
  assert.equal(DLMM_PRO_PROGRAM, "dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n");
  assert.equal(DLMM_PRO_PROGRAM, DLMM_PRO_PROGRAM_ID.toBase58());
  assert.equal(DLMM_PRO_ACCESS_REGISTRY, "regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr");
  assert.equal(dlmmProIdlVersion(), DLMM_PRO_PROGRAM_VERSION);
  /* What a search and a decode stand on: the accounts' first eight bytes, as the program's documentation lists them. */
  assert.equal(Buffer.from(accountDiscriminator("Pool")).toString("hex"), "f19a6d0411b16dbc");
  assert.equal(Buffer.from(accountDiscriminator("PositionArray")).toString("hex"), "bf7fb653f015fda0");
  assert.equal(Buffer.from(accountDiscriminator("LimitOrder")).toString("hex"), "89b7d45b731d8de3");
  assert.equal(Buffer.from(accountDiscriminator("TickArray")).toString("hex"), "4561bdbe6e0742bb");
  /* A swap's trader is read from the swap instruction's own accounts: the signer, where the IDL puts it. */
  const swap = DlmmProIDL.instructions.find((instruction) => instruction.name === "swap");
  assert.equal(swap.accounts[SWAP_USER_INDEX].name, "user");
  assert.equal(swap.accounts[SWAP_USER_INDEX].signer, true);
  assert.equal(swap.accounts[7].name, "referral");
  /* The release has 39 instructions a caller may send and 31 events; a change of either is a change to read. */
  assert.equal(DlmmProIDL.instructions.filter((instruction) => instruction.name !== "for_idl_type_generation_do_not_call").length, 39);
  assert.equal(DlmmProIDL.events.length, 31);
  assert.equal(DlmmProIDL.errors.length, 51);
});

test("one client per connection", () => {
  const connection = new Connection("http://127.0.0.1:9");
  assert.equal(dlmmProClientOf(connection), dlmmProClientOf(connection));
  assert.notEqual(dlmmProClientOf(connection), dlmmProClientOf(new Connection("http://127.0.0.1:9")));
  assert.equal(dlmmProClientOf(connection).commitment, "confirmed");
});

test("what the SDK refuses reads as a refusal with the program's own number", () => {
  assert.equal(dlmmProErrorName(6040), "InvalidActivationAccess");
  assert.equal(dlmmProErrorName(6020), "NotConsumingFullAmountIn");
  assert.equal(dlmmProErrorName(7000), null);
  const sdkError = (code, message) => Object.assign(new Error(message), { name: "PoolError", code });
  assert.deepEqual({ ...pick(refusalOf(sdkError(PoolErrorCode.InvalidActivationAccess, "Invalid activation access"))) }, { code: "NOT_OPEN", program: 6040 });
  assert.deepEqual({ ...pick(refusalOf(sdkError(PoolErrorCode.LiquidityIsZero, "Liquidity is zero"))) }, { code: "NO_LIQUIDITY", program: 6023 });
  assert.deepEqual({ ...pick(refusalOf(sdkError(PoolErrorCode.AmountIsZero, "Amount is zero"))) }, { code: "AMOUNT_ZERO", program: 6039 });
  assert.deepEqual({ ...pick(refusalOf(sdkError(PoolErrorCode.MathOverflow, "Math operation overflow"))) }, { code: "FAILED", program: 6000 });
  assert.deepEqual({ ...pick(refusalOf(new Error("socket hang up"))) }, { code: "FAILED", program: null });
  const own = new DlmmProRefusal("BALANCE_LOW", "The wallet does not hold that much.");
  assert.equal(refusalOf(own), own, "a refusal passes through as it is");
});
const pick = (refusal) => ({ code: refusal.code, program: refusal.program });

test("the venue is closed to people: a constant, and the registry's four rows read BUILDING whatever a deployment sets", () => {
  assert.equal(DLMM_PRO_OPEN_TO_PEOPLE, false);
  /* Limit orders have a gate of their own. */
  assert.equal(DLMM_PRO_LIMITS_MAINNET, false);
  assert.deepEqual({ ...DLMM_PRO_STATE }, { venue: "meteora-dlmm-pro", state: "BUILDING", openToPeople: false, network: "none", rehearsed: "LiteSVM, the program's own binary; no mainnet write" });
  const rows = CAPABILITY_REGISTRY.filter((row) => row.venue === "meteora-dlmm-pro");
  assert.deepEqual(rows.map((row) => row.capability).sort(), [...DLMM_PRO_CAPABILITIES].sort());
  const everyLaneOpen = new Proxy({}, { get: () => "OPEN", has: () => true });
  for (const row of rows) {
    assert.equal(row.network, "solana");
    assert.equal(row.state, "BUILDING");
    assert.equal(resolveCapabilityState(row, everyLaneOpen), "BUILDING", "no switch of a deployment opens it");
    /* Were a row marked live by mistake, it still names no lane a deployment could open: it would read as paused. */
    assert.equal(resolveCapabilityState({ ...row, state: "LIVE" }, everyLaneOpen), "PAUSED");
    assert.equal(row.lane, null);
    assert.equal(row.pipeline, null);
    assert.deepEqual(row.authority, [], "no action of a person's is routed to it");
    assert.deepEqual(row.fee, { kind: "NOT_SET" });
  }
});

test("earning on DLMM Pro is served on devnet where a deployment asks, and on mainnet only by a constant in code that no deployment flips", () => {
  assert.equal(DLMM_PRO_EARN_ON_MAINNET, false);
  assert.deepEqual(earnProGate({}), { open: false, reason: "closed" });
  assert.deepEqual(earnProGate({ RYNTRA_EARN_PRO: "open" }), { open: false, reason: "closed" });
  assert.deepEqual(earnProGate({ RYNTRA_EARN_PRO: "devnet" }), { open: true, network: "devnet" });
  assert.deepEqual(earnProGate({ RYNTRA_EARN_PRO: " Mainnet " }), { open: false, reason: "owner-word" });
  assert.deepEqual(earnProGate({ RYNTRA_EARN_PRO: "mainnet" }, true), { open: true, network: "mainnet" });
  /* The venue itself stays as it was: its registry rows read BUILDING, and it is open to people nowhere by itself. */
  assert.equal(DLMM_PRO_OPEN_TO_PEOPLE, false);
});

const SCRIPT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** What is never source inside a source folder: what is installed, and the folders these build tools keep for themselves. A package's own built `dist` is read like source. */
const NOT_SOURCE_INSIDE = new Set(["node_modules", ".next", ".turbo", ".vercel", ".git", ".cache", ".expo", ".gradle", ".cxx", ".swc"]);

/**
 * Every script file under a directory, without what is installed and what the build tools keep for themselves. A
 * hidden folder inside a source folder is source like any other — `app/.well-known` holds routes people reach.
 */
function scriptsUnder(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (NOT_SOURCE_INSIDE.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SCRIPT.test(entry.name)) found.push(full);
    }
  };
  walk(directory);
  return found;
}

/**
 * The rehearsal's own files: the launch's, the limit orders' and earning's import
 * the venue, two more build the stand and its fixtures, the last fetches the program's bytes for them — and no route,
 * window or tool loads any of them.
 */
const REHEARSAL_FILES = ["dlmm-pro-rehearsal.mjs", "dlmm-pro-limits-rehearsal.mjs", "dlmm-pro-launch-rehearsal.mjs", "dlmm-pro-earn-rehearsal.mjs", "dlmm-pro-svm.mjs", "dlmm-pro-program.mjs", "dlmm-pro-fixtures.mjs"];
/**
 * The surfaces that stand on the venue: each is one folder — the only way to the venue for its routes, its window and
 * its agent — behind a gate of its own, held closed by a test of its own. Adding a folder here is opening the venue to
 * something a person can reach: it comes with that gate and that test, never alone.
 *
 * - `lib/pro-limits/` — limit orders. The gate is `lib/pro-limits/gate.ts`: closed unless a deployment names
 *   a network, and on mainnet closed whatever it names until `DLMM_PRO_LIMITS_MAINNET` is true. `lib/pro-limits/pro-limits.test.mjs` holds that closed, every way in answers the same refusal and reads,
 *   builds and signs nothing.
 * - `lib/launch-pool/` — a launch straight into a pool. The gate is `lib/launch-pool/gate.ts`: the devnet
 *   stand only, and on mainnet closed until `DLMM_PRO_LAUNCH_OWNER_WORD` is true.
 *   `lib/launch-pool/launch-pool.test.mjs` holds that closed: on mainnet nothing is built, sent or read.
 */
const SURFACES = ["lib/pro-limits/", "lib/launch-pool/"];
/**
 * A surface that opens the venue through named doors rather than a whole folder: what it may load the venue through
 * is its gate and its one door, file by file; everything else of it, its routes among it, reaches the venue only
 * through the door, which asks the gate.
 *
 * - earning and an agent's care: `lib/earn-pro/`; its gate holds mainnet closed until
 *   `DLMM_PRO_EARN_ON_MAINNET` is true.
 */
const SURFACE_DOORS = ["lib/earn-pro/gate.ts", "lib/earn-pro/venue.server.ts"];
/**
 * Those surfaces' own tests, which replay the venue's frozen moments through its fixture kit: test files only, and no
 * script names one — a test is run, never imported.
 */
const SURFACE_TESTS = ["lib/earn-pro/earn-pro.test.mjs"];
const REHEARSAL_NAMES = REHEARSAL_FILES.map((file) => file.replace(/\.mjs$/, ""));
/** A character a file's or a package's name goes on with. */
const NAME = /[\w.-]/;

/**
 * Whether a string names one of the rehearsal's files as a file, anywhere in it: the name with a script's extension;
 * or without one, where it stands in the rehearsal's folder or after a relative step — and nothing of a longer name on
 * either side. So a command line that runs one is found, and a word that only shares its name — an id in a list, the
 * end of a page's address — is not.
 */
const namesRehearsal = (text) =>
  REHEARSAL_NAMES.some((name) => {
    for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
      const before = text.slice(0, at);
      const rest = text.slice(at + name.length);
      const extension = /^\.(?:mjs|cjs|js|ts)/.exec(rest)?.[0] ?? "";
      if (NAME.test(rest.slice(extension.length, extension.length + 1))) continue;
      if (extension !== "" ? !NAME.test(before.slice(-1)) || before.endsWith("/") : /(?:^|\/)(?:launch-qa|\.{1,2})\/$/.test(before)) return true;
    }
    return false;
  });

/**
 * Whether a string names the venue as something to load — wherever the string stands, whatever it is handed to, and
 * wherever in the string the name is:
 *
 * - its SDK's package, alone or with a path inside it;
 * - a path into the venue's folder; or to the folder itself, from the folder the venues live in or after a relative step;
 * - one of the rehearsal's files.
 *
 * A string that is a web address loads nothing. The venue's bare id is not a path: a registry's row names it as data,
 * and a page's own address may end in it.
 */
const namesVenue = (text) =>
  !/^https?:\/\//.test(text) &&
  (/(?:^|[^\w.-])@meteora-ag\/dlmm-pro-sdk(?![\w-])/.test(text) || /(?:^|\/)meteora-dlmm-pro\//.test(text) || /(?:^|\/)(?:venues|\.{1,2})\/meteora-dlmm-pro(?![\w.-])/.test(text) || namesRehearsal(text));
/** Where the tree shows a module being named — an import, an export, a `require` — the venue's id alone names it too: an alias would resolve it. */
const namesVenueModule = (specifier) => specifier === "meteora-dlmm-pro" || namesVenue(specifier);
/** Whether a string holds a part of the SDK's name or of the rehearsal files' — enough, beside a module loaded by a name that is not written whole. The venue's id alone is not: it is data wherever a registry is read. */
const mentionsVenue = (text) => text.includes("dlmm-pro-") || text.includes("-pro-sdk");
/** The folder the venues live in, from the repository's root. */
const VENUES = "lib/core/venues";
/** Where `venues` stands in a path's parts as that folder may be written: with `core` before it — or with no folder named before it at all. Another `venues` folder, under another one, is not it. */
const venuesAt = (parts) => parts.findIndex((part, at) => part === "venues" && (at === 0 || parts[at - 1] === "core" || parts[at - 1] === ""));
/**
 * A written part of a path as its parts, and where among them the folder the venues live in stands (-1 — nowhere). A
 * part that begins with a relative step is read from the folder of the file it stands in (`name`) — and, where that
 * lands elsewhere, as written after its steps, with `core` before the folder; any other by how it writes the folder.
 */
const venuesIn = (piece, name) => {
  if (!/^\.{1,2}(?:\/|$)/.test(piece)) {
    const parts = piece.replace(/\/$/, "").split("/");
    return { parts, at: venuesAt(parts) };
  }
  const parts = path.posix.normalize(path.posix.join(path.posix.dirname(name.replaceAll("\\", "/")), piece)).replace(/\/$/, "").split("/");
  if (parts.slice(0, 3).join("/") === VENUES) return { parts, at: 2 };
  /* It lands elsewhere from this file — but a path from the repository's root is written with a leading step as often as without: what follows the steps is read as written, with `core` before the folder. */
  const written = piece.replace(/^(?:\.{1,2}\/)+/, "").replace(/\/$/, "").split("/");
  return { parts: written, at: written.findIndex((part, at) => part === "venues" && written[at - 1] === "core") };
};
/**
 * Whether a written part of a path stops at the folder the venues live in — or at the start of a name below it, or at
 * a wildcard there — and so leaves open which venue is meant. The folder's bare name with no slash beside it is a word
 * like any other.
 */
const leavesVenueOpen = (piece, name) => {
  const { parts, at } = venuesIn(piece, name);
  if (at < 0 || (parts.length === 1 && !piece.endsWith("/"))) return false;
  if (at === parts.length - 1) return true;
  /* Steps alone — «.», «..», «../» — name a folder whole: the one they lead to, and nothing below it. */
  if (/^(?:\.{1,2}\/?)+$/.test(piece)) return false;
  if (parts[at + 1].includes("*")) return true;
  return at === parts.length - 2 && !piece.endsWith("/") && !parts[at + 1].includes(".");
};
/**
 * Whether a string ends at the SDK's scope — with its slash or without — or inside the SDK's name, so that which
 * package is meant is left open. `@meteora-ag/dlmm` is not that: it is another SDK's whole name — so that name with
 * a tail joined to it from another file is not followed.
 */
const leavesSdkOpen = (piece) => {
  const found = /(?:^|[^\w.-])@meteora-ag(?:\/([\w-]*))?$/.exec(piece);
  const tail = found?.[1] ?? "";
  return found !== null && tail !== "dlmm" && "dlmm-pro-sdk".startsWith(tail);
};
/** Whether a string — in a file that has a bundler import a folder — reaches the folder the venues live in, or under it. */
const coversVenues = (piece, name) => venuesIn(piece, name).at >= 0;
/** Whether a file lies in the folder the venues live in, beside the venues' own folders: a loader of venues by their id needs no path there. */
const besideVenues = (name) => path.posix.dirname(name.replaceAll("\\", "/")) === VENUES;
/** Whether a file lies anywhere under that folder. */
const amongVenues = (name) => name.replaceAll("\\", "/").startsWith(`${VENUES}/`);
/** A bundler's import of a whole folder: `require.context`, `import.meta.webpackContext`, `import.meta.glob`. */
const FOLDER_IMPORTS = new Set(["context", "webpackContext", "glob"]);

/**
 * What a file reaches for, read off its syntax tree — so a comment is a comment and a string is a string, whatever
 * stands inside either:
 *
 * - `strings` — every string of the file: its literals, its templates' fixed parts (joined where a substitution
 *   stands), and the text of its regular expressions with their escapes taken off;
 * - `specifiers` — those of them that stand where a module is named: `import … from`, a bare `import`, `export … from`,
 *   `import x = require()`, a type's `import()`, and an `import()` or a `require()` whose name is written;
 * - `computed` — whether an `import()` or a `require()` takes a name that is not written out whole: a variable, a sum,
 *   a call, a template with a substitution;
 * - `folder` — whether the file names a bundler's import of a whole folder at all, called there or kept for later.
 *
 * A `require` here is whatever the tree shows loading a module by a name it is handed: `require`, `module.require` and
 * `module["require"]`, what `createRequire()` returns, and any of them kept under another name — an import's own name
 * for it, a variable, a parameter's default, a property, a class field, an assignment, a name taken out of an object —
 * directly or as one side of an either-or. Parentheses, a cast and a comma around a callee change nothing. In a file
 * that declares, at its top, a function of its own named `require`, the bare word is that function and loads nothing.
 * All of this decides two things only: whether a name that is not written whole is being loaded, and whether a string
 * stands where a module is named — a name written whole is found as a string either way.
 */
function reachOf(name, source) {
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  const strings = [];
  let computed = false;
  let folder = false;
  const written = (node) => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("\u0000");
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) return node.text.replace(/\\(.)/g, "$1");
    return null;
  };
  /* What stands behind parentheses, a cast, a non-null mark or a comma is what is called. */
  const bare = (node) => {
    let inner = node;
    for (;;) {
      if (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isNonNullExpression(inner) || ts.isTypeAssertionExpression(inner) || ts.isSatisfiesExpression(inner)) inner = inner.expression;
      else if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.CommaToken) inner = inner.right;
      else return inner;
    }
  };
  /* Either side of a choice: `a ? b : c`, `a || b`, `a ?? b`, `a && b`. */
  const EITHER = new Set([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken]);
  const either = (node, test) => {
    const inner = bare(node);
    if (ts.isConditionalExpression(inner)) return either(inner.whenTrue, test) || either(inner.whenFalse, test);
    if (ts.isBinaryExpression(inner) && EITHER.has(inner.operatorToken.kind)) return either(inner.left, test) || either(inner.right, test);
    return test(inner);
  };
  /* The name a value is reached by: an identifier, or the last name of a property access — written with a dot or in brackets. */
  const nameOf = (node) => {
    const inner = bare(node);
    if (ts.isIdentifier(inner) || ts.isPrivateIdentifier(inner)) return inner.text;
    if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
    if (ts.isElementAccessExpression(inner) && ts.isStringLiteralLike(inner.argumentExpression)) return inner.argumentExpression.text;
    return null;
  };
  /* A function of the file's own named `require`, declared at its top with a body or kept there in a variable of that name: the bare word is that function. */
  const isOwnFunction = (statement) =>
    (ts.isFunctionDeclaration(statement) && statement.body !== undefined && statement.name?.text === "require") ||
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((each) => ts.isIdentifier(each.name) && each.name.text === "require" && each.initializer !== undefined && (ts.isArrowFunction(bare(each.initializer)) || ts.isFunctionExpression(bare(each.initializer)))));
  const ownRequire = tree.statements.some(isOwnFunction);
  /* The names `createRequire` goes by in the file, and the names a loader is kept under. */
  const makers = new Set(["createRequire"]);
  const loaders = new Set(["require"]);
  const isMaker = (node) => either(node, (inner) => makers.has(nameOf(inner) ?? ""));
  const isLoader = (node) => either(node, (inner) => (ts.isCallExpression(inner) && isMaker(inner.expression)) || (loaders.has(nameOf(inner) ?? "") && !(ownRequire && ts.isIdentifier(inner) && inner.text === "require")));
  const keptAs = (node) => (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isPrivateIdentifier(node) ? node.text : null);
  /* One pass over the tree; true when a name was added — a loader kept under one name may be kept under another. */
  const keep = () => {
    let grew = false;
    const add = (set, kept) => {
      if (kept === null || set.has(kept)) return;
      set.add(kept);
      grew = true;
    };
    const walk = (node) => {
      /* `import { createRequire as make }`, `const { createRequire: make } = …`, `const { require: load } = module`. */
      if ((ts.isImportSpecifier(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
        const from = keptAs(node.propertyName ?? node.name);
        if (from !== null && makers.has(from)) add(makers, node.name.text);
        if (from !== null && loaders.has(from)) add(loaders, node.name.text);
      }
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) && node.initializer) {
        if (isLoader(node.initializer)) add(loaders, keptAs(node.name));
        else if (isMaker(node.initializer)) add(makers, keptAs(node.name));
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (isLoader(node.right)) add(loaders, nameOf(node.left));
        else if (isMaker(node.right)) add(makers, nameOf(node.left));
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
    return grew;
  };
  for (let pass = 0; pass < 8 && keep(); pass += 1);
  const loads = (callee) => bare(callee).kind === ts.SyntaxKind.ImportKeyword || isLoader(callee);
  const isImportMeta = (node) => {
    const inner = bare(node);
    return ts.isMetaProperty(inner) && inner.keywordToken === ts.SyntaxKind.ImportKeyword;
  };
  const visit = (node) => {
    const text = written(node);
    if (text !== null) strings.push(text);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifiers.push(written(node.moduleSpecifier) ?? "");
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifiers.push(written(node.moduleReference.expression) ?? "");
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifiers.push(written(node.argument.literal) ?? "");
    else if (ts.isCallExpression(node) && loads(node.expression)) {
      const [argument] = node.arguments;
      const named = argument && (ts.isStringLiteralLike(argument) || ts.isTemplateExpression(argument)) ? written(argument) : null;
      /* A template with a substitution is not written out whole: its fixed parts are read as strings, and it is computed besides. */
      if (named === null || ts.isTemplateExpression(argument)) computed = true;
      if (named !== null) specifiers.push(named);
    } else if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && FOLDER_IMPORTS.has(nameOf(node) ?? "") && (isLoader(node.expression) || isImportMeta(node.expression))) {
      folder = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { specifiers, strings, computed, folder };
}

/**
 * Whether a file reaches the venue or its SDK. `name` — the file's path from the repository's root.
 *
 * 1. A string of the file names the venue, its SDK or a rehearsal file (`namesVenue`) — wherever it stands: whatever
 *    loads a module is handed its name, so no way of loading has to be recognised for a name written whole, and a
 *    whole path kept in a constant is found in the file that writes it.
 * 2. The file loads a module by a name that is not written whole — or has a bundler import a whole folder — and: one
 *    of its strings holds a part of the SDK's name or of the rehearsal files'; or one of its strings, wherever it
 *    stands, stops at the folder the venues live in or at the SDK's scope, leaving open which venue or which package
 *    is meant (`leavesVenueOpen`, `leavesSdkOpen`); or the file itself lies in that folder, beside the venues.
 * 3. The file has a bundler import a folder, and one of its strings reaches under the venues' folder (`coversVenues`)
 *    or names a venue's entry file — or the file lies anywhere under that folder.
 *
 * What is not followed:
 *
 * - the folder kept in one file and the venue's id joined to it in another: neither file says where the load leads;
 * - a name kept outside the scripts — a JSON map, an environment's variable — or a folder reached by calls rather
 *   than written: `path.dirname` of the file's own;
 * - a bundler's own reach: a computed `import()` with nothing written before its substitution, or an import of a
 *   folder above the venues with nothing of them written, takes in every file under its folder that fits — from a
 *   file above the venues, theirs too;
 * - a loader behind a call the tree does not show as one — `require.call`, `require.bind`, a bundler's own name for
 *   `require`, a folder import taken out of `require` or `import.meta` under another name — when the name it loads is
 *   not written whole;
 * - a name put together to hide it: a path split inside a word, an escape inside a name, a comment between `import`
 *   and its bracket, text handed to `eval`, a loader passed through a function.
 */
function reachesVenue(name, source) {
  const reach = reachOf(name, source);
  /* A path may be written with either slash; a template's fixed parts are read each for itself — and, for a name written whole, as one text. */
  const parts = (text) => text.replaceAll("\\", "/").split("\u0000");
  const whole = (rule) => (text) => parts(text).some(rule) || rule(parts(text).join(""));
  const any = (rule) => reach.strings.some((text) => parts(text).some(rule));
  /* The folder's bare name, with no slash beside it, is a word like any other — unless the file also holds `core` as a string of its own, or a path that ends at `lib/core`: `join("lib", "core", "venues", id)`, `join("lib/core", "venues", id)`. */
  const venuesInParts = () => any((piece) => piece === "venues") && any((piece) => piece === "core" || /(?:^|\/)lib\/core\/?$/.test(piece));
  return (
    reach.strings.some(whole(namesVenue)) ||
    reach.specifiers.some(whole(namesVenueModule)) ||
    ((reach.computed || reach.folder) && (any(mentionsVenue) || any((piece) => leavesVenueOpen(piece, name)) || venuesInParts() || any(leavesSdkOpen) || besideVenues(name))) ||
    (reach.folder && (any((piece) => coversVenues(piece, name)) || any((piece) => /(?:^|\/)venue\.server(?:\.|$)/.test(piece)) || amongVenues(name)))
  );
}

/**
 * Whether a file has to be parsed at all — told from its text. Passed over is only a file that has neither «dlmm-pro»
 * anywhere in it nor anything that could load by a name not written whole or import a folder: `import(`, the word
 * `require`, `createRequire`, `import.meta`. Written plainly, nothing `reachesVenue` finds can be in such a file; the
 * hidden spellings are among what is not followed. `DLMM_PRO_GUARD_PARSE_ALL=1` parses every script whatever it holds.
 */
const worthParsing = (source) => source.includes("dlmm-pro") || /\bimport\s*\(|\brequire\b|createRequire|\bimport\s*\.\s*meta\b/.test(source);

test("what reaches the venue is read off the syntax: every string that names it, every module loaded by a name not written whole near it — and what is not followed is said", () => {
  /* The venue's folder as an alias would name it — put together here, so that this file itself imports nothing of the kind. */
  const folder = ["@/lib/core/venues", "meteora-dlmm-pro"].join("/");
  /* And as a venue beside it would: one step up, then the folder. */
  const sibling = ["..", "meteora-dlmm-pro"].join("/");
  /* A sample stands in `lib/core/tools/` unless it says where: from there `../venues` is the folder the venues live in. */
  for (const [sample, found, name = "lib/core/tools/sample.ts"] of [
    ['import { x } from "../venues/meteora-dlmm-pro/venue.server.ts";', true],
    [`import "${folder}";`, true],
    ['export * from "./venues/meteora-dlmm-pro/gate.ts";', true, "lib/core/index.ts"],
    ['import type { DlmmProPool } from "@/lib/core/venues/meteora-dlmm-pro/pools.server";', true, "app/sample.ts"],
    ['type Pool = import("@meteora-ag/dlmm-pro-sdk").Pool;', true, "app/sample.ts"],
    ["const venue = await import(`${root}/meteora-dlmm-pro/venue.server.ts`);", true, "app/sample.ts"],
    ['require("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['import sdk = require("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['import "@meteora-ag/dlmm-pro-sdk/package.json";', true, "app/sample.ts"],
    ['import venue from "meteora-dlmm-pro";', true, "app/sample.ts"],
    [`import { gate } from "${sibling}";`, true, "lib/core/venues/meteora-dbc/trade.server.ts"],
    /* A string that holds «//» or «/*» hides nothing after it. */
    ['const url = "https://example.com/a//b"; import { y } from "./venues/meteora-dlmm-pro/gate.ts";', true, "lib/core/index.ts"],
    ['const note = "/* not a comment"; const venue = import("./venues/meteora-dlmm-pro/venue.server.ts");', true, "lib/core/index.ts"],
    /* A name written whole is found wherever it stands, whatever it is handed to and wherever in the string it is — no way of loading has to be recognised. */
    ['const where = "./venues/meteora-dlmm-pro/venue.server.ts"; const venue = await import(where);', true, "app/sample.ts"],
    ['export const WHERE = "./venues/meteora-dlmm-pro/venue.server.ts";', true, "lib/config.ts"],
    ['const where = "lib/core/venues/meteora-dlmm-pro"; const other = await import("./other.ts");', true, "app/sample.ts"],
    ['const where = "lib\\\\core\\\\venues\\\\meteora-dlmm-pro\\\\venue.server.ts";', true, "app/sample.ts"],
    ['const text = read("lib/core/venues/meteora-dlmm-pro/gate.ts");', true, "app/sample.ts"],
    ['const file = "node_modules/@meteora-ag/dlmm-pro-sdk/dist/index.js";', true, "app/sample.ts"],
    ['execSync("node --test lib/core/venues/meteora-dlmm-pro --test-reporter=dot");', true, "app/sample.ts"],
    ["execSync(`node -e \"import('@meteora-ag/dlmm-pro-sdk')\"`);", true, "app/sample.ts"],
    ['const tools = { load: (name) => name }; tools.load("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['import module from "node:module"; module.createRequire(import.meta.url)("@meteora-ag/dlmm-pro-sdk/package.json");', true, "app/sample.ts"],
    ['(0, require)("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['const load = module.require; load("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['require.call(null, "@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['Reflect.apply(require, null, ["@meteora-ag/dlmm-pro-sdk"]);', true, "app/sample.ts"],
    ['function run(load = require) { return load("@meteora-ag/dlmm-pro-sdk"); }', true, "app/sample.ts"],
    ['const pick = (flag) => (flag ? require : null); pick(true)("@meteora-ag/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['const all = require.context("@/lib/core", true, /venues\\/meteora-dlmm-pro\\/venue\\.server\\.ts$/);', true, "app/sample.ts"],
    /* The rehearsal imports the venue: naming one of its files reaches it — with the extension or without, in an import or on a command line. */
    ['import { createStand } from "../../scripts/launch-qa/dlmm-pro-svm.mjs";', true, "app/sample.ts"],
    ['import "./dlmm-pro-rehearsal.mjs";', true, "scripts/launch-qa/other.mjs"],
    ['import { createStand } from "../../scripts/launch-qa/dlmm-pro-svm";', true, "app/sample.ts"],
    ['const run = ["node", "scripts/launch-qa/dlmm-pro-rehearsal.mjs"];', true, "app/sample.ts"],
    ['execSync("node scripts/launch-qa/dlmm-pro-rehearsal.mjs --program=mainnet");', true, "app/sample.ts"],
    ['execSync("node scripts/launch-qa/dlmm-pro-rehearsal.mjs&&echo done");', true, "app/sample.ts"],
    ["execSync(`node scripts/launch-qa/dlmm-pro-rehearsal.mjs ${flag}`);", true, "app/sample.ts"],
    ['await import("../../scripts/launch-qa/dlmm-pro-svm.mjs?fresh");', true, "app/sample.ts"],
    ['const tracked = new Set(["dlmm-pro-rehearsal.mjs"]);', true, "app/sample.ts"],
    ["for (const part of parts) await import(`./dlmm-pro-${part}.mjs`);", true, "scripts/launch-qa/other.mjs"],
    /* A name that is not written whole, in a file one of whose strings holds a part of the SDK's name — or stops at its scope. */
    ['const name = "dlmm-pro-sdk"; const sdk = await import(`@meteora-ag/${name}`);', true, "app/sample.ts"],
    ['const scope = "@meteora-ag"; const sdk = require(scope + "/dlmm-pro-sdk");', true, "app/sample.ts"],
    ['import { NAME } from "./config"; const sdk = await import(`@meteora-ag/${NAME}`);', true, "app/sample.ts"],
    ['const sdk = await import(`@meteora-ag/dlmm${pro ? "-pro-sdk" : ""}`);', true, "app/sample.ts"],
    /* A name that is not written whole, in a file one of whose strings stops at the folder the venues live in — the id kept elsewhere. In the load itself: */
    ['import { VENUE } from "./config"; const venue = await import(`../venues/${VENUE}/venue.server.ts`);', true],
    ['import { VENUE } from "./config"; const venue = await import(`./venues/${VENUE}/venue.server.ts`);', true, "lib/core/index.ts"],
    ['import { VENUE } from "./config"; const venue = require("@/lib/core/venues/" + VENUE);', true, "app/sample.ts"],
    ['import { BASE, VENUE } from "./config"; const venue = require(BASE + "/venues/" + VENUE);', true, "app/sample.ts"],
    ['import { VENUE } from "./config"; const venue = await import("./" + "venues/" + VENUE + "/venue.server.ts");', true, "app/sample.ts"],
    ['import path from "node:path"; import { VENUE } from "./config"; const venue = await import(path.join(process.cwd(), "lib/core/venues", VENUE, "venue.server.ts"));', true, "app/sample.ts"],
    ['import path from "node:path"; import { VENUE } from "./config"; const venue = await import(path.join(process.cwd(), "lib", "core", "venues", VENUE, "venue.server.ts"));', true, "app/sample.ts"],
    ['import path from "node:path"; import { VENUE } from "./config"; const venue = await import(path.join(ROOT, "lib/core", "venues", VENUE, "venue.server.ts"));', true, "scripts/qa/run.mjs"],
    ['import { KIND } from "./config"; const venue = await import(`@/lib/core/venues/meteora-${KIND}/venue.server.ts`);', true, "app/sample.ts"],
    /* — or a step before it: a constant, a path put together first, an address, a helper that does the loading, a listing of the folder. */
    ['const VENUES = "./venues"; export const poolsOf = (id: string) => import(`${VENUES}/${id}/pools.server`);', true, "lib/core/venue-parts.server.ts"],
    ['const VENUES = "../venues/"; export const sdkOf = (id) => import(VENUES + id + "/sdk.server");', true],
    ['const BASE = "@/lib/core/venues/"; export const venueOf = (id) => import(BASE + id);', true, "app/sample.ts"],
    ['import path from "node:path"; import { pathToFileURL } from "node:url"; export const venueOf = (id) => { const file = path.join(process.cwd(), "lib/core/venues", id, "venue.server.ts"); return import(pathToFileURL(file).href); };', true, "lib/core/venue-loader.server.ts"],
    ['import { VENUE } from "./config"; const where = `../venues/${VENUE}/venue.server.ts`; const venue = await import(where);', true],
    ['import { VENUE } from "./config"; const entry = new URL(`../lib/core/venues/${VENUE}/venue.server.ts`, import.meta.url); await import(entry.href);', true, "app/sample.ts"],
    ['import { VENUE } from "./config"; const load = async (file) => (await import(file)).default; await load(`../venues/${VENUE}/venue.server.ts`);', true],
    ['for (const file of globSync("lib/core/venues/*/venue.server.ts")) await import(pathToFileURL(file).href);', true, "app/sample.ts"],
    ['for (const file of globSync("./lib/core/venues/*/venue.server.ts")) await import(pathToFileURL(file).href);', true, "scripts/qa/run.mjs"],
    ['import { VENUE } from "./config"; const venue = await import(new URL(`./lib/core/venues/${VENUE}/venue.server.ts`, ROOT).href);', true, "lib/launch/launch.test.mjs"],
    ['import { NAME } from "./config"; const SCOPE = "@meteora-ag"; const sdk = await import(`${SCOPE}/${NAME}`);', true, "app/sample.ts"],
    /* The same through every way of loading by a name: what `createRequire` returns, under whatever name; `require` kept elsewhere, or as one side of a choice. */
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; const load = createRequire(import.meta.url); load(`../venues/${VENUE}/venue.server.cjs`);', true],
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; createRequire(import.meta.url)("../venues/" + VENUE);', true],
    ['import { createRequire as make } from "node:module"; import { VENUE } from "./config"; make(import.meta.url)("../venues/" + VENUE);', true],
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; const make = createRequire; make(import.meta.url)("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; const { createRequire: make } = await import("node:module"); make(import.meta.url)(`../venues/${VENUE}/venue.server.ts`);', true],
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; const require = createRequire(import.meta.url); require("../venues/" + VENUE);', true],
    ['declare function require(id: string): any; import { VENUE } from "./config"; require("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; function check() { const require = (ok) => ok; return require(true); } const venue = module.require("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; const load = module.require; load("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; module["require"]("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; (require as any)("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; const load = require; load("../venues/" + VENUE);', true],
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; const tools = { load: createRequire(import.meta.url) }; tools.load("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; class Loader { load = require; run() { return this.load("../venues/" + VENUE); } }', true],
    ['import { VENUE } from "./config"; const tools = {}; tools.load = require; tools.load("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; function run(load = require) { return load("../venues/" + VENUE); }', true],
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; const req = typeof require !== "undefined" ? require : createRequire(import.meta.url); req("../venues/" + VENUE);', true],
    ['import { createRequire } from "node:module"; import { VENUE } from "./config"; const req = globalThis.require ?? createRequire(import.meta.url); req("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; const req = module.require || require; req("../venues/" + VENUE);', true],
    ['import { VENUE } from "./config"; (flag ? require : other)("../venues/" + VENUE);', true],
    /* In the folder the venues live in a loader by id needs no path at all; from inside another venue's folder it needs only to step out. */
    ["export const venueOf = (id) => import(`./${id}/index.ts`);", true, "lib/core/venues/index.ts"],
    ["export const siblingOf = (id) => import(`../${id}/index.ts`);", true, "lib/core/venues/meteora-dbc/sibling.ts"],
    ["export const sdkOf = (kind) => import(`../meteora-${kind}/sdk.server`);", true, "lib/core/venues/meteora-dbc/family.server.ts"],
    ["export const partOf = (id) => import(`./../${id}/pools.server.ts`);", true, "lib/core/venues/meteora-dbc/family.server.ts"],
    ["export const fixtureOf = (name) => import(`./fixtures/${name}.mjs`);", false, "lib/core/venues/meteora-dbc/trade.test.mjs"],
    ['const ROOT = new URL("../../../../", import.meta.url); const store = await import(new URL("lib/guard/store.ts", ROOT).href);', false, "lib/core/venues/meteora-dbc/trade.test.mjs"],
    ["export const venueOf = (id) => import(`./${id}/index.ts`);", false, "lib/core/places/index.ts"],
    /* A bundler's import of the whole folder the venues live in — called there, or kept for later; named by a path, by a constant, or by a pattern of files alone. */
    ['const all = require.context("@/lib/core/venues", true, /venue\\.server\\.ts$/);', true, "app/sample.ts"],
    ['const all = import.meta.webpackContext("../venues", { recursive: true });', true],
    ['const all = import.meta.glob("./venues/*/venue.server.ts");', true, "lib/core/index.ts"],
    ['const DIR = "@/lib/core/venues"; const all = require.context(DIR, true);', true, "app/sample.ts"],
    ['const context = require.context; const all = context("@/lib/core/venues", true);', true, "app/sample.ts"],
    ['const all = require.context("@/lib/core", true, /venue\\.server\\.ts$/);', true, "app/sample.ts"],
    ['const all = require.context(".", true, /index\\.ts$/);', true, "lib/core/venues/index.ts"],
    ['const all = import.meta.glob("./*/index.ts");', true, "lib/core/venues/meteora-dbc/parts.ts"],
    ['const all = require.context("@/lib/core/words", true, /\\.ts$/);', false, "app/sample.ts"],
    ['const all = new.target.glob("./venues/x");', false, "lib/core/index.ts"],
    /* What only looks like a way in: the venue's id as data — beside a load of something else, too; a page's address; a web address; a comment; another package, folder or file of a like name; a load that has nothing of the venue near it. */
    ['const row = { venue: "meteora-dlmm-pro" };', false, "app/sample.ts"],
    ['const rows = registry.filter((row) => row.venue === "meteora-dlmm-pro"); const { check } = await import(new URL("lib/core/capabilities.ts", ROOT).href);', false, "lib/core/capabilities.test.mjs"],
    ['const id = "meteora-dlmm-pro"; const page = await import(`./places/${id}/index.ts`);', false, "app/sample.ts"],
    ['const href = "/pools/meteora-dlmm-pro";', false, "app/sample.ts"],
    ['const href = "/learn/dlmm-pro-program";', false, "app/sample.ts"],
    ['const link = "https://www.npmjs.com/package/@meteora-ag/dlmm-pro-sdk";', false, "app/sample.ts"],
    ['import { createRequire } from "node:module"; const row = { venue: "meteora-dlmm-pro" }; const load = createRequire(import.meta.url); load("./other.cjs");', false, "app/sample.ts"],
    ['import "./dlmm-pro-rehearsal-notes.mjs";', false, "scripts/launch-qa/other.mjs"],
    ['const programs = [{ id: "dlmm-pro-program", address: "dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n" }];', false, "app/sample.ts"],
    ['track("dlmm-pro-rehearsal");', false, "app/sample.ts"],
    ['const lang = "uk"; const words = await import(`./locales/${lang}.ts`);', false, "app/sample.ts"],
    ['const venues = ["meteora-dbc"]; const page = await import(`./pages/${venues[0]}.ts`);', false, "app/sample.ts"],
    ['const label = word("venues"); const Chart = dynamic(() => import(`./charts/${kind}`));', false, "app/app/markets/pools/pools-catalog.tsx"],
    ['const trade = await import(new URL("lib/core/venues/meteora-dbc/trade.server.ts", ROOT).href);', false, "lib/launch/launch.test.mjs"],
    ["const part = await import(`../core/venues/meteora-dbc/${name}.server.ts`);", false, "lib/launch/parts.ts"],
    ['const care = await import(new URL("lib/care/venue.server.ts", ROOT).href);', false, "lib/care/care.test.mjs"],
    ['import path from "node:path"; const care = await import(pathToFileURL(path.join(HERE, "venue.server.ts")).href);', false, "lib/care/care.test.mjs"],
    ["export const adapterOf = (name) => import(`@/lib/venues/${name}/quote`);", false, "lib/arc/swap.ts"],
    ['import type { Venue } from "../venues/types"; const words = await import(`./locales/${lang}.ts`);', false, "lib/domain/ids.ts"],
    ['const VENUES = "./venues/"; export const pageOf = (id) => import(VENUES + id);', false, "app/sample.ts"],
    ['import DLMM from "@meteora-ag/dlmm"; const { build } = await import(new URL("lib/bots/ladder/build.server.ts", ROOT).href);', false, "lib/bots/ladder/ladder.test.mjs"],
    ['const ROOT = new URL("../../../../", import.meta.url); const store = await import(new URL("lib/guard/store.ts", ROOT).href); throw new Error(`No mint at ${mint}.`);', false, "lib/core/venues/meteora-dbc/trade.test.mjs"],
    ['const mod = await import(pathToFileURL(file).href); const up = path.join(HERE, "..");', false, "lib/core/venues/meteora-dbc/fixtures/kit.mjs"],
    ['import { Shell } from "@ryntra/core"; const label = word("venues"); const Chart = dynamic(() => import(`./charts/${kind}`));', false, "app/sample.tsx"],
    ['const require = (ok: boolean, field: string) => { if (!ok) throw new Error(field); }; require(plan.venue !== "meteora-dlmm-pro", "the venue is closed");', false, "app/sample.ts"],
    ["/* see `./venues/meteora-dlmm-pro/gate.ts` */ const state = 1;", false, "app/sample.ts"],
    ['// import "@meteora-ag/dlmm-pro-sdk"', false, "app/sample.ts"],
    ['/* import("../meteora-dlmm-pro/venue.server.ts") */ const a = 1;', false, "app/sample.ts"],
    ['import { x } from "@meteora-ag/dlmm-pro-sdk-extras";', false, "app/sample.ts"],
    ['import { x } from "../venues/meteora-dlmm-pro-notes/index.ts";', false],
    /* Not followed, and said so above: the folder in one file and the id joined to it in another; a folder import above the venues with nothing of them written; a loader behind `call`; a path split inside a word. */
    ['export const VENUES = "./venues/";', false, "lib/core/paths.ts"],
    ['import { VENUES } from "./paths"; export const sdkOf = (id) => import(VENUES + id + "/sdk.server");', false, "lib/core/parts.ts"],
    ['import { WHERE } from "./config"; const venue = await import(WHERE);', false, "app/sample.ts"],
    ['const all = require.context("@/lib/core", true);', false, "app/sample.ts"],
    ['import { WHERE } from "./config"; const venue = require.call(null, WHERE);', false, "app/sample.ts"],
    ['import { VENUE } from "./config"; const venue = await import("../ven" + "ues/" + VENUE);', false],
  ]) {
    assert.equal(reachesVenue(name, sample), found, sample);
    /* What the rule finds, the text's own test must not have passed over. */
    if (found) assert.equal(worthParsing(sample), true, `worth parsing: ${sample}`);
  }
});

test("a hidden folder inside a source folder is read; what is installed, and what the build tools keep for themselves, is not", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "city-211-guard-"));
  try {
    for (const name of ["app/.well-known/agent.json/route.ts", "app/page.tsx", "app/node_modules/x/index.js", "app/.next/server/chunk.js", "city/.turbo/cache.js", "city/scene.mjs", "city/notes.md"]) {
      mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
      writeFileSync(path.join(folder, name), "");
    }
    const found = scriptsUnder(folder).map((file) => path.relative(folder, file).split(path.sep).join("/")).sort();
    assert.deepEqual(found, ["app/.well-known/agent.json/route.ts", "app/page.tsx", "city/scene.mjs"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("nothing a person can reach stands on the venue but through a gated surface: outside its own folder, the rehearsal's files, the surfaces' own folders and the named doors, no script names it, its SDK or the rehearsal", () => {
  const own = `${VENUES}/meteora-dlmm-pro/`;
  const rehearsal = new Set(REHEARSAL_FILES.map((name) => `scripts/launch-qa/${name}`));
  const doors = new Set(SURFACE_DOORS);
  const surfaceTests = new Set(SURFACE_TESTS);
  /*
   * Every folder of the repository and the scripts at its root — the web, the city, the phone, the packages, the tools:
   * whatever is added later is held too. Left out is what is installed, what the build tools keep for themselves, what
   * is hidden at the root — tools' own folders, other working trees among them — and the folders the repository ignores
   * as its own output: copies of itself the snapshot builder makes.
   */
  const notSource = new Set(["node_modules", "output", "out", "videos"]);
  const top = readdirSync(ROOT, { withFileTypes: true }).filter((entry) => !notSource.has(entry.name) && !entry.name.startsWith("."));
  const files = [...top.filter((entry) => entry.isFile() && SCRIPT.test(entry.name)).map((entry) => path.join(ROOT, entry.name)), ...top.filter((entry) => entry.isDirectory()).flatMap((entry) => scriptsUnder(path.join(ROOT, entry.name)))].map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  for (const expected of ["middleware.ts", "instrumentation.ts", "next.config.ts", "app", "city", "lib"]) {
    assert.ok(files.some((file) => file.split("/")[0] === expected), `${expected} is among what is read`);
  }
  /* The routes that describe the agent to the outside live in a hidden folder inside `app`: they are read like any route. */
  const walked = new Set(files);
  assert.ok(walked.has("app/.well-known/agent.json/route.ts"), "app/.well-known is among what is read");
  const everything = process.env.DLMM_PRO_GUARD_PARSE_ALL === "1";
  const outside = [];
  const exempt = [];
  let parsed = 0;
  for (const name of files) {
    if (name.startsWith(own) || rehearsal.has(name) || SURFACES.some((folder) => name.startsWith(folder)) || doors.has(name) || surfaceTests.has(name)) {
      exempt.push(name);
      continue;
    }
    const source = read(name);
    if (!everything && !worthParsing(source)) continue;
    parsed += 1;
    if (reachesVenue(name, source)) outside.push(name);
  }
  /*
   * Not vacuous: thousands of scripts were read and hundreds parsed; the registry that names the venue's id as data is
   * among those parsed, and is no way in; and the rule does see the venue where it is reached — in the venue's own
   * file that imports the SDK and, where the development repository's scripts sit beside the code, in the script that
   * rehearses it: the two kinds of file left out above. The code's public snapshot carries the venue without the
   * rehearsal's scripts.
   */
  assert.ok(files.length - exempt.length > 3_000 && parsed > 300, `${files.length - exempt.length} scripts read, ${parsed} parsed`);
  assert.ok(walked.has("lib/core/capabilities.ts") && worthParsing(read("lib/core/capabilities.ts")), "the registry is parsed");
  assert.equal(reachesVenue(`${own}sdk.server.ts`, read(`${own}sdk.server.ts`)), true, "the venue's own file that imports the SDK reaches it");
  /* A door is a door: each is there, each does load the venue, and the surface's gate is the venue's own word on mainnet. */
  assert.deepEqual(exempt.filter((name) => doors.has(name)).sort(), [...doors].sort());
  for (const door of doors) assert.equal(reachesVenue(door, read(door)), true, `${door} reaches the venue`);
  for (const name of surfaceTests) {
    assert.ok(name.endsWith(".test.mjs") && walked.has(name), `${name} is a test file that is there`);
    const base = path.basename(name);
    /* This guard names it — in the list above — and nothing else does. */
    const naming = files.filter((file) => file !== name && file !== `${own}sdk.test.mjs` && read(file).includes(base));
    assert.deepEqual(naming, [], `${name} is run, never imported`);
  }
  if (inDevelopmentRepository) {
    assert.deepEqual(exempt.filter((name) => rehearsal.has(name)).sort(), [...rehearsal].sort());
    assert.equal(reachesVenue("scripts/launch-qa/dlmm-pro-rehearsal.mjs", read("scripts/launch-qa/dlmm-pro-rehearsal.mjs")), true, "the rehearsal reaches the venue");
  }
  /*
   * A surface is a folder of the engine, never a route or a window: those reach the venue only through it, so that its
   * gate stands between them and the venue. And a surface does reach the venue — a folder listed and no longer used
   * would be a door left unwatched.
   */
  for (const folder of SURFACES) {
    assert.ok(folder.startsWith("lib/") && folder.endsWith("/"), `${folder} is a folder of the engine`);
    assert.ok(walked.has(`${folder}gate.ts`), `${folder} has a gate of its own`);
    assert.ok(files.some((name) => name.startsWith(folder) && /\.test\.mjs$/.test(name)), `${folder} has a test of its own`);
    assert.ok(exempt.some((name) => name.startsWith(folder) && reachesVenue(name, read(name))), `${folder} reaches the venue`);
  }
  assert.deepEqual(outside, [], "a route, a window or an agent tool that reaches the venue opens it to people: that is a task with its own gate, not an import");
});

test("the SDK stays on the server, and a pool is never read by its head alone", () => {
  const own = "lib/core/venues/meteora-dlmm-pro";
  for (const name of readdirSync(path.join(ROOT, own))) {
    if (!/\.ts$/.test(name)) continue;
    const source = read(`${own}/${name}`);
    const reach = reachOf(name, source);
    /* Any way of importing it — a value, a type, a side effect, `import()`. */
    if (reach.specifiers.some((specifier) => /^@meteora-ag\/dlmm-pro-sdk(?:\/|$)/.test(specifier))) assert.match(name, /\.server\.ts$/, `${name} imports the SDK and is not a server file`);
    /* The SDK's `fetchPool` decodes a pool's head and drops the tail of its extensions without a word. */
    let headAlone = false;
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "fetchPool") headAlone = true;
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true));
    assert.equal(headAlone, false, `${name} reads a pool without its extensions`);
  }
});
