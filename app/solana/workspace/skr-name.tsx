"use client";

import { useEffect, useState } from "react";

import { skrNameFor } from "@/lib/solana/skr.client";

/**
 * The `.skr` name to show for an address (SKR-4), or `null` while it is read, when there is none and when it could
 * not be read — the address stands where the name would, so nothing on screen waits for it.
 *
 * `self` is for the connected wallet only: the first name it holds counts when it chose no primary one. For anybody
 * else — a recipient, a receipt's counterparty — only the primary name, the one that wallet chose.
 */
export function useSkrName(address: string | null | undefined, options: Readonly<{ self?: boolean }> = {}): string | null {
  const self = options.self === true;
  const [shown, setShown] = useState<Readonly<{ address: string; name: string | null }> | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    void skrNameFor(address, { self }).then((name) => {
      if (live) setShown({ address, name });
    });
    return () => {
      live = false;
    };
  }, [address, self]);
  /* Only the answer for this address: a wallet just switched never wears the last one's name. */
  return address && shown?.address === address ? shown.name : null;
}
