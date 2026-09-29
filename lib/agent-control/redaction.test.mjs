// Run from repo root: node --test lib/agent-control/redaction.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { AGENT_CONTROL_REDACTION_MARKER, redactAgentControlLog } = await import(
  "./redaction.ts"
);

const REDACTED = AGENT_CONTROL_REDACTION_MARKER;

test("Agent Control log redaction is recursive across signatures, tokens, headers and queries", () => {
  const source = {
    authorization: "Bearer top-secret",
    signatureRef: `0x${"aa".repeat(32)}`,
    assetToken: "eip155:97/erc20:0xasset",
    nested: {
      walletSignature: `0x${"11".repeat(65)}`,
      token: "raw-token",
      access_token: "raw-access-token",
      headers: {
        Authorization: "Bearer nested-secret",
        Cookie: "session=secret",
        "X-Api-Key": "api-secret",
        "X-Signature": "signature-secret",
        Accept: "application/json",
      },
      requestHeaders: [
        "Authorization: Bearer block-secret",
        "Content-Type: application/json",
        "Set-Cookie: session=block-secret",
      ].join("\r\n"),
      requestUrl:
        "https://example.test/jobs?access%5Ftoken=url-secret&page=2&signature=signed#result",
      relativeUrl: "/verify?api_key=query-secret&receipt=public-receipt",
      query: {
        refreshToken: "refresh-secret",
        page: "2",
      },
      list: [{ session_token: "array-secret", value: "visible" }],
    },
  };

  const redacted = redactAgentControlLog(source);
  assert.deepEqual(redacted, {
    authorization: REDACTED,
    signatureRef: source.signatureRef,
    assetToken: source.assetToken,
    nested: {
      walletSignature: REDACTED,
      token: REDACTED,
      access_token: REDACTED,
      headers: {
        Authorization: REDACTED,
        Cookie: REDACTED,
        "X-Api-Key": REDACTED,
        "X-Signature": REDACTED,
        Accept: "application/json",
      },
      requestHeaders: [
        `Authorization: ${REDACTED}`,
        "Content-Type: application/json",
        `Set-Cookie: ${REDACTED}`,
      ].join("\r\n"),
      requestUrl:
        `https://example.test/jobs?access%5Ftoken=${REDACTED}&page=2&signature=${REDACTED}#result`,
      relativeUrl: `/verify?api_key=${REDACTED}&receipt=public-receipt`,
      query: {
        refreshToken: REDACTED,
        page: "2",
      },
      list: [{ session_token: REDACTED, value: "visible" }],
    },
  });

  assert.equal(source.nested.walletSignature.startsWith("0x11"), true);
  assert.equal(source.nested.headers.Authorization, "Bearer nested-secret");
  assert.match(source.nested.requestUrl, /url-secret/);
});

test("redaction tolerates primitive and malformed query values without exposing recognized secrets", () => {
  assert.equal(redactAgentControlLog(null), null);
  assert.equal(redactAgentControlLog(42), 42);
  assert.equal(redactAgentControlLog("plain text"), "plain text");
  assert.equal(
    redactAgentControlLog("/?token=one&ok=yes&sig=two&broken=%E0%A4%A"),
    `/?token=${REDACTED}&ok=yes&sig=${REDACTED}&broken=%E0%A4%A`,
  );
});
