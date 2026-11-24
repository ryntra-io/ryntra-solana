/**
 * JSON Schema of a contract schema, in the notation the published documents
 * are written in.
 *
 * The OpenAPI document, the generated client and the published Solana schemas
 * are built from zod's own exporter, and their bytes are checked against the
 * committed files. zod 4.6 kept every constraint but changed how three of them
 * are spelled:
 *
 *   - a union of bare types, `nullable()` above all, became `type: [x, "null"]`
 *     instead of `anyOf: [{ type: x }, { type: "null" }]`;
 *   - a tuple gained `items: false`, `minItems` and `maxItems`, which closes it
 *     — and a released client that validates against the document would start
 *     refusing an answer with one more element, where today it reads it;
 *   - `startsWith()` (and the other content checks) began to emit their own
 *     name as a `format`, which is not a JSON Schema format at all.
 *
 * `contractJsonSchema` gives the earlier spelling back, keyed on the zod
 * schema each node came from, so the documents and every reader of them stay
 * as they are. Anything else zod changes still reaches the documents and is
 * caught by their byte checks.
 */
import { z } from "zod";

type Params = NonNullable<Parameters<typeof z.toJSONSchema>[1]>;
type Json = Record<string, unknown>;
type OverrideContext = Parameters<NonNullable<Params["override"]>>[0];

/* zod's internal name for a check on a string's content rather than its shape. */
const CONTENT_CHECKS = new Set(["starts_with", "ends_with", "includes", "lowercase", "uppercase"]);
/* `anyOf` is held under this key while zod folds bare-type unions, then put back. */
const HELD = "x-ryntra-held-anyOf";

/** Renames `from` to `to` in place, keeping the key where it was. */
function renameKey(json: Json, from: string, to: string): void {
  const entries = Object.entries(json);
  for (const [key] of entries) delete json[key];
  for (const [key, value] of entries) json[key === from ? to : key] = value;
}

type Def = { type?: string; rest?: unknown; checks?: readonly { _zod: { def: { check?: string; format?: string } } }[] };

function keepNotation(ctx: OverrideContext): void {
  const json = ctx.jsonSchema as Json;
  const def = (ctx.zodSchema as unknown as { _zod: { def: Def } })._zod.def;

  if (Array.isArray(json.anyOf)) renameKey(json, "anyOf", HELD);

  if (def.type === "tuple" && !def.rest) {
    if ((def.checks ?? []).length) throw new Error("a tuple with its own length check: say how the document should state it");
    if (json.items === false) delete json.items;
    delete json.minItems;
    delete json.maxItems;
  }

  if (typeof json.format === "string" && CONTENT_CHECKS.has(json.format)) {
    const shapes = (def.checks ?? [])
      .map((check) => check._zod.def)
      .filter((check) => check.check === "string_format" && check.format && !CONTENT_CHECKS.has(check.format) && check.format !== "regex");
    if (shapes.length) throw new Error(`a ${shapes[0].format} string with a content check: say how the document should state it`);
    delete json.format;
  }
}

function restore(node: unknown, seen: WeakSet<object>): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) restore(item, seen);
    return;
  }
  const json = node as Json;
  if (HELD in json) renameKey(json, HELD, "anyOf");
  for (const value of Object.values(json)) restore(value, seen);
}

/** `z.toJSONSchema(schema, params)`, spelled as the published documents spell it. */
export function contractJsonSchema(schema: Parameters<typeof z.toJSONSchema>[0], params: Params = {}): Json {
  const own = params.override;
  const out = z.toJSONSchema(schema, {
    ...params,
    override(ctx) {
      keepNotation(ctx);
      own?.(ctx);
    },
  }) as Json;
  restore(out, new WeakSet());
  return out;
}
