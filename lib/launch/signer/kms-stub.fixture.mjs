/**
 * Tests only (CITY-162): a stand-in for Google Cloud KMS on 127.0.0.1 that answers the two calls the `kms` adapter
 * makes, in KMS's own REST format — `GET /v1/{version}/publicKey` (`pem`, `algorithm`, `pemCrc32c`, `name`,
 * `protectionLevel`) and `POST /v1/{version}:asymmetricSign` (`data` + `dataCrc32c` in; `signature`,
 * `signatureCrc32c`, `verifiedDataCrc32c`, `name` out). Its keys are throwaway ed25519 keys made in memory for the
 * run, one per key version; `faults` bends an answer the way a broken or hostile server would.
 */

import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";

import { crc32c } from "./gcp-kms.server.ts";

export const STUB_TOKEN = "stub-access-token";

/** A key version's name in the stub's project. */
export const versionName = (key, version = 1) => `projects/ryntra-test/locations/europe-west1/keyRings/launch/cryptoKeys/${key}/cryptoKeyVersions/${version}`;

/**
 * Starts the stub. `faults`: `algorithm` (another algorithm named), `pemCrc` (a wrong PEM checksum), `signatureCrc`
 * (a wrong signature checksum), `unverified` (`verifiedDataCrc32c: false`), `otherName` (another version answers),
 * `wrongSignature` (a signature by another key), `denied` (403 PERMISSION_DENIED).
 */
export async function startKmsStub() {
  const keys = new Map();
  const faults = new Set();
  const calls = [];
  const keyOf = (name) => {
    let key = keys.get(name);
    if (!key) {
      key = generateKeyPairSync("ed25519");
      keys.set(name, key);
    }
    return key;
  };
  const addressOf = (name) => getBase58Decoder().decode(Buffer.from(keyOf(name).publicKey.export({ format: "der", type: "spki" })).subarray(-32));
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = decodeURIComponent(request.url ?? "");
    calls.push({ method: request.method, url, authorization: request.headers.authorization ?? null, body });
    const answer = (status, json) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(json));
    };
    if (request.headers.authorization !== `Bearer ${STUB_TOKEN}`) return answer(401, { error: { code: 401, status: "UNAUTHENTICATED", message: "no token" } });
    if (faults.has("denied")) return answer(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Permission 'cloudkms.cryptoKeyVersions.useToSign' denied" } });
    const publicKey = url.match(/^\/v1\/(projects\/.+\/cryptoKeyVersions\/\d+)\/publicKey$/);
    if (request.method === "GET" && publicKey) {
      const name = publicKey[1];
      const pem = keyOf(name).publicKey.export({ format: "pem", type: "spki" }).toString();
      return answer(200, {
        pem,
        algorithm: faults.has("algorithm") ? "EC_SIGN_P256_SHA256" : "EC_SIGN_ED25519",
        pemCrc32c: String(faults.has("pemCrc") ? crc32c(Buffer.from(pem)) ^ 1 : crc32c(Buffer.from(pem))),
        name,
        protectionLevel: "HSM",
      });
    }
    const signing = url.match(/^\/v1\/(projects\/.+\/cryptoKeyVersions\/\d+):asymmetricSign$/);
    if (request.method === "POST" && signing) {
      const name = signing[1];
      const { data, dataCrc32c, digest } = JSON.parse(body || "{}");
      if (digest !== undefined) return answer(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Ed25519 signs data, not a digest" } });
      const bytes = Buffer.from(data ?? "", "base64");
      const intact = dataCrc32c !== undefined && Number(dataCrc32c) === crc32c(bytes);
      const signer = faults.has("wrongSignature") ? generateKeyPairSync("ed25519").privateKey : keyOf(name).privateKey;
      const signature = sign(null, bytes, signer);
      return answer(200, {
        signature: signature.toString("base64"),
        signatureCrc32c: String(faults.has("signatureCrc") ? crc32c(signature) ^ 1 : crc32c(signature)),
        verifiedDataCrc32c: faults.has("unverified") ? false : intact,
        name: faults.has("otherName") ? name.replace(/\/\d+$/, "/99") : name,
        protectionLevel: "HSM",
      });
    }
    return answer(404, { error: { code: 404, status: "NOT_FOUND", message: url } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}`,
    addressOf,
    faults,
    calls,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
