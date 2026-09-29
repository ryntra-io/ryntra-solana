/**
 * The boundary gate: what this kit structurally cannot do, asserted by reading
 * the shipped sources rather than by trusting a README.
 *
 * Every file the public kit is made of is listed in one place, and this test
 * scans exactly that list — so a file added to the kit without being added to
 * the list never reaches the public repository, and a file added to the list is
 * scanned from its first run. The list sits beside this file and is resolved
 * relative to it, so the identical line runs in both trees and the boundary
 * cannot hold in one and fail in the other.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

/* This suite scans the tree a reader is holding, so it runs where the listed
   files are: the published tree, whose root package is the kit itself. The
   list carries public names, and some of them are authored content that lives
   elsewhere before publication — so in any other tree the suite says where it
   applies and skips, and the repository that builds the kit runs it inside the
   built candidate instead, against exactly the files that ship. */
const publicTree = (() => {
  try {
    return JSON.parse(readFileSync(`${root}package.json`, "utf8")).name === "ryntra-solana-evidence";
  } catch {
    return false;
  }
})();
const suite = publicTree ? test : (name, fn) => test(name, { skip: "runs in the published tree; the building repository runs it inside the built candidate" }, fn);

function shippedFiles() {
  /* Resolved relative to this file, not to the tree root, so the same line
     works in both trees and neither knows the other's layout. `public-files.json`
     is generated from the publication allowlist and carries paths and roles and
     nothing else. */
  const path = fileURLToPath(new URL("./public-files.json", import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(parsed.kind, "RYNTRA_PUBLIC_FILE_LIST", `${path} is not the file list`);
  assert.ok(Array.isArray(parsed.files), `${path} lists no files`);
  return parsed.files.map((entry) => entry.path);
}

const SHIPPED = shippedFiles();
const CODE = SHIPPED.filter((path) => /\.(?:ts|mjs)$/.test(path));

function read(path) {
  return readFileSync(`${root}${path}`, "utf8");
}

/** Comments ship too, so claim scans read them; capability scans do not. */
function withoutComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
}

suite("the manifest lists a kit, and every file it lists exists", function () {
  assert.ok(SHIPPED.length >= 30, `the manifest lists only ${SHIPPED.length} files`);
  for (const path of SHIPPED) {
    assert.ok(existsSync(`${root}${path}`), `manifest names a missing file: ${path}`);
  }
  assert.deepEqual([...SHIPPED].sort(), SHIPPED, "the generated file list is not sorted");
  assert.equal(new Set(SHIPPED).size, SHIPPED.length, "the file list names a file twice");
});

suite("no shipped source can produce a signature or hold key material", function () {
  /* Verification uses public keys and is the point of the kit; production of
     a signature, in any form, is what must not exist. */
  const forbidden = [
    [/\bsignTransaction\b/, "transaction signing"],
    [/\bpartialSign\b/, "transaction signing"],
    [/\bsignAndSend\w*/, "transaction signing"],
    [/\bKeypair\b/, "keypair handling"],
    [/\bfromSecretKey\b/, "secret key import"],
    [/\bsecretKey\b/, "secret key handling"],
    [/\bprivateKey\b/, "private key handling"],
    [/\bcreatePrivateKey\b/, "private key handling"],
    [/\bgenerateKeyPair(?:Sync)?\b/, "key generation"],
    [/\bmnemonic\b/i, "seed material"],
    [/\bseed phrase\b/i, "seed material"],
    [/\bcreateSignerFrom\w*/, "signer construction"],
    [/\bcreateKeyPairSigner\w*/, "signer construction"],
  ];
  for (const path of CODE) {
    const source = withoutComments(read(path));
    for (const [pattern, what] of forbidden) {
      assert.doesNotMatch(source, pattern, `${path} contains ${what}`);
    }
  }
});

suite("no shipped source builds or submits a transaction", function () {
  const forbidden = [
    [/\bsendTransaction\b/, "transaction submission"],
    [/\bsendAndConfirm\w*/, "transaction submission"],
    [/\brequestAirdrop\b/, "a state-changing RPC method"],
    [/\bcreateTransactionMessage\b/, "transaction construction"],
    [/\bappendTransactionMessageInstruction\w*/, "transaction construction"],
    [/\bgetTransferInstruction\b/, "transfer instruction construction"],
    [/@solana-program\/system/, "the system program client"],
  ];
  for (const path of CODE) {
    const source = withoutComments(read(path));
    for (const [pattern, what] of forbidden) {
      assert.doesNotMatch(source, pattern, `${path} contains ${what}`);
    }
  }
});

suite("the only RPC methods the kit calls are reads", function () {
  const allowed = new Set(["getAccountInfo"]);
  const called = new Set();
  for (const path of CODE) {
    for (const match of withoutComments(read(path)).matchAll(/\brpc\s*\n?\s*\.(\w+)\s*\(/g)) {
      called.add(match[1]);
    }
  }
  assert.ok(called.size > 0, "no RPC call was found at all — the scan is not looking at the right shape");
  for (const method of called) {
    assert.ok(allowed.has(method), `the kit calls an RPC method outside the read allowlist: ${method}`);
  }
});

/**
 * Shaped as overclaims, not as bare words.
 *
 * A sentence that states a limit — "this is not a safety judgement" — is the
 * product being honest, and a gate that fails on it teaches people to delete
 * the honest sentence instead of the false one. The first draft here was
 * `/(is|are) safe/` and it fired on "two hashers over one canonicalizer is
 * safe", an engineering sentence about serialization. The shape that actually
 * overclaims names *what* is supposedly safe.
 */
const FORBIDDEN_CLAIMS = [
  /\b(?:asset|token|mint|transfer|trade|swap|holding)s?\s+(?:is|are)\s+safe\b/i,
  /\b(?:completely|totally|perfectly|entirely)\s+safe\b/i,
  /\bsafe to (?:buy|trade|hold|send|use)\b/i,
  /\bguarantee[ds]?\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  /\b100x\b/i,
  /\bmoonshot\b/i,
  /\bfully audited\b/i,
  /\binstitutional[- ]grade\b/i,
  /\bofficial partner\b/i,
  /\bfirst and only\b/i,
];

suite("the claim gate catches overclaims and leaves honest limits alone", function () {
  /* A gate that never fires is not a gate, so it is aimed at real sentences
     here on every run rather than proven once by hand. */
  const overclaims = [
    "This token is safe to hold.",
    "The asset is safe.",
    "Returns are guaranteed.",
    "A completely safe way to trade.",
    "Risk-free evidence.",
    "Institutional-grade custody.",
    "We are an official partner of the network.",
    "The first and only Solana risk layer.",
  ];
  for (const sentence of overclaims) {
    assert.ok(
      FORBIDDEN_CLAIMS.some((pattern) => pattern.test(sentence)),
      `the claim gate would let this through: ${sentence}`,
    );
  }
  const honest = [
    "It is not a safety judgement and endorses nothing.",
    "Two hashers over one canonicalizer is safe; two canonicalizers is not.",
    "NO_KNOWN_BLOCKER reports the absence of known blockers under a declared policy.",
    "This is a structural flag, not a risk score.",
  ];
  for (const sentence of honest) {
    for (const pattern of FORBIDDEN_CLAIMS) {
      assert.doesNotMatch(sentence, pattern, `the claim gate fires on an honest sentence: ${sentence}`);
    }
  }
});

suite("no shipped file makes a claim this product may not make", function () {
  /* This file is the one exception, and necessarily so: it holds the forbidden
     shapes and the sentences that prove them, so scanning itself would fail on
     its own definition. The self-test above is what covers it — a scan that
     included this file would only teach the next person to delete the proof. */
  const self = "packages/solana-evidence-sdk/boundaries.test.mjs";
  assert.ok(SHIPPED.includes(self), "the claim gate's own exception no longer names a shipped file");

  for (const path of SHIPPED) {
    if (path === self) continue;
    if (!/\.(?:ts|mjs|md|json)$/.test(path)) continue;
    const source = read(path);
    for (const pattern of FORBIDDEN_CLAIMS) {
      assert.doesNotMatch(source, pattern, `${path} makes a forbidden claim`);
    }
  }
});

suite("the verdict vocabulary has no word for safety", function () {
  const contracts = read("lib/solana/contracts.ts");
  const verdicts = contracts.match(/export const POLICY_VERDICTS = \[([\s\S]*?)\] as const;/);
  assert.ok(verdicts, "the verdict vocabulary moved");
  assert.doesNotMatch(verdicts[1], /SAFE/i);
  assert.match(verdicts[1], /NO_KNOWN_BLOCKER/);
});

suite("the kit ships no environment file, key file or lockfile of somebody else's", function () {
  for (const path of SHIPPED) {
    assert.doesNotMatch(path, /(?:^|\/)\.env/, `${path} is an environment file`);
    assert.doesNotMatch(path, /\.(?:pem|key|p12|pfx)$/, `${path} looks like key material`);
  }
});

suite("no shipped source reaches a private module the extraction leaves behind", function () {
  const shipped = new Set(SHIPPED);
  for (const path of CODE) {
    const directory = path.slice(0, path.lastIndexOf("/"));
    for (const match of withoutComments(read(path)).matchAll(/from\s+"(\.[^"]+)"/g)) {
      const specifier = match[1];
      const resolved = new URL(specifier, `file:///${directory}/`).pathname.replace(/^\/+/, "");
      assert.ok(
        shipped.has(resolved),
        `${path} imports ${specifier} → ${resolved}, which the manifest does not ship`,
      );
    }
  }
});

suite("every signed receipt fixture carries a public key and no secret", function () {
  for (const path of SHIPPED.filter((entry) => entry.includes("fixtures/receipt-"))) {
    const artifact = JSON.parse(read(path));
    assert.equal(artifact.kind, "OUTCOME_RECEIPT");
    if (artifact.issuer.status !== "SIGNED") continue;
    assert.equal(typeof artifact.issuer.publicKey, "string");
    assert.equal(artifact.issuer.algorithm, "Ed25519");
    assert.doesNotMatch(read(path), /PRIVATE KEY/);
  }
});
