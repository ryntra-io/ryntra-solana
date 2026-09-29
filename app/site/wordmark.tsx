/**
 * Compatibility name for the canonical brand lockup.
 *
 * The drawn "circuit R" that used to live here is retired by the 2026-08-09
 * founder brand decision: one official mark (the geometric R from
 * `LOGO/logo2.png`), one lockup, everywhere. This file draws nothing —
 * `app/brand/ryntra-brand.tsx` is the single source, and the brand test fails
 * any file that grows a vector logo of its own.
 */
export { RyntraBrand as Wordmark } from "@/app/brand/ryntra-brand";
