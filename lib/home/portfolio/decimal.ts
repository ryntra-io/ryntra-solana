export type DecimalValue = Readonly<{
  units: string;
  scale: number;
}>;

export type RoundingMode = "HALF_EVEN" | "TOWARD_ZERO";

export type MoneyValue = Readonly<{
  amount: DecimalValue;
  currency: string;
}>;

const CANONICAL_INTEGER = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;
const CANONICAL_DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const MAX_SCALE = 18;

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new TypeError(`decimal scale must be an integer from 0 to ${MAX_SCALE}`);
  }
}

function integer(value: DecimalValue): bigint {
  return BigInt(value.units);
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) throw new TypeError("decimal denominator must be positive");
  const quotient = numerator / denominator;
  if (mode === "TOWARD_ZERO") return quotient;

  const remainder = numerator % denominator;
  const magnitude = remainder < 0n ? -remainder : remainder;
  const twice = magnitude * 2n;
  if (twice < denominator) return quotient;
  const direction = numerator < 0n ? -1n : 1n;
  if (twice > denominator) return quotient + direction;
  return quotient % 2n === 0n ? quotient : quotient + direction;
}

export function decimal(units: string, scale: number): DecimalValue {
  assertScale(scale);
  if (!CANONICAL_INTEGER.test(units)) {
    throw new TypeError("value is not a canonical decimal integer");
  }
  return { units, scale };
}

export function parseDecimalText(value: string): DecimalValue {
  if (!CANONICAL_DECIMAL_TEXT.test(value)) {
    throw new TypeError("value is not canonical decimal text");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const magnitude = BigInt(`${whole}${fraction}` || "0");
  if (negative && magnitude === 0n) {
    throw new TypeError("negative zero is not canonical decimal text");
  }
  const units = (negative ? -magnitude : magnitude).toString();
  return decimal(units, fraction.length);
}

export function rescale(value: DecimalValue, scale: number, mode: RoundingMode): DecimalValue {
  decimal(value.units, value.scale);
  assertScale(scale);
  if (scale === value.scale) return value;
  const source = integer(value);
  const result = scale > value.scale
    ? source * powerOfTen(scale - value.scale)
    : divideRounded(source, powerOfTen(value.scale - scale), mode);
  return decimal(result.toString(), scale);
}

function commonScale(left: DecimalValue, right: DecimalValue, targetScale: number): number {
  return Math.max(left.scale, right.scale, targetScale);
}

export function addDecimal(
  left: DecimalValue,
  right: DecimalValue,
  scale: number,
  mode: RoundingMode,
): DecimalValue {
  const workingScale = commonScale(left, right, scale);
  const sum = integer(rescale(left, workingScale, "TOWARD_ZERO"))
    + integer(rescale(right, workingScale, "TOWARD_ZERO"));
  return rescale(decimal(sum.toString(), workingScale), scale, mode);
}

export function subtractDecimal(
  left: DecimalValue,
  right: DecimalValue,
  scale: number,
  mode: RoundingMode,
): DecimalValue {
  const workingScale = commonScale(left, right, scale);
  const difference = integer(rescale(left, workingScale, "TOWARD_ZERO"))
    - integer(rescale(right, workingScale, "TOWARD_ZERO"));
  return rescale(decimal(difference.toString(), workingScale), scale, mode);
}

export function multiplyDecimal(
  left: DecimalValue,
  right: DecimalValue,
  scale: number,
  mode: RoundingMode,
): DecimalValue {
  decimal(left.units, left.scale);
  decimal(right.units, right.scale);
  assertScale(scale);
  const productScale = left.scale + right.scale;
  const product = integer(left) * integer(right);
  const units = scale >= productScale
    ? product * powerOfTen(scale - productScale)
    : divideRounded(product, powerOfTen(productScale - scale), mode);
  return decimal(units.toString(), scale);
}

export function compareDecimal(left: DecimalValue, right: DecimalValue): number {
  const scale = Math.max(left.scale, right.scale);
  const a = integer(rescale(left, scale, "TOWARD_ZERO"));
  const b = integer(rescale(right, scale, "TOWARD_ZERO"));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function absoluteDecimal(value: DecimalValue): DecimalValue {
  const parsed = integer(decimal(value.units, value.scale));
  return decimal((parsed < 0n ? -parsed : parsed).toString(), value.scale);
}
