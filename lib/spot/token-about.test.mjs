import assert from "node:assert/strict";
import test from "node:test";

import { ABOUT_MAX_CHARS, descriptionOf, gatewayCandidates, isPrivateAddress, linkFace, metadataAddress, metaplexUri, publicHttpsUrl, token2022Uri, withoutNames } from "./token-about.ts";

/**
 * «Що це за монета»: the creator's description is read from the URI the mint
 * names, fetched only from a public https host, and drawn as plain bounded
 * text — or not at all, with the reason said.
 */

const borsh = (text, pad = 0) => {
  const bytes = new TextEncoder().encode(text + "\0".repeat(pad));
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
};

const metadataAccount = (uri, key = 4) => {
  const parts = [Uint8Array.of(key), new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), borsh("Jupiter", 25), borsh("JUP", 7), borsh(uri, 200 - uri.length), new Uint8Array(40)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

test("the Metaplex account's URI is read past the name and the symbol, its padding stripped; another account is no URI", () => {
  assert.equal(metaplexUri(metadataAccount("https://static.jup.ag/jup/metadata.json")), "https://static.jup.ag/jup/metadata.json");
  assert.equal(metaplexUri(metadataAccount("https://static.jup.ag/jup/metadata.json", 1)), null, "key 1 is not a MetadataV1 account");
  assert.equal(metaplexUri(new Uint8Array(10)), null);
});

test("a Token-2022 mint's own metadata extension names its URI; a mint without one names none", () => {
  assert.equal(token2022Uri({ __option: "Some", value: [{ __kind: "TransferFeeConfig" }, { __kind: "TokenMetadata", uri: "https://example.com/m.json" }] }), "https://example.com/m.json");
  assert.equal(token2022Uri({ __option: "Some", value: [{ __kind: "TransferFeeConfig" }] }), null);
  assert.equal(token2022Uri({ __option: "None" }), null);
  assert.equal(token2022Uri(undefined), null);
});

test("only https to a public host name is fetched — never an IP literal, localhost, a private suffix or credentials", () => {
  assert.equal(publicHttpsUrl("https://arweave.net/abc"), true);
  assert.equal(publicHttpsUrl("http://arweave.net/abc"), false);
  assert.equal(publicHttpsUrl("https://169.254.169.254/latest"), false);
  assert.equal(publicHttpsUrl("https://[::1]/x"), false);
  assert.equal(publicHttpsUrl("https://localhost/x"), false);
  assert.equal(publicHttpsUrl("https://db.internal/x"), false);
  assert.equal(publicHttpsUrl("https://user:pass@example.com/x"), false);
  assert.equal(publicHttpsUrl("https://example/x"), false);
});

test("ipfs:// and ar:// read through their public gateways; a padded or refused URI is no address", () => {
  assert.equal(metadataAddress("ipfs://bafkreiabc/meta.json"), "https://ipfs.io/ipfs/bafkreiabc/meta.json");
  assert.equal(metadataAddress("ipfs://ipfs/Qm123"), "https://ipfs.io/ipfs/Qm123");
  assert.equal(metadataAddress("ar://abc_DEF-1"), "https://arweave.net/abc_DEF-1");
  assert.equal(metadataAddress("https://example.com/m.json\0\0\0"), "https://example.com/m.json");
  assert.equal(metadataAddress(""), null);
  assert.equal(metadataAddress("http://example.com/m.json"), null);
  assert.equal(metadataAddress("https://10.0.0.1/m.json"), null);
});

test("a busy IPFS gateway is asked of the others, path-style and subdomain-style alike", () => {
  assert.deepEqual(gatewayCandidates("https://ipfs.io/ipfs/QmAbc/1.json"), ["https://ipfs.io/ipfs/QmAbc/1.json", "https://ipfs.filebase.io/ipfs/QmAbc/1.json", "https://ipfs.raribleuserdata.com/ipfs/QmAbc/1.json"]);
  const cid = "bafkreihwqhounu3cdwgvk2gc2dqcinpntlccbo3xcy4xuerd24yndldl5q";
  assert.deepEqual(gatewayCandidates(`https://${cid}.ipfs.nftstorage.link`), [`https://ipfs.filebase.io/ipfs/${cid}`, `https://ipfs.raribleuserdata.com/ipfs/${cid}`, `https://${cid}.ipfs.nftstorage.link`]);
  assert.deepEqual(gatewayCandidates("https://arweave.net/abc"), ["https://arweave.net/abc"]);
});

test("the description is plain text — no control or invisible characters, one paragraph, bounded — and none when it only repeats the name", () => {
  assert.equal(descriptionOf({ description: "JUP is the official governance token for Jupiter." }), "JUP is the official governance token for Jupiter.");
  assert.equal(descriptionOf({ description: "  Line one\n\nline​ two\u0007  " }), "Line one line two");
  assert.equal(descriptionOf({ description: "Jupiter" }, ["Jupiter", "JUP"]), null);
  assert.equal(descriptionOf({ description: "" }), null);
  assert.equal(descriptionOf({ description: 42 }), null);
  assert.equal(descriptionOf({}), null);
  assert.equal(descriptionOf(null), null);
  assert.equal(descriptionOf(["description"]), null);
  const long = descriptionOf({ description: "word ".repeat(200) });
  assert.ok(long.length <= ABOUT_MAX_CHARS + 1, "bounded");
  assert.ok(long.endsWith("…"), "a cut says it was cut");
  assert.ok(!/\s…$/.test(long), "cut at a word");
});

test("a creator's link is named by where it goes: X and Telegram faces only on their own hosts, any other address by its host", () => {
  assert.deepEqual(linkFace("twitter", "https://twitter.com/JupiterExchange"), { label: "@JupiterExchange", mark: "x" });
  assert.deepEqual(linkFace("twitter", "https://x.com/i/communities/123"), { label: "X", mark: "x" });
  assert.deepEqual(linkFace("twitter", "https://claim-airdrop.example/x"), { label: "claim-airdrop.example", mark: "site" }, "an X field pointing elsewhere is never shown as X");
  assert.deepEqual(linkFace("telegram", "https://t.me/jup_ag"), { label: "@jup_ag", mark: "telegram" });
  assert.deepEqual(linkFace("telegram", "https://t.me/+AbCdEf"), { label: "Telegram", mark: "telegram" });
  assert.deepEqual(linkFace("telegram", "https://wallet-connect.example/tg"), { label: "wallet-connect.example", mark: "site" });
  assert.deepEqual(linkFace("website", "https://www.jup.ag/"), { label: "jup.ag", mark: "site" });
});

test("a description that only repeats the name is filtered for the caller, never in what is kept", () => {
  const kept = { state: "described", description: "Jupiter" };
  assert.deepEqual(withoutNames(kept, ["jupiter"]), { state: "silent", description: null });
  assert.deepEqual(withoutNames(kept, ["JUP"]), kept);
  assert.deepEqual(withoutNames({ state: "unread", description: null }, ["x"]), { state: "unread", description: null });
});

test("a name resolving to a private, loopback or link-local address is refused", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["104.18.1.1", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"]) assert.equal(isPrivateAddress(ip), false, ip);
});
