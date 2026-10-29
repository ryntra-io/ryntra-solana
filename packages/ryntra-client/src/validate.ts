/**
 * The runtime validator: does this answer have the shape the contract states?
 *
 * Written by hand rather than generated, because the two interesting decisions
 * in it are judgement calls that no schema can express, and both are about
 * what a *released* client must survive.
 *
 * **An unknown property is not an error.** The contract's schemas are strict —
 * zod `.strict()` becomes `additionalProperties: false` in the document — and
 * that strictness is the server's, about the requests it accepts. A client
 * reading a response has the opposite duty: the whole point of an additive
 * contract is that adding a field is safe, and a client that rejected an
 * unknown field would turn every additive release into a broken SDK. So this
 * engine checks everything the schema declares and ignores everything it does
 * not.
 *
 * **A declared field is checked all the way down.** The alternative — glance at
 * the envelope and trust the rest — is the kind of validation that reports
 * success while a caller reads `undefined` out of a renamed nested object. If
 * the type says a figure is there, the check says so too, or the read fails.
 *
 * `format` is checked leniently on purpose: `date-time` through `Date.parse`
 * and `uri` through `URL`, both of which accept everything the server's own
 * `z.string().datetime()` and `z.string().url()` produce. A stricter reading
 * here would reject answers the contract considers valid, which is a false
 * alarm wearing a validator's clothes.
 */

export type JsonSchema = Readonly<{
  type?: string | readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  prefixItems?: readonly JsonSchema[];
  enum?: readonly unknown[];
  const?: unknown;
  anyOf?: readonly JsonSchema[];
  oneOf?: readonly JsonSchema[];
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}>;

/** One thing that is wrong, and where. The path reads like the access that would fail. */
export type Failure = Readonly<{ path: string; message: string }>;

const show = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  const kind = typeof value;
  if (kind === "object") return "an object";
  if (kind === "string") return `${JSON.stringify((value as string).slice(0, 40))}`;
  return String(value);
};

const jsonTypeOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

/** `integer` satisfies `number`; nothing else widens. */
const isType = (value: unknown, type: string): boolean => {
  const actual = jsonTypeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
};

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

const step = (path: string, key: string | number): string =>
  typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;

function checkInto(value: unknown, schema: JsonSchema, path: string, out: Failure[]): void {
  if (schema.const !== undefined) {
    if (!sameValue(value, schema.const)) out.push({ path, message: `expected ${JSON.stringify(schema.const)}, got ${show(value)}` });
    return;
  }

  if (schema.enum) {
    if (!schema.enum.some((allowed) => sameValue(value, allowed))) {
      out.push({ path, message: `expected one of ${schema.enum.map((allowed) => JSON.stringify(allowed)).join(", ")}, got ${show(value)}` });
    }
    return;
  }

  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    /* The clearest message is the closest near-miss: the branch that failed
       least is almost always the one the server meant. Reporting every branch
       buries the real defect under the shapes that were never in play. */
    let closest: readonly Failure[] | null = null;
    for (const branch of branches) {
      const failures: Failure[] = [];
      checkInto(value, branch, path, failures);
      if (failures.length === 0) return;
      if (closest === null || failures.length < closest.length) closest = failures;
    }
    out.push({ path, message: `matched none of the ${branches.length} shapes the contract allows for this field` });
    if (closest) out.push(...closest);
    return;
  }

  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 0 && !types.some((type) => isType(value, type))) {
    out.push({ path, message: `expected ${types.join(" or ")}, got ${jsonTypeOf(value)} (${show(value)})` });
    return;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push({ path, message: `shorter than ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push({ path, message: `longer than ${schema.maxLength} characters` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) out.push({ path, message: `does not match ${schema.pattern}` });
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) out.push({ path, message: "not a time anything can read" });
    if (schema.format === "uri" && !URL.canParse(value)) out.push({ path, message: "not a URL" });
    return;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path, message: `below ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path, message: `above ${schema.maximum}` });
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) out.push({ path, message: `not above ${schema.exclusiveMinimum}` });
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) out.push({ path, message: `not below ${schema.exclusiveMaximum}` });
    return;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push({ path, message: `fewer than ${schema.minItems} entries` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push({ path, message: `more than ${schema.maxItems} entries` });
    if (schema.prefixItems) {
      schema.prefixItems.forEach((child, index) => {
        if (index < value.length) checkInto(value[index], child, step(path, index), out);
        else out.push({ path: step(path, index), message: "missing" });
      });
      return;
    }
    if (schema.items) value.forEach((entry, index) => checkInto(entry, schema.items as JsonSchema, step(path, index), out));
    return;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    for (const name of schema.required ?? []) {
      if (!(name in record) || record[name] === undefined) out.push({ path: step(path, name), message: "missing" });
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (name in record && record[name] !== undefined) checkInto(record[name], child, step(path, name), out);
    }
    /* A free-form record: the keys themselves are constrained, and every value
       is read against one schema. `additionalProperties` is only honoured here
       as a *shape* — never as a ban on fields this build has not heard of. */
    if (!schema.properties) {
      for (const [name, entry] of Object.entries(record)) {
        if (schema.propertyNames) checkInto(name, schema.propertyNames, step(path, name), out);
        if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          checkInto(entry, schema.additionalProperties, step(path, name), out);
        }
      }
    }
  }
}

/** Every way the value disagrees with the schema; empty means it agrees. */
export function check(value: unknown, schema: JsonSchema): readonly Failure[] {
  const out: Failure[] = [];
  checkInto(value, schema, "", out);
  return out;
}

/** The failures as one line a person can act on. */
export function describe(failures: readonly Failure[], limit = 4): string {
  const shown = failures.slice(0, limit).map((failure) => `${failure.path || "(the answer)"}: ${failure.message}`);
  const rest = failures.length - shown.length;
  return rest > 0 ? `${shown.join("; ")}; and ${rest} more` : shown.join("; ");
}
