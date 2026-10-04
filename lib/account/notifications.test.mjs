import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  connectTelegramChannel,
  deliverToTelegramChannel,
  disconnectTelegramChannel,
  isTelegramConnectCode,
  issueTelegramConnectCode,
  readTelegramChannel,
  telegramChannelView,
  telegramConnectLink,
  verifyTelegramConnectCode,
} from "./notifications.ts";

/*
 * Telegram as a notification channel.
 *
 * The code the bot reads from its `start` payload must fit Telegram's 64
 * characters, name exactly the account that asked, die after fifteen
 * minutes, and be worthless when forged. The binding it produces is one
 * chat per account, later wins, and removable without a trace.
 */
const ACCOUNT = "3f9a1c2e-7b4d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const T0 = Date.parse("2026-09-11T10:00:00.000Z");

describe("telegram connect code", () => {
  let previous;
  beforeEach(() => {
    previous = process.env.BETA_TOKEN_SECRET;
    process.env.BETA_TOKEN_SECRET = "stand-secret-of-at-least-sixteen";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.BETA_TOKEN_SECRET;
    else process.env.BETA_TOKEN_SECRET = previous;
  });

  it("fits the bot's start payload and names the account back", () => {
    const code = issueTelegramConnectCode(ACCOUNT, T0);
    assert.ok(code);
    assert.ok(code.length <= 64, `payload is ${code.length} characters`);
    assert.match(code, /^[A-Za-z0-9_-]+$/);
    assert.ok(isTelegramConnectCode(code));
    assert.deepEqual(verifyTelegramConnectCode(code, T0 + 60_000), { accountId: ACCOUNT });
    assert.equal(telegramConnectLink(code), `https://t.me/RyntraBeta_bot?start=${code}`);
  });

  it("dies after fifteen minutes", () => {
    const code = issueTelegramConnectCode(ACCOUNT, T0);
    assert.ok(verifyTelegramConnectCode(code, T0 + 14 * 60_000));
    assert.equal(verifyTelegramConnectCode(code, T0 + 16 * 60_000), null);
  });

  it("refuses a forged signature, a renamed account and a stranger's payload", () => {
    const code = issueTelegramConnectCode(ACCOUNT, T0);
    const [prefix, id, expires, signature] = code.split("_");
    const flipped = signature.endsWith("0") ? `${signature.slice(0, -1)}1` : `${signature.slice(0, -1)}0`;
    assert.equal(verifyTelegramConnectCode(`${prefix}_${id}_${expires}_${flipped}`, T0), null);
    const otherId = issueTelegramConnectCode(OTHER, T0).split("_")[1];
    assert.equal(verifyTelegramConnectCode(`${prefix}_${otherId}_${expires}_${signature}`, T0), null);
    assert.equal(verifyTelegramConnectCode("ntf_not-a-code", T0), null);
    assert.equal(verifyTelegramConnectCode("ref_abc", T0), null);
    assert.equal(isTelegramConnectCode("ref_abc"), false);
    assert.equal(isTelegramConnectCode(null), false);
  });

  it("issues nothing without the secret and verifies nothing either", () => {
    const code = issueTelegramConnectCode(ACCOUNT, T0);
    delete process.env.BETA_TOKEN_SECRET;
    assert.equal(issueTelegramConnectCode(ACCOUNT, T0), null);
    assert.equal(verifyTelegramConnectCode(code, T0), null);
    process.env.BETA_TOKEN_SECRET = "short";
    assert.equal(issueTelegramConnectCode(ACCOUNT, T0), null);
  });

  it("refuses an account id that is not a uuid", () => {
    assert.equal(issueTelegramConnectCode("owner", T0), null);
  });
});

describe("telegram channel binding", () => {
  it("connects, re-binds to the later chat, reads back and disconnects", async () => {
    const store = createMemoryGuardStore();
    assert.equal(await readTelegramChannel(store, ACCOUNT), null);
    assert.deepEqual(telegramChannelView(null), { connected: false, username: null, connectedAt: null });

    const first = await connectTelegramChannel(store, { accountId: ACCOUNT, telegramId: 777, username: "qa_tester", now: "2026-09-11T10:00:00.000Z" });
    assert.equal(first?.version, 0);
    assert.deepEqual(telegramChannelView(await readTelegramChannel(store, ACCOUNT)), { connected: true, username: "qa_tester", connectedAt: "2026-09-11T10:00:00.000Z" });

    const second = await connectTelegramChannel(store, { accountId: ACCOUNT, telegramId: 888, username: null, now: "2026-09-11T11:00:00.000Z" });
    assert.equal(second?.version, 1);
    const read = await readTelegramChannel(store, ACCOUNT);
    assert.equal(read?.telegramId, 888);
    assert.equal(read?.username, null);

    assert.equal(await readTelegramChannel(store, OTHER), null);
    assert.equal(await disconnectTelegramChannel(store, ACCOUNT), true);
    assert.equal(await readTelegramChannel(store, ACCOUNT), null);
    assert.equal(await disconnectTelegramChannel(store, ACCOUNT), true);
  });

  it("never lets the Telegram id into the view", async () => {
    const store = createMemoryGuardStore();
    await connectTelegramChannel(store, { accountId: ACCOUNT, telegramId: 777, username: "qa_tester", now: "2026-09-11T10:00:00.000Z" });
    const view = telegramChannelView(await readTelegramChannel(store, ACCOUNT));
    assert.deepEqual(Object.keys(view).sort(), ["connected", "connectedAt", "username"]);
  });

  it("delivers to the bound chat and says so when there is none", async () => {
    const store = createMemoryGuardStore();
    const sent = [];
    const send = async (chatId, text) => { sent.push([chatId, text]); };
    assert.equal(await deliverToTelegramChannel(store, ACCOUNT, "hello", send), "no_channel");
    await connectTelegramChannel(store, { accountId: ACCOUNT, telegramId: 777, username: "qa_tester", now: "2026-09-11T10:00:00.000Z" });
    assert.equal(await deliverToTelegramChannel(store, ACCOUNT, "hello", send), "sent");
    assert.deepEqual(sent, [[777, "hello"]]);
    assert.equal(await deliverToTelegramChannel(store, ACCOUNT, "again", async () => { throw new Error("down"); }), "failed");
  });
});
