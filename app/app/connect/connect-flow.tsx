"use client";

import { useCallback, useEffect, useState } from "react";
import type { CbCopy } from "../copy";
import {
  createApiKeyMessage,
  forgetKey,
  generateKeypair,
  loadKey,
  revokeApiKeyMessage,
  saveKey,
  splitSignature,
  utf8ToHex,
  type StoredKey,
} from "@/lib/arcus/client-keys";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const KEY_NAME = "ryntra-live";
// 30 days (Arcus allows up to 180, default 14). Short-lived keys bound the blast radius of a
// compromised device; re-creating one is a single wallet signature.
const KEY_TTL_MS = 30 * 24 * 3600 * 1000;

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function ConnectFlow({
  c,
  initialAddress = null,
  onCredentialStateChange,
}: {
  c: CbCopy["connect"];
  initialAddress?: string | null;
  onCredentialStateChange?: (state: "ACTIVE" | "NONE") => void;
}) {
  const [address, setAddress] = useState<string | null>(initialAddress);
  const [walletMissing, setWalletMissing] = useState(false);
  const [key, setKey] = useState<StoredKey | null>(null);
  const [phase, setPhase] = useState<"idle" | "signing" | "registering" | "revoking">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [onchain, setOnchain] = useState<"unknown" | "checking" | "found" | "notfound">("unknown");
  /** upstream revoke failed → offer the honest local-only removal (key stays active on Arcus) */
  const [revokeFailed, setRevokeFailed] = useState(false);
  const [revokedOk, setRevokedOk] = useState(false);

  useEffect(() => {
    if (address) {
      void loadKey(address).then((stored) => {
        setKey(stored);
        onCredentialStateChange?.(stored ? "ACTIVE" : "NONE");
      });
    } else {
      setKey(null);
      onCredentialStateChange?.("NONE");
    }
    setOnchain("unknown");
    setRevokeFailed(false);
    setRevokedOk(false);
    setErr(null);
  }, [address, onCredentialStateChange]);

  const connect = useCallback(async () => {
    setErr(null);
    const eth = (window as unknown as { ethereum?: Eth }).ethereum;
    if (!eth) { setWalletMissing(true); return; }
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0];
      if (!addr) return;
      setAddress(addr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "wallet request rejected");
    }
  }, []);

  const createKey = useCallback(async () => {
    if (!address) return;
    setErr(null);
    setPhase("signing");
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) { setWalletMissing(true); setPhase("idle"); return; }
      const pair = await generateKeypair();
      const validUntil = Date.now() + KEY_TTL_MS;
      // Persist BEFORE registering on Arcus and verify the round-trip: if IndexedDB can't hold the
      // key (CryptoKey clone quirks, private mode, quota), we must find out while the key is still
      // inert — a save failure AFTER registration would orphan a live 30-day key with no revoke UI.
      const stored: StoredKey = {
        v: 2,
        address: address.toLowerCase(),
        name: KEY_NAME,
        publicKey: pair.publicKey,
        // non-extractable CryptoKey where supported; raw seed only on the legacy fallback path
        ...(pair.credential ? { credential: pair.credential } : { privateKey: pair.privateKey }),
        validUntil,
        createdAt: Date.now(),
      };
      await saveKey(stored);
      const persisted = await loadKey(address);
      if (persisted?.publicKey !== pair.publicKey) throw new Error("this browser could not persist the key — try a regular (non-private) window");
      const message = createApiKeyMessage(KEY_NAME, pair.publicKey, validUntil);
      const sig = (await eth.request({
        method: "personal_sign",
        params: [utf8ToHex(message), address],
      })) as string;
      setPhase("registering");
      const r = await fetch("/api/arcus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "createApiKey",
          address,
          publicKey: pair.publicKey,
          apiWalletName: KEY_NAME,
          validUntil,
          signature: splitSignature(sig),
        }),
      });
      const text = await r.text();
      if (!r.ok) {
        // registration failed → the drafted local key is useless; drop it and surface the exact error
        await forgetKey(address).catch(() => undefined);
        setErr(`Arcus ${r.status}: ${text.slice(0, 300)}`);
        setPhase("idle");
        return;
      }
      setKey(stored);
      onCredentialStateChange?.("ACTIVE");
      setPhase("idle");
    } catch (e) {
      // any failure before a confirmed registration → drop the drafted local key so an
      // unregistered key never shows up as "active on this device"
      await forgetKey(address).catch(() => undefined);
      setErr(e instanceof Error ? e.message : "signature rejected");
      setPhase("idle");
    }
  }, [address, onCredentialStateChange]);

  const checkOnchain = useCallback(async () => {
    if (!address || !key) return;
    setOnchain("checking");
    try {
      const r = await fetch(`/api/arcus?kind=apikeys&address=${address}`);
      const j = await r.text();
      setOnchain(j.includes(key.publicKey) || j.includes(key.publicKey.slice(0, 16)) ? "found" : "notfound");
    } catch {
      setOnchain("notfound");
    }
  }, [address, key]);

  /** Revoke on Arcus (wallet-signed) FIRST, then remove locally. A key deleted only from this
      device would stay valid on Arcus until expiry — that's not what "forget" should mean. */
  const forget = useCallback(async () => {
    if (!address || !key) return;
    setErr(null); setRevokedOk(false); setRevokeFailed(false);
    setPhase("revoking");
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error("wallet not available");
      const message = revokeApiKeyMessage(key.name, key.publicKey);
      const sig = (await eth.request({ method: "personal_sign", params: [utf8ToHex(message), address] })) as string;
      const r = await fetch("/api/arcus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "revokeApiKey",
          address,
          publicKey: key.publicKey,
          apiWalletName: key.name,
          signature: splitSignature(sig),
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Arcus ${r.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      // honest failure: the key is NOT revoked upstream — keep it here and offer local-only removal
      setErr(e instanceof Error ? e.message : "revoke failed");
      setRevokeFailed(true);
      setPhase("idle");
      return;
    }
    // upstream confirmed the revoke — the key is dead on Arcus regardless of what local cleanup does
    await forgetKey(address).catch(() => undefined);
    setKey(null);
    onCredentialStateChange?.("NONE");
    setOnchain("unknown");
    setRevokedOk(true);
    setPhase("idle");
  }, [address, key, onCredentialStateChange]);

  /** Local-only removal after a failed revoke — the key stays active on Arcus until expiry. */
  const forgetLocalOnly = useCallback(async () => {
    if (!address) return;
    await forgetKey(address);
    setKey(null);
    onCredentialStateChange?.("NONE");
    setOnchain("unknown");
    setRevokeFailed(false);
  }, [address, onCredentialStateChange]);

  return (
    <>
      {/* step 1: wallet */}
      <section className="cb-card cb-span2">
        <div className="cb-card-head"><h2>{c.step1}</h2>{address ? <span className="cb-badge">{c.step1Connected}</span> : null}</div>
        <p className="cb-hint">{c.step1Body}</p>
        <p className="cb-hint">{c.step1Boundary}</p>
        {address ? (
          <>
            <p className="cb-hint mono">{short(address)}</p>
          </>
        ) : walletMissing ? (
          <p className="dm-warnline">{c.step1NoWallet}</p>
        ) : (
          <button className="btn btn-primary btn-sm cb-card-cta" onClick={() => void connect()}>{c.step1Cta}</button>
        )}
      </section>

      {/* step 2: trading key */}
      <section className="cb-card cb-span2">
        <div className="cb-card-head"><h2>{c.step2}</h2>{key ? <span className="cb-badge">{KEY_NAME}</span> : null}</div>
        <p className="cb-hint">{c.step2Body}</p>
        <p className="cb-hint">{c.step2Authority}</p>
        {key ? (
          <>
            <p className="cb-hint mono">{c.step2Active}: {key.publicKey.slice(0, 12)}…{key.publicKey.slice(-8)}</p>
            <p className="cb-hint">{c.step2Expires} {new Date(key.validUntil).toLocaleDateString("en-GB")}</p>
            <button className="btn btn-ghost btn-sm cb-card-cta" disabled={phase !== "idle"} onClick={() => void forget()}>
              {phase === "revoking" ? c.step2Revoking : c.step2Forget}
            </button>
            {revokeFailed ? (
              <button className="btn btn-ghost btn-sm cb-card-cta" disabled={phase !== "idle"} onClick={() => void forgetLocalOnly()}>{c.step2ForgetLocal}</button>
            ) : null}
          </>
        ) : revokedOk ? (
          <>
            <p className="cb-ok">{c.step2Revoked}</p>
            <button
              className="btn btn-primary btn-sm cb-card-cta"
              disabled={!address || phase !== "idle"}
              onClick={() => void createKey()}
            >
              {phase === "signing" ? c.step2Signing : phase === "registering" ? "…" : c.step2Cta}
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary btn-sm cb-card-cta"
            disabled={!address || phase !== "idle"}
            onClick={() => void createKey()}
          >
            {phase === "signing" ? c.step2Signing : phase === "registering" ? "…" : c.step2Cta}
          </button>
        )}
      </section>

      {/* step 3: on-chain verification */}
      <section className="cb-card cb-span2">
        <div className="cb-card-head"><h2>{c.step3}</h2>{onchain === "found" ? <span className="cb-badge" lang="en">KEY ACTIVE</span> : null}</div>
        {onchain === "found" ? <p className="cb-ok">{c.step3Found}</p> : null}
        {onchain === "notfound" ? <p className="dm-warnline">{c.step3NotFound}</p> : null}
        <button className="btn btn-ghost btn-sm cb-card-cta" disabled={!key || onchain === "checking"} onClick={() => void checkOnchain()}>
          {onchain === "checking" ? "…" : c.step3Cta}
        </button>
      </section>

      {err ? <p className="dm-err cb-span2">{err}</p> : null}

      <section className="cb-card cb-span2">
        <p className="cb-hint">{c.nextNote}</p>
        <ul className="cb-sec-list">
          <li>{c.trust1}</li>
          <li>{c.trust2}</li>
          <li>{c.trust3}</li>
        </ul>
      </section>
    </>
  );
}
