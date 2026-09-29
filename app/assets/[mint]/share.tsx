"use client";

import { useState } from "react";

import styles from "@/app/product/product.module.css";

/**
 * Share, on the page whose whole purpose is being sent to someone.
 *
 * The Passport's address has always been the share mechanism — the acceptance
 * line calls for a control that uses it rather than a sentence saying it
 * exists. This is the platform's own share sheet where there is one, and the
 * clipboard where there is not, and it copies **the canonical URL** rather than
 * whatever is in the address bar: a link with a stray query on it is the same
 * page under a second name.
 *
 * It never asks for a permission it does not need and never fails loudly: a
 * browser that refuses the clipboard leaves the label unchanged, which is the
 * honest outcome — nothing was copied, and nothing said it was.
 */
export function SharePassport({ url, label, copied }: { url: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className={styles.ghost}
      onClick={async () => {
        try {
          if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            await navigator.share({ url });
            return;
          }
          await navigator.clipboard.writeText(url);
          setDone(true);
          window.setTimeout(() => setDone(false), 2_400);
        } catch {
          /* A dismissed share sheet and a refused clipboard are both ordinary
             answers. Neither is an error worth a banner, and neither may claim
             a copy that did not happen. */
        }
      }}
    >
      {done ? copied : label}
    </button>
  );
}
