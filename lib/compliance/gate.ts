/* Compliance gate — classifies Arcus's live `GET /v1/compliance` response (rwa-risk-signals #18)
   into the four INDEPENDENT states the founder's decision separates (DECISIONS 2026-07-08 /
   ROADMAP "Відкрите юр-питання"):
     - venueAllowed  — Arcus's own geo verdict, per product (spot / perps are independent booleans)
     - walletAllowed — Arcus wallet screening (COMPLIANT / BLOCKED), address-based
     - assetAllowed  — the instrument itself is listed/tradeable (not decided here)
     - issuerAllowed — RHJ (Jersey) issuer eligibility for Stock Tokens — NOT a hard gate here; it
                       is an always-shown DISCLOSURE, never a block (founder's locked call: gate on
                       Arcus compliance, never claim "available in Ukraine", never block UA).

   Honesty rules baked in (capability-honesty):
   - This IS the venue's own signal, called with the USER's IP client-side (a server proxy would use
     Ryntra's IP and return the wrong geo). Region-granular (Arcus restricts Crimea/Donetsk/Luhansk,
     not Ukraine) — we never re-derive geo ourselves.
   - `null` = not determined (fetch failed / not yet loaded). It is not an explicit restriction,
     but state-changing money paths must still require a fresh explicit allow from BOTH geo and
     wallet screening. Read-only callers may keep showing data while the check is unavailable.
     Unknown never reads as "all clear".
   - VPN/proxy circumvention is prohibited by Arcus Terms — we surface a detected bypass honestly and
     NEVER suggest using a VPN. */

export type ArcusCompliance = {
  geo?: {
    country?: string;
    region?: string;
    restrictions?: { spot?: boolean; perpetuals?: boolean };
    bypassed?: boolean;
  };
  address?: { address?: string; status?: string; reason?: string };
};

export type ComplianceVerdict = {
  /** Arcus allows state-changing SPOT actions from this caller's geo. null = not determined. */
  venueSpotAllowed: boolean | null;
  /** Arcus allows PERPS from this geo (independent of spot). null = not determined. */
  venuePerpsAllowed: boolean | null;
  /** Wallet screening: true = COMPLIANT, false = BLOCKED, null = not screened / unknown. */
  walletAllowed: boolean | null;
  /** Arcus flagged a VPN/proxy bypass on this connection. */
  bypassed: boolean | null;
  country: string | null;
  region: string | null;
  /** The single reason a state-changing SPOT action would be rejected, or null if allowed/unknown.
      "geo" = venue restricts this region; "wallet" = screened address is BLOCKED. Only an EXPLICIT
      restriction sets this — unknown (null) never blocks. Wallet takes precedence in the message. */
  spotBlockReason: "geo" | "wallet" | null;
};

export function classifyCompliance(r: ArcusCompliance | null, expectedAddress?: string): ComplianceVerdict {
  const spot = r?.geo?.restrictions?.spot;
  const perps = r?.geo?.restrictions?.perpetuals;
  const venueSpotAllowed = typeof spot === "boolean" ? !spot : null;
  const venuePerpsAllowed = typeof perps === "boolean" ? !perps : null;
  const status = r?.address?.status;
  const echoedAddress = r?.address?.address;
  // Arcus's documented response may omit an address echo. When it is present it must bind to the
  // wallet we queried; a mismatched echo is unknown and therefore blocks every money action.
  const addressMatches = !expectedAddress || echoedAddress == null
    || echoedAddress.toLowerCase() === expectedAddress.toLowerCase();
  const walletAllowed = !addressMatches
    ? null
    : status === "COMPLIANT" ? true : status === "BLOCKED" ? false : null;
  const bypassed = typeof r?.geo?.bypassed === "boolean" ? r.geo.bypassed : null;
  const spotBlockReason: "geo" | "wallet" | null =
    walletAllowed === false ? "wallet" : venueSpotAllowed === false ? "geo" : null;
  return {
    venueSpotAllowed,
    venuePerpsAllowed,
    walletAllowed,
    bypassed,
    country: r?.geo?.country ?? null,
    region: r?.geo?.region ?? null,
    spotBlockReason,
  };
}

/** A compliance allow is deliberately short-lived on a money path. The endpoint is client-side,
    so both the user's current IP posture and the connected public wallet must have been checked. */
export const SPOT_COMPLIANCE_MAX_AGE_MS = 60_000;

export function isSpotComplianceReady(
  verdict: ComplianceVerdict | null,
  checkedAt: number | null,
  nowMs = Date.now(),
  maxAgeMs = SPOT_COMPLIANCE_MAX_AGE_MS,
): boolean {
  if (!verdict || checkedAt == null || !Number.isFinite(checkedAt)) return false;
  const ageMs = nowMs - checkedAt;
  return ageMs >= 0 && ageMs <= maxAgeMs
    && verdict.venueSpotAllowed === true
    && verdict.walletAllowed === true
    && verdict.bypassed === false;
}
