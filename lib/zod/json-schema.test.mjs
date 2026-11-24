/**
 * The published documents keep the notation they were written in.
 *
 * ZOD_4_4_3 is what zod 4.4.3 — the version the OpenAPI document, the client
 * and the Solana schemas were generated with — emitted for each shape below,
 * as a reply (`output`) and as a request (`input`). `contractJsonSchema`
 * has to give exactly that back on the installed zod; the documents' own byte
 * checks (`build-openapi-v1.mjs --check`, `build-client-v1.mjs --check`,
 * `solana-schemas.mjs --check`) then hold the whole files.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import { contractJsonSchema } from "./json-schema.ts";

const ZOD_4_4_3 = {
  "nullable": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "null"
      }
    ]
  },
  "nullable_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "null"
      }
    ]
  },
  "nullableBounded": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string",
        "maxLength": 5
      },
      {
        "type": "null"
      }
    ]
  },
  "nullableBounded_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string",
        "maxLength": 5
      },
      {
        "type": "null"
      }
    ]
  },
  "union": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      }
    ]
  },
  "union_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      }
    ]
  },
  "nestedNullable": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "number"
          }
        ]
      },
      {
        "type": "null"
      }
    ]
  },
  "nestedNullable_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "number"
          }
        ]
      },
      {
        "type": "null"
      }
    ]
  },
  "tuple": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "type": "string",
        "const": "A"
      },
      {
        "type": "string",
        "const": "B"
      }
    ]
  },
  "tuple_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "type": "string",
        "const": "A"
      },
      {
        "type": "string",
        "const": "B"
      }
    ]
  },
  "tupleOptional": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "type": "string"
      },
      {
        "type": "number"
      }
    ]
  },
  "tupleOptional_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "type": "string"
      },
      {
        "type": "number"
      }
    ]
  },
  "startsWith": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string",
    "maxLength": 200,
    "pattern": "^\\/app\\/.*"
  },
  "startsWith_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string",
    "maxLength": 200,
    "pattern": "^\\/app\\/.*"
  },
  "object": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "a": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ]
      },
      "t": {
        "type": "array",
        "prefixItems": [
          {
            "type": "string",
            "const": "X"
          }
        ]
      },
      "h": {
        "type": "string",
        "pattern": "^\\/.*"
      }
    },
    "required": [
      "a",
      "t",
      "h"
    ],
    "additionalProperties": false
  },
  "object_input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "a": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ]
      },
      "t": {
        "type": "array",
        "prefixItems": [
          {
            "type": "string",
            "const": "X"
          }
        ]
      },
      "h": {
        "type": "string",
        "pattern": "^\\/.*"
      }
    },
    "required": [
      "a",
      "t",
      "h"
    ],
    "additionalProperties": false
  }
};

const shapes = () => ({
  nullable: z.string().nullable(),
  nullableBounded: z.string().max(5).nullable(),
  union: z.union([z.string(), z.number(), z.boolean()]),
  nestedNullable: z.union([z.string(), z.number()]).nullable(),
  tuple: z.tuple([z.literal("A"), z.literal("B")]),
  tupleOptional: z.tuple([z.string(), z.number().optional()]),
  startsWith: z.string().startsWith("/app/").max(200),
  object: z.object({ a: z.number().nullable(), t: z.tuple([z.literal("X")]), h: z.string().startsWith("/") }).strict(),
});

test("each shape is spelled as zod 4.4.3 spelled it, key order included", () => {
  for (const [name, schema] of Object.entries(shapes())) {
    for (const [suffix, io] of [["", "output"], ["_input", "input"]]) {
      const got = contractJsonSchema(schema, { target: "draft-2020-12", io });
      /* JSON text, not deepEqual: the YAML and JSON documents keep keys in the order they arrive. */
      assert.equal(JSON.stringify(got), JSON.stringify(ZOD_4_4_3[name + suffix]), name + suffix);
    }
  }
});

test("only the spelling moves: what the schema accepts is zod's own", () => {
  const schema = z.object({ a: z.number().nullable(), t: z.tuple([z.literal("X")]), h: z.string().startsWith("/") }).strict();
  assert.equal(schema.safeParse({ a: null, t: ["X"], h: "/x" }).success, true);
  assert.equal(schema.safeParse({ a: null, t: ["X", "Y"], h: "/x" }).success, false, "the tuple is still closed where the server parses");
  assert.equal(schema.safeParse({ a: null, t: ["X"], h: "x" }).success, false);
});

test("a caller's own override still runs, after the notation is kept", () => {
  const seen = [];
  const out = contractJsonSchema(z.object({ a: z.string().nullable() }), {
    target: "draft-2020-12",
    override: (ctx) => seen.push(Object.keys(ctx.jsonSchema).join(",")),
  });
  assert.ok(seen.length > 0);
  assert.equal(JSON.stringify(out.properties.a), JSON.stringify({ anyOf: [{ type: "string" }, { type: "null" }] }));
});

test("a shape the notation cannot state without guessing stops the build", () => {
  assert.throws(() => contractJsonSchema(z.string().email().startsWith("a")), /email string with a content check/);
});
