/**
 * A tiny price as the chart writes it: the run of zeros after the point counted under the line —
 * 0.0000000320008 → «0.0₇32001», as the core chart's scale says 0.0₅2344. Four zeros or more; anything larger stays
 * as typed. Plain text only: the field a price is typed into keeps the plain decimal.
 */

const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

/** The zeros' count in subscript digits: 7 → «₇», 12 → «₁₂». */
const subOf = (n: number): string => [...String(n)].map((digit) => SUB[Number(digit)]).join('');

/**
 * `value` with its leading zeros counted, `significant` digits after them (trailing zeros dropped); a value with fewer
 * than `fromZeros` zeros after the point — and anything not a positive number — is `plain`'s.
 */
export function zerosText(value: number, plain: (value: number) => string, significant = 5, fromZeros = 4): string {
  if (!(value > 0) || !Number.isFinite(value) || value >= 1) return plain(value);
  let zeros = -Math.floor(Math.log10(value)) - 1;
  let run = (value * 10 ** (zeros + significant)).toFixed(0);
  // 0.0000099999… rounds up a place: one zero fewer.
  if (run.length > significant) {
    zeros -= 1;
    run = (value * 10 ** (zeros + significant)).toFixed(0);
  }
  if (zeros < fromZeros) return plain(value);
  const digits = run.slice(0, significant).replace(/0+$/, '') || '0';
  return `0.0${subOf(zeros)}${digits}`;
}
