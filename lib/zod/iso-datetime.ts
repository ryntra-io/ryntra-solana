/**
 * The date-time rule of every schema in this repository, written once.
 *
 * A time is `YYYY-MM-DDThh:mm`, then optional seconds `:ss` with an optional
 * fraction, then `Z` — or, with `offset`, `Z` or `±hh:mm`. Seconds are
 * optional. That is the rule the contract has always stated: the API accepts
 * it, the OpenAPI document and the published JSON Schemas carry its pattern,
 * and the SDKs check the same thing by hand.
 *
 * zod 4.5 tightened its own `datetime()` to RFC 3339 — seconds compulsory
 * once a time carries `Z` or an offset — so `2026-08-14T12:00Z`, which the
 * contract accepts, would start to be refused. zod still validates against a
 * pattern handed to it, so this module hands it the contract's pattern: the
 * same accept and reject, the same issue (`invalid_format`, format
 * `datetime`, this pattern) and the same `format: date-time` plus `pattern`
 * in JSON Schema. `iso-datetime.test.mjs` pins all three and refuses a
 * `datetime()` written anywhere else.
 */
import { z } from "zod";

/* A calendar date, leap years included. */
const DATE =
  "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
/* Hours and minutes; seconds and their fraction optional. */
const TIME = "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?";
const OFFSET = "([+-](?:[01]\\d|2[0-3]):[0-5]\\d)";

/** A time in UTC, written with `Z`. */
export const ISO_DATETIME_UTC = new RegExp(`^${DATE}T(?:${TIME}(?:Z))$`);
/** A time with `Z` or a numeric offset `±hh:mm`. */
export const ISO_DATETIME_OFFSET = new RegExp(`^${DATE}T(?:${TIME}(?:Z|${OFFSET}))$`);

type Options = Readonly<{ offset?: boolean }>;

/**
 * The rule as the argument of `datetime()`, for a chain where another check
 * comes first: `z.string().max(40).datetime(isoDateTimeParams({ offset: true }))`.
 * `pattern` is the format's own field — zod builds its default only when none
 * is given — and zod's parameter type leaves it out, so it travels in a plain
 * object rather than a literal.
 */
export function isoDateTimeParams(options: Options = {}) {
  const offset = options.offset === true;
  return { offset, pattern: offset ? ISO_DATETIME_OFFSET : ISO_DATETIME_UTC };
}

/**
 * A string that is a time by the rule above — `offset: true` admits `±hh:mm`
 * beside `Z`. Use it wherever `z.string().datetime()` would be written.
 */
export function isoDateTime(options: Options = {}): z.ZodString {
  return z.string().datetime(isoDateTimeParams(options));
}
