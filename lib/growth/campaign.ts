/**
 * Closed grammar for Telegram start payloads.
 *
 * A campaign token is an analytics label and nothing else. It never grants access,
 * never carries a credential, and is never evidence that X caused what a user did
 * next. Everything this module cannot parse with certainty becomes `unsupported`,
 * and an unsupported payload still leaves the user with ordinary direct access.
 *
 * Two namespaces exist and they never mix:
 *   x_*   - campaign attribution, versioned, parsed here
 *   ref_* - legacy referral identifiers, recognised only so they can never be
 *           mistaken for campaign attribution. They grant no access, priority,
 *           status, credit or reward.
 */

/** Telegram's own limit on the start parameter. */
export const START_PAYLOAD_MAX_LENGTH = 64;

export const CAMPAIGN_SOURCE = "x";
export const SUPPORTED_CAMPAIGN_VERSION = "v1";
export const CAMPAIGN_COMPONENT_MAX_LENGTH = 16;
export const REFERRAL_CODE_MAX_LENGTH = 32;

/** The whole payload: letters, digits, underscore and hyphen. Underscore separates fields. */
const PAYLOAD_CHARSET = /^[A-Za-z0-9_-]+$/;

/**
 * A single field. Deliberately excludes the underscore: the underscore is the
 * separator, so allowing it inside a field would make `x_v1_a_b_c_d` ambiguous.
 */
const COMPONENT = /^[A-Za-z0-9-]{1,16}$/;

const REFERRAL_CODE = /^[A-Za-z0-9-]{1,32}$/;

export type CampaignTouch = {
  source: typeof CAMPAIGN_SOURCE;
  version: typeof SUPPORTED_CAMPAIGN_VERSION;
  campaignId: string;
  contentId: string;
  variantId: string;
  /** The exact token as received, already proven to satisfy the grammar. */
  token: string;
};

/** Why a payload produced no attribution. Useful for tests and bounded observability. */
export type UnsupportedReason =
  | "too_long"
  | "charset"
  | "shape"
  | "unsupported_version"
  | "component";

export type StartPayload =
  | { kind: "direct" }
  | { kind: "campaign"; touch: CampaignTouch }
  | { kind: "legacy_referral"; code: string }
  | { kind: "unsupported"; reason: UnsupportedReason };

const DIRECT: StartPayload = { kind: "direct" };

const unsupported = (reason: UnsupportedReason): StartPayload => ({ kind: "unsupported", reason });

/**
 * Parses a Telegram `/start` payload. Never throws.
 *
 * An absent or empty payload is a direct start, not an error. Anything that does not
 * match a supported grammar exactly is `unsupported`, which callers must treat as
 * "no attribution" rather than "no access".
 */
export function parseStartPayload(raw: string | null | undefined): StartPayload {
  if (raw === null || raw === undefined || raw === "") return DIRECT;
  if (raw.length > START_PAYLOAD_MAX_LENGTH) return unsupported("too_long");
  if (!PAYLOAD_CHARSET.test(raw)) return unsupported("charset");

  if (raw.startsWith("ref_")) {
    const code = raw.slice(4);
    return REFERRAL_CODE.test(code) ? { kind: "legacy_referral", code } : unsupported("shape");
  }

  if (raw.startsWith("x_")) {
    const parts = raw.split("_");
    if (parts.length !== 5) return unsupported("shape");
    const [, version, campaignId, contentId, variantId] = parts;
    if (version !== SUPPORTED_CAMPAIGN_VERSION) return unsupported("unsupported_version");
    if (!COMPONENT.test(campaignId) || !COMPONENT.test(contentId) || !COMPONENT.test(variantId)) {
      return unsupported("component");
    }
    return {
      kind: "campaign",
      touch: {
        source: CAMPAIGN_SOURCE,
        version: SUPPORTED_CAMPAIGN_VERSION,
        campaignId,
        contentId,
        variantId,
        token: raw,
      },
    };
  }

  return unsupported("shape");
}

export type CampaignTriple = {
  campaignId: string;
  contentId: string;
  variantId: string;
};

/**
 * Campaigns are authored before they are published, so an arriving token only means
 * something if it names one we actually issued.
 *
 * This matters because the grammar bounds what a token can look like, not what it can
 * carry. Three regex-valid fields are enough to smuggle a 42-character wallet split across
 * them, a numeric account id, or base64url-encoded JSON. A closed charset cannot detect
 * intent; an allowlist makes intent irrelevant, because anything unissued is simply not
 * attribution.
 *
 * Empty on purpose. Add an entry when a link is approved for publication, and never before.
 */
export const REGISTERED_CAMPAIGNS: readonly CampaignTriple[] = Object.freeze([]);

/**
 * True when this exact triple was issued. The registry parameter exists so tests can prove
 * the mechanism without inventing a production campaign.
 */
export function isRegisteredCampaign(
  triple: CampaignTriple,
  registry: readonly CampaignTriple[] = REGISTERED_CAMPAIGNS,
): boolean {
  return registry.some(
    (issued) =>
      issued.campaignId === triple.campaignId &&
      issued.contentId === triple.contentId &&
      issued.variantId === triple.variantId,
  );
}

/**
 * Builds a token from its parts, or returns null when the parts do not fit the grammar.
 * Returning null rather than throwing keeps a bad campaign name a content problem
 * instead of a runtime failure.
 */
export function buildCampaignToken(parts: {
  campaignId: string;
  contentId: string;
  variantId: string;
}): string | null {
  const { campaignId, contentId, variantId } = parts;
  if (!COMPONENT.test(campaignId) || !COMPONENT.test(contentId) || !COMPONENT.test(variantId)) {
    return null;
  }
  const token = `${CAMPAIGN_SOURCE}_${SUPPORTED_CAMPAIGN_VERSION}_${campaignId}_${contentId}_${variantId}`;
  return token.length <= START_PAYLOAD_MAX_LENGTH ? token : null;
}

/**
 * Builds the deep link a campaign should publish. Returns null for invalid parts so a
 * broken token can never reach a public post.
 */
export function campaignStartLink(
  botUsername: string,
  parts: { campaignId: string; contentId: string; variantId: string },
): string | null {
  if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) return null;
  const token = buildCampaignToken(parts);
  return token === null ? null : `https://t.me/${botUsername}?start=${token}`;
}
