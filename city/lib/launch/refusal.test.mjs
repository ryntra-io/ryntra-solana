import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LAUNCH_FAILURE_CODES } from "../../../lib/launch/runtime.server.ts";
import { BUILD_AGED, BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, causeOf, failureWords, readRefusal, supportText } from "./refusal.ts";
import { REFUSAL_WORDS } from "./words.ts";
import { useLangStore } from "../i18n/lang.ts";

const TOKEN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const before = (code, message = "") => ({ code, stage: "before", message, token: null });
const sent = (code, message = "") => ({ code, stage: "send", message, token: TOKEN });

/* What a person must never read on the sheet: the engine's own English, addresses, paths, codes, technical words. */
const TECH = /\bapi\b|\/api|engine|endpoint|route|lamports|blockhash|payer|executor|kms|simulation|preflight|rpc\b|[A-Z]{3,}_[A-Z_]{3,}|[1-9A-HJ-NP-Za-km-z]{32,}|CITY-\d+/i;

const each = (fn) => {
  for (const lang of ["en", "uk"]) {
    useLangStore.setState({ lang });
    fn(lang);
  }
  useLangStore.setState({ lang: "en" });
};

/** The task's list (CITY-181): each refusal, its kind, its one action and whether money moved. */
const CASES = [
  ["the person declined in the wallet", before(WALLET_REFUSED, "User rejected the request."), "declined", "retry", "nothingSent"],
  ["the wallet closed without a word", before(WALLET_REFUSED, ""), "declined", "retry", "nothingSent"],
  ["the wallet failed for its own reason", before(WALLET_REFUSED, "Unexpected error in the extension"), "walletFailed", "retry", "nothingSent"],
  ["not enough SOL — the wallet says", before(WALLET_REFUSED, "Insufficient funds for fee"), "lowSol", "topUp", "nothingSent"],
  ["not enough SOL — the chain refused the send", sent("LAUNCH_SUBMIT_FAILED", "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."), "lowSol", "topUp", "nothingLeft"],
  ["not enough SOL — a transfer in the creation", sent("LAUNCH_SUBMIT_FAILED", "Simulation failed. Message: Transfer: insufficient lamports 1200, need 9874320"), "lowSol", "topUp", "nothingLeft"],
  ["the blockhash aged in the wallet", before(BUILD_AGED), "aged", "retry", "nothingSent"],
  ["the blockhash aged at the send", sent("LAUNCH_SUBMIT_FAILED", "The network never saw the transaction before its blockhash expired."), "aged", "retry", "nothingLeft"],
  ["the build aged before the send", sent("LAUNCH_BUILD_EXPIRED", "The launch waited too long for the signature; build it again."), "aged", "retry", "nothingLeft"],
  ["the network is busy", sent("LAUNCH_SUBMIT_FAILED", "The node did not answer the send in time."), "networkBusy", "retry", "nothingLeft"],
  ["too many launches this hour", sent("LAUNCH_BUSY", "Too many launches right now: at most 30 an hour go out through Ryntra. Nothing was sent."), "busyHour", "retry", "nothingLeft"],
  ["too many tries", before("RATE_LIMITED", "Too many requests."), "rateLimited", "retry", "nothingSent"],
  ["Ryntra's pool payer did not sign", sent("LAUNCH_SUBMIT_FAILED", "Ryntra's pool payer did not sign the launch; nothing was sent."), "ryntraNotSigned", "retry", "nothingSent"],
  ["Ryntra's executor did not sign", sent("LAUNCH_SUBMIT_FAILED", "the kms key did not sign (PERMISSION_DENIED)"), "ryntraNotSigned", "retry", "nothingSent"],
  ["Ryntra's executor did not sign at the build", before("UNAVAILABLE", "Ryntra's executor could not sign the launch."), "ryntraNotSigned", "retry", "nothingSent"],
  ["the server is unreachable", before("UNAVAILABLE", ""), "unreachable", "retry", "nothingSent"],
  ["the network could not be read", before("UNAVAILABLE", "The network could not be read now; nothing was built. Try again."), "unreachable", "retry", "nothingSent"],
  ["the picture is not a picture", before("LAUNCH_IMAGE_INVALID", "The picture is not a PNG, JPEG, WebP or GIF."), "picture", "picture", "nothingStored"],
  ["the picture reads as violent", before("LAUNCH_IMAGE_REFUSED", "The picture reads as violence; choose another."), "picture", "picture", "nothingStored"],
  ["the picture check is down", before("LAUNCH_IMAGE_CHECK_UNAVAILABLE", "The picture could not be checked right now; nothing was stored. Try again in a moment."), "pictureUnchecked", "retry", "nothingStored"],
  ["the ticker reads as someone else's", before("LAUNCH_NAME_BORROWED", "The name or ticker reads as Tesla."), "ticker", "edit", "nothingSent"],
  ["the ticker is not allowed", before("VALIDATION_ERROR", "Ryntra does not launch a token under this name or ticker."), "invalid", "edit", "nothingSent"],
  ["the check built something else", before(BUILD_UNEXPECTED, "The engine built more than the launch."), "unexpected", "retry", "nothingSigned"],
  ["the wallet signed other bytes", sent("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built."), "otherBytes", "retry", "nothingLeft"],
  ["the wallet changed", sent("WALLET_MISMATCH", "This launch was built for another wallet."), "mismatch", "retry", "nothingLeft"],
  ["the chain refused the launch", sent("LAUNCH_SUBMIT_FAILED", '{"InstructionError":[2,{"Custom":6001}]}'), "chainRefused", "retry", "nothingLeft"],
  ["no answer to the send", sent("UNAVAILABLE", "No answer could be read from the network now; if the launch was sent, its page shows it."), "noAnswer", "close", "maybeLanded"],
  ["already sent", sent("LAUNCH_BUILD_USED", "This launch was already sent."), "used", "close", "landing"],
  ["today's limit", before("LAUNCH_LIMIT", "One wallet launches at most 3 tokens a day."), "limit", "close", "nothingSent"],
  ["Ryntra paused launching", before("LAUNCH_PAUSED", "Launching is paused; nothing was built."), "paused", "close", "nothingSent"],
  ["the build failed and said it is paused", before("UNAVAILABLE", "Launching is paused; nothing was built."), "paused", "close", "nothingSent"],
  ["launching from the city is not open yet", before(CITY_CLOSED), "closed", "close", "nothingSent"],
  ["an unknown error before the send", before("SOMETHING_NEW", "Whatever: 0x1f"), "unknown", "retry", "nothingSent"],
  ["an unknown error at the send", sent("SOMETHING_NEW", "Whatever"), "noAnswer", "close", "maybeLanded"],
];

test("every refusal of the launch flow reads as one sentence, the money, and one action — in English and Ukrainian", () => {
  each((lang) => {
    const w = REFUSAL_WORDS[lang];
    for (const [name, failure, kind, action, money] of CASES) {
      const refusal = readRefusal(failure, "Phantom");
      assert.equal(refusal.kind, kind, `${lang} ${name}`);
      assert.equal(refusal.action, action, `${lang} ${name}`);
      assert.equal(refusal.moneyKind, money, `${lang} ${name}`);
      assert.equal(refusal.money, w[money], `${lang} ${name}`);
      /* One sentence of what happened; one of the money. */
      for (const line of [refusal.what, refusal.money]) {
        assert.ok(line.length > 0 && line.length <= 90, `${lang} ${name}: ${line}`);
        assert.equal((line.match(/[.!?](\s|$)/g) ?? []).length, 1, `${lang} ${name}: ${line}`);
      }
      assert.ok(refusal.act.length > 0 && refusal.act.length <= 20, `${lang} ${name}: ${refusal.act}`);
    }
  });
});

test("the sheet never shows the engine's text, an address, a path, a code or a technical word", () => {
  each((lang) => {
    for (const [name, failure] of CASES) {
      const refusal = readRefusal(failure, "Phantom");
      const shown = `${refusal.what} ${refusal.money} ${refusal.act}`;
      assert.doesNotMatch(shown, TECH, `${lang} ${name}: ${shown}`);
      if (failure.message.length > 12) assert.ok(!shown.includes(failure.message.replace(/\.$/, "")), `${lang} ${name}: echoes the engine`);
    }
  });
  /* The words named in the task: «Ryntra's pool payer did not sign…» becomes a person's sentence. */
  const payer = readRefusal(sent("LAUNCH_SUBMIT_FAILED", "Ryntra's pool payer did not sign the launch; nothing was sent."));
  assert.equal(`${payer.what} ${payer.money}`, "Ryntra couldn’t co-sign your launch. Nothing was sent.");
  useLangStore.setState({ lang: "uk" });
  const uk = readRefusal(sent("LAUNCH_SUBMIT_FAILED", "Ryntra's pool payer did not sign the launch; nothing was sent."));
  assert.equal(`${uk.what} ${uk.money}`, "Ryntra не змогла підписати твій запуск. Нічого не надіслано.");
  assert.equal(uk.act, "Спробувати ще раз");
  useLangStore.setState({ lang: "en" });
});

test("the money is said honestly: nothing before the send; after it, nothing left the wallet unless the chain may hold it", () => {
  for (const [name, failure, , , money] of CASES) {
    if (failure.stage === "before") assert.ok(["nothingSent", "nothingSigned", "nothingStored"].includes(money), name);
    /* A send with no answer, or one already sent, is never retried from the sheet: the chain may hold it. */
    if (money === "maybeLanded" || money === "landing") assert.equal(readRefusal(failure).action, "close", name);
  }
});

test("«Details» is for support: the code and the stage, the engine's words without addresses, links or paths", () => {
  const at = new Date("2026-11-02T10:20:30Z");
  const refusal = readRefusal(sent("LAUNCH_SUBMIT_FAILED", `Mint ${TOKEN} refused at https://rpc.example.org/x by /api/v1/launch/submit.`), "Phantom", at);
  const text = refusal.details.map((row) => `${row.label}: ${row.value}`).join("\n");
  assert.match(text, /Code: LAUNCH_SUBMIT_FAILED · while sending/);
  assert.match(text, /When: 2026-11-02 10:20:30 UTC/);
  assert.ok(!text.includes(TOKEN) && !text.includes("https://") && !text.includes("/api/"), text);
  assert.equal(supportText(`a ${TOKEN} b`), "a … b");
  assert.equal(readRefusal(before(CITY_CLOSED)).details.length, 1, "no message, no «Said» row, no time without one");
});

test("the text is read for a cause in one place, and only for the codes that carry several", () => {
  for (const [text, cause] of [
    ["Ryntra's pool payer did not sign the launch; nothing was sent.", "ryntraNotSigned"],
    ["the kms key did not sign (DEADLINE_EXCEEDED)", "ryntraNotSigned"],
    ["The executor did not sign.", "ryntraNotSigned"],
    ["Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.", "lowSol"],
    ["insufficient lamports 10, need 2039280", "lowSol"],
    ["Blockhash not found", "aged"],
    ["block height exceeded", "aged"],
    ["The network never saw the transaction before its blockhash expired.", "aged"],
    ["The node did not answer the send in time.", "networkBusy"],
    ["429 Too Many Requests", "networkBusy"],
    ["Launching is paused; nothing was built.", "paused"],
    ["User rejected the request.", "declined"],
    ["Stub wallet was closed before signing.", "declined"],
    ["", null],
    ['{"InstructionError":[2,{"Custom":6001}]}', null],
  ]) {
    assert.equal(causeOf(text), cause, text);
  }
  /* A code that names its cause is not second-guessed by its text. */
  assert.equal(readRefusal(before("LAUNCH_LIMIT", "insufficient funds")).kind, "limit");
});

test("every refusal the engine's launch flow writes reads as a named kind, never «something went wrong»", () => {
  /* The engine's own literals (`lib/launch/flow.server.ts`), read from its source so a new refusal is seen here. */
  const source = readFileSync(new URL("../../../lib/launch/flow.server.ts", import.meta.url), "utf8");
  const literals = [...source.matchAll(/fail\("([A-Z_]+)", "((?:[^"\\]|\\.)*)"\)/g)].map((m) => [m[1], m[2]]);
  assert.ok(literals.length > 20, "the engine's refusals were read");
  const submitOnly = new Set(["NOT_BUILT", "WRONG_CREATOR", "BUILD_EXPIRED", "SIGNATURE_MISSING", "SIGNED_OTHER_BYTES", "SUBMIT_FAILED", "BUILD_USED", "NETWORK_BUSY"]);
  for (const [code, message] of literals) {
    const mapped = LAUNCH_FAILURE_CODES[code];
    assert.ok(mapped, code);
    const failure = submitOnly.has(code) ? sent(mapped, message) : before(mapped, message);
    const refusal = readRefusal(failure, "Phantom");
    assert.notEqual(refusal.kind, "noAnswer", `${code}: ${message}`);
    assert.doesNotMatch(`${refusal.what} ${refusal.money}`, TECH, `${code}: ${message}`);
  }
  const payer = literals.find(([, message]) => /pool payer did not sign/.test(message));
  assert.ok(payer, "the pool payer's refusal is still the engine's");
  assert.equal(readRefusal(sent(LAUNCH_FAILURE_CODES[payer[0]], payer[1])).kind, "ryntraNotSigned");
});

test("the form's line keeps the refusal in one line", () => {
  assert.equal(failureWords(before("LAUNCH_IMAGE_REFUSED", "Ryntra took this picture down before; choose another.")), "Ryntra took this picture down before. Nothing was sent or stored.");
  assert.equal(failureWords(before("LAUNCH_NAME_BORROWED", "The name or ticker reads as Tesla.")), "This name or ticker reads as Tesla — pick your own. Nothing was sent.");
});
