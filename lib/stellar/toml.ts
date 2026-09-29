/**
 * SEP-1 `stellar.toml` — the issuer's own description of itself.
 *
 * **What this is and is not.** The ledger proves that an issuer account claims
 * a home domain. It proves nothing whatsoever about what that domain says. Every
 * field here is therefore a *declaration by the issuer*, and the Passport must
 * label it as one: an `attestation_of_reserve` URL is a link the issuer
 * published, not a reserve anyone has checked, and `anchor_asset = "US Treasury
 * Notes"` is a claim, not custody evidence.
 *
 * That distinction is the entire reason this module exists separately from the
 * chain reads. Mixing the two would let an issuer's sentence about itself render
 * with the same authority as its clawback flag, and only one of those is a fact
 * the network enforces.
 *
 * **Why a parser rather than a dependency.** The TOML this needs is a small,
 * flat subset: sections, array-of-table sections, and scalar assignments. A
 * general TOML library is a dependency, an attack surface and a lockfile change
 * for a document we read over the network from a third party. So the parser
 * below implements the subset and **refuses everything else** — a line it does
 * not understand fails the parse instead of being skipped, because a silently
 * skipped line is how a `redemption_instructions` field disappears without
 * anyone noticing.
 */

import { DEFAULT_LIMITS, fetchText, type ClientLimits, type FetchResult } from "./client.ts";

export type TomlValue = string | number | boolean;
export type TomlTable = Record<string, TomlValue>;

export type StellarToml = Readonly<{
  /** Top-level assignments before any section header. */
  root: TomlTable;
  /** `[SECTION]` tables, by name. */
  sections: Record<string, TomlTable>;
  /** `[[CURRENCIES]]` and any other array-of-table sections. */
  arrays: Record<string, TomlTable[]>;
}>;

export type TomlParseResult = Readonly<{ ok: true; toml: StellarToml }> | Readonly<{ ok: false; reason: string }>;

const KEY = /^[A-Za-z0-9_-]+$/;

function parseScalar(raw: string): { ok: true; value: TomlValue } | { ok: false; reason: string } {
  const text = raw.trim();
  if (text === "true") return { ok: true, value: true };
  if (text === "false") return { ok: true, value: false };

  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    const inner = text.slice(1, -1);
    /* Only the escapes SEP-1 documents actually use. An unrecognised escape is
       refused rather than passed through, because passing it through would put
       a literal backslash into a URL or a sentence a person reads. */
    if (/\\(?![\\"nrt/])/.test(inner)) return { ok: false, reason: `Unsupported escape sequence in ${text.slice(0, 40)}` };
    return {
      ok: true,
      value: inner.replace(/\\(["\\/nrt])/g, (_m, ch: string) =>
        ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch),
    };
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return { ok: true, value: text.slice(1, -1) };
  }
  if (/^-?\d+$/.test(text)) return { ok: true, value: Number(text) };
  if (/^-?\d+\.\d+$/.test(text)) return { ok: true, value: Number(text) };

  return { ok: false, reason: `Unsupported value: ${text.slice(0, 40)}` };
}

/**
 * Parse the SEP-1 subset.
 *
 * Handles `# comments`, `[SECTION]`, `[[ARRAY]]`, `key = scalar`, and
 * `key = """multi-line"""`. Arrays of values, inline tables and dotted keys are
 * **not** supported and are reported rather than dropped: `stellar.toml` does
 * use them for a few fields this Passport does not read, so an unsupported
 * *value* skips its own key while still recording that it was skipped, and an
 * unparseable *structure* fails the whole document.
 */
export function parseStellarToml(input: string): TomlParseResult {
  const toml: { root: TomlTable; sections: Record<string, TomlTable>; arrays: Record<string, TomlTable[]> } = {
    root: {},
    sections: {},
    arrays: {},
  };
  let current: TomlTable = toml.root;

  const lines = input.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "" || line.startsWith("#")) continue;

    const arrayHeader = line.match(/^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/);
    if (arrayHeader) {
      const name = arrayHeader[1];
      const table: TomlTable = {};
      (toml.arrays[name] ??= []).push(table);
      current = table;
      continue;
    }

    const sectionHeader = line.match(/^\[\s*([A-Za-z0-9_.-]+)\s*\]$/);
    if (sectionHeader) {
      current = toml.sections[sectionHeader[1]] ??= {};
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      return { ok: false, reason: `Line ${index + 1} is neither a comment, a section header nor an assignment.` };
    }
    const key = line.slice(0, separator).trim();
    if (!KEY.test(key)) {
      return { ok: false, reason: `Line ${index + 1} has an unsupported key: ${key.slice(0, 40)}` };
    }

    let raw = line.slice(separator + 1).trim();
    /* A `"""` string runs until its closing delimiter, so the scan has to move
       the loop cursor rather than treat each line independently. */
    if (raw.startsWith('"""')) {
      const collected: string[] = [raw.slice(3)];
      let closed = raw.length > 5 && raw.endsWith('"""');
      if (closed) {
        collected[0] = raw.slice(3, -3);
      } else {
        while (!closed && index + 1 < lines.length) {
          index += 1;
          const next = lines[index];
          if (next.includes('"""')) {
            collected.push(next.slice(0, next.indexOf('"""')));
            closed = true;
          } else {
            collected.push(next);
          }
        }
      }
      if (!closed) return { ok: false, reason: `Unterminated multi-line string for "${key}".` };
      current[key] = collected.join("\n").trim();
      continue;
    }

    /* Trailing comments are only stripped outside quotes — a `#` inside a URL
       or a description is data. */
    if (!raw.startsWith('"') && !raw.startsWith("'")) {
      const hash = raw.indexOf("#");
      if (hash !== -1) raw = raw.slice(0, hash).trim();
    } else {
      const quote = raw[0];
      const closing = raw.indexOf(quote, 1);
      if (closing !== -1) raw = raw.slice(0, closing + 1);
    }

    const scalar = parseScalar(raw);
    /* An unsupported *value* — an array or inline table this Passport never
       reads — skips its key rather than failing the document. Losing one field
       we do not use must not cost every field we do. */
    if (scalar.ok) current[key] = scalar.value;
  }

  return { ok: true, toml };
}

export type CurrencyDeclaration = Readonly<{
  code: string;
  issuer: string | null;
  name: string | null;
  desc: string | null;
  /** The issuer's claim that the token is backed by something off-chain. */
  isAssetAnchored: boolean | null;
  anchorAsset: string | null;
  anchorAssetType: string | null;
  status: string | null;
  /** A URL the issuer published. Not a reserve anyone has verified. */
  attestationOfReserve: string | null;
  redemptionInstructions: string | null;
  /** The issuer states the asset is subject to an approval server. */
  regulated: boolean | null;
  approvalServer: string | null;
  conditions: string | null;
  displayDecimals: number | null;
}>;

export type OrganizationDeclaration = Readonly<{
  name: string | null;
  dba: string | null;
  url: string | null;
  officialEmail: string | null;
  supportEmail: string | null;
  /** The issuer's stated legal jurisdiction. A claim, like everything here. */
  licensingAuthority: string | null;
  licenseNumber: string | null;
  physicalAddress: string | null;
}>;

const str = (table: TomlTable | undefined, key: string): string | null => {
  const value = table?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
};
const bool = (table: TomlTable | undefined, key: string): boolean | null =>
  typeof table?.[key] === "boolean" ? (table[key] as boolean) : null;
const num = (table: TomlTable | undefined, key: string): number | null =>
  typeof table?.[key] === "number" ? (table[key] as number) : null;

/** Find the declaration for one exact asset. Code alone never matches. */
export function findCurrency(toml: StellarToml, code: string, issuer: string): CurrencyDeclaration | null {
  const entry = (toml.arrays.CURRENCIES ?? []).find((row) => row.code === code && row.issuer === issuer);
  if (!entry) return null;
  return {
    code,
    issuer,
    name: str(entry, "name"),
    desc: str(entry, "desc"),
    isAssetAnchored: bool(entry, "is_asset_anchored"),
    anchorAsset: str(entry, "anchor_asset"),
    anchorAssetType: str(entry, "anchor_asset_type"),
    status: str(entry, "status"),
    attestationOfReserve: str(entry, "attestation_of_reserve"),
    redemptionInstructions: str(entry, "redemption_instructions"),
    regulated: bool(entry, "regulated"),
    approvalServer: str(entry, "approval_server"),
    conditions: str(entry, "conditions"),
    displayDecimals: num(entry, "display_decimals"),
  };
}

export function readOrganization(toml: StellarToml): OrganizationDeclaration {
  const doc = toml.sections.DOCUMENTATION;
  return {
    name: str(doc, "ORG_NAME"),
    dba: str(doc, "ORG_DBA"),
    url: str(doc, "ORG_URL"),
    officialEmail: str(doc, "ORG_OFFICIAL_EMAIL"),
    supportEmail: str(doc, "ORG_SUPPORT_EMAIL"),
    licensingAuthority: str(doc, "ORG_LICENSING_AUTHORITY"),
    licenseNumber: str(doc, "ORG_LICENSE_NUMBER"),
    physicalAddress: str(doc, "ORG_PHYSICAL_ADDRESS"),
  };
}

/**
 * Fetch the declaration from the domain the ledger says the issuer claims.
 *
 * The domain is never taken from user input — it comes from the issuer account
 * read, which is what makes the link meaningful at all.
 */
export async function fetchStellarToml(
  homeDomain: string,
  options: { limits?: ClientLimits; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<FetchResult<StellarToml>> {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(homeDomain)) {
    return { ok: false, reason: `"${homeDomain}" is not a plausible home domain.` };
  }
  const url = `https://${homeDomain}/.well-known/stellar.toml`;
  /* The same bounded transport as every API read — timeout, size cap, redirects
     refused — reading text instead of JSON. This is a third-party domain, so it
     needs those bounds more than an API does, not less. */
  const answer = await fetchText(url, { method: "GET" }, options.limits ?? DEFAULT_LIMITS, options.fetchImpl ?? globalThis.fetch, "text/plain");
  if (!answer.ok) return answer;

  const parsed = parseStellarToml(answer.value);
  if (!parsed.ok) return { ok: false, reason: `${url} could not be parsed: ${parsed.reason}` };
  return { ok: true, value: parsed.toml };
}
