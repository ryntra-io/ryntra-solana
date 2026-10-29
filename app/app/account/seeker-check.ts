"use client";

import { useEffect, useState } from "react";

/**
 * «Перевірено Seeker» for the signed-in wallet (SKR-3).
 *
 * The server decides: `GET /api/v1/auth/seeker` reads the Seeker Genesis Token
 * of the wallet this session proved by signature — the browser names no
 * address and is never believed about one. The mark shows only on a
 * `verified: true` for the very address the panel names (the wallet signed in
 * with, else the one connected): a browser can hold a second, newer proof for
 * another wallet, and the server answers for that one. «None», a refusal or a
 * chain that could not be read (503) show nothing — a mark is not a place for
 * an error, and «not now» is not «no Seeker».
 *
 * One read per signed-in wallet for a few minutes, shared by every panel that
 * opens in that time; the server keeps its own answer longer.
 */

const KEEP_MS = 5 * 60_000;
type Answer = Readonly<{ address: string; verified: boolean }>;
let kept: { key: string; answer: Answer; at: number } | null = null;
let pending: { key: string; read: Promise<Answer | null> } | null = null;
/* Bumped on sign-out: a read still on its way belongs to the account before. */
let generation = 0;

async function readSeeker(): Promise<Answer | null> {
  try {
    const response = await fetch("/api/v1/auth/seeker", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: unknown; verified?: unknown };
    return typeof body.address === "string" ? { address: body.address, verified: body.verified === true } : null;
  } catch {
    return null;
  }
}

function seekerFor(key: string): Promise<Answer | null> {
  if (kept && kept.key === key && Date.now() - kept.at < KEEP_MS) return Promise.resolve(kept.answer);
  if (pending && pending.key === key) return pending.read;
  const asked = generation;
  const read = readSeeker().then((answer) => {
    if (asked !== generation) return null;
    if (answer) kept = { key, answer, at: Date.now() };
    if (pending?.read === read) pending = null;
    return answer;
  });
  pending = { key, read };
  return read;
}

/** Forget every answer: the next account in this tab reads its own. */
export function forgetSeeker(): void {
  generation += 1;
  kept = null;
  pending = null;
}

/** True only when the server read an SGT on the very wallet the panel names. */
export function useSeekerVerified(signedIn: boolean, walletAddress: string | null, connectedAddress: string | null): boolean {
  const [verified, setVerified] = useState(false);
  const named = walletAddress ?? connectedAddress;
  const key = signedIn && named ? named : null;
  useEffect(() => {
    if (!signedIn) forgetSeeker();
    if (!key) {
      setVerified(false);
      return;
    }
    let live = true;
    void seekerFor(key).then((answer) => {
      if (live) setVerified(answer?.verified === true && answer.address === key);
    });
    return () => {
      live = false;
    };
  }, [key, signedIn]);
  return verified;
}
