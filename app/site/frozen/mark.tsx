import { R_MARK_PATHS, R_MARK_VIEWBOX, RYNTRA_GRADIENT } from "@/app/brand/mark";
import { RyntraBrand } from "@/app/brand/ryntra-brand";
import styles from "./chrome.module.css";

/*
 * The Ryntra R on the public pages — the canonical geometry from
 * `app/brand/mark.ts`, never a second outline. One gradient definition per
 * page; every mark instance points its fill at it, so the mark sits on the
 * dark and the light band without a second asset and stays crisp from 22px
 * to the footer.
 */

/** Rendered once per page; every mark instance points its fill at this. */
export function MarkDefs() {
  return (
    <svg aria-hidden="true" width="0" height="0" className={styles.defs}>
      <defs>
        <linearGradient id="ry-mark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={RYNTRA_GRADIENT.from} />
          <stop offset="100%" stopColor={RYNTRA_GRADIENT.to} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function RMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox={R_MARK_VIEWBOX}
      width={size}
      height={size}
      fill="url(#ry-mark-grad)"
      aria-hidden="true"
      className={styles.mark}
    >
      <path d={R_MARK_PATHS} />
    </svg>
  );
}

/**
 * The full lockup: the brand's wordmark, the mark being its first letter.
 * `compact` keeps the name for the callers that pass it; the raster scales.
 */
export function Lockup({ size = 22 }: { size?: number; compact?: boolean }) {
  return (
    <span className={styles.lockup}>
      <RyntraBrand size={size} />
    </span>
  );
}
