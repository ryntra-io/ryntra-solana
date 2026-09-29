/**
 * A number a person typed into a money or price field, read the way the
 * person meant it.
 *
 * The plan builder used to keep only `[0-9.-]` before `Number(...)`, so a
 * Ukrainian `0,5` became `5` and `10,50` became `1050`, and an empty field
 * became `0`. Neither is a number the person wrote. This reader has four
 * rules and refuses everything it cannot read without guessing:
 *
 *   - spaces (plain, no-break, narrow), apostrophes and underscores only ever
 *     group digits and are dropped: `1 000,50` is `1000.5`;
 *   - one separator of either kind is the decimal separator: `0,5` and `0.5`
 *     are both a half, `12.` is twelve, `.5` is a half;
 *   - both kinds present: the later one is the decimal separator and the
 *     other groups thousands in threes — `1,234.56` and `1.234,56` are both
 *     `1234.56`; `1,23.45` is refused;
 *   - one kind repeated groups thousands in threes: `1,000,000` is a million;
 *     `1,2,3` is refused.
 *
 * Empty is `null`, never zero; anything unreadable is `null`, never another
 * valid number. A single `1,234` is read as `1.234` — a decimal input with
 * one separator is a decimal — and the form shows the reading beside the
 * field, so the person sees exactly the figure that will be sent.
 */

const GROUPING = /[\s  '_]/g;

export function parseDecimalInput(text: string): number | null {
  let raw = text.replace(GROUPING, "");
  raw = raw.replace(/^\$/, "").replace(/%$/, "");
  if (raw === "") return null;
  if (!/^[0-9.,]+$/.test(raw)) return null;
  const dots = raw.split(".").length - 1;
  const commas = raw.split(",").length - 1;
  let candidate: string;
  if (dots === 0 && commas === 0) {
    candidate = raw;
  } else if (dots + commas === 1) {
    candidate = raw.replace(",", ".");
  } else if (dots >= 1 && commas >= 1) {
    const decimal = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    if (raw.split(decimal).length - 1 !== 1) return null;
    const [whole, fraction] = raw.split(decimal);
    if (!isGrouped(whole, group)) return null;
    candidate = `${whole.split(group).join("")}.${fraction}`;
  } else {
    const group = dots > 0 ? "." : ",";
    if (!isGrouped(raw, group)) return null;
    candidate = raw.split(group).join("");
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(candidate)) return null;
  const value = Number(candidate);
  return Number.isFinite(value) ? value : null;
}

/** `1,234,567` with the given group separator — one to three digits, then groups of exactly three. */
function isGrouped(text: string, group: string): boolean {
  const parts = text.split(group);
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

/**
 * Whether the reading should be shown beside the field: the text is a
 * readable number written with a comma, a grouping character or a currency
 * sign — anything a person might read differently from the machine.
 */
export function decimalReadingDiffers(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (/^\d*\.?\d*$/.test(trimmed)) return false;
  return parseDecimalInput(trimmed) !== null;
}
