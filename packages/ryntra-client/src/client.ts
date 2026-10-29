/**
 * `@ryntra/client` — the read surface of the Ryntra API v1, typed and checked.
 *
 * Three methods and nothing else: `read` for one answer, `pages` to walk a
 * cursor, `collect` to walk it to the end. The operations they accept are
 * generated from the OpenAPI document (`src/generated/`), which is generated
 * from the contract the routes validate with, so the package cannot offer a
 * read the server does not serve.
 *
 * **Reads only, and that is structural rather than a policy.** Every operation
 * is a GET the document serves without a bearer, so there is nothing for the
 * client to authenticate with and nothing it could authorise. It holds no key,
 * builds no transaction and signs nothing — not because it declines to, but
 * because none of that code is in it. A write needs an authority this package
 * has no way to carry.
 */

import {
  CONTRACT_MAJOR,
  CONTRACT_VERSION,
  OPERATIONS,
  PAGINATION,
  type OperationSpec,
} from "./generated/contract.ts";
import { SCHEMAS } from "./generated/schemas.ts";
import type { OperationId, PagedOperationId, ParamsOf, ResponseOf } from "./generated/types.ts";
import { RyntraSchemaError } from "./errors.ts";
import { check } from "./validate.ts";
import { createTransport, type TransportOptions, type Transport } from "./transport.ts";

export type RyntraClientOptions = TransportOptions &
  Readonly<{
    /**
     * `"throw"` (the default) checks every answer against the contract and
     * raises `RyntraSchemaError` when it disagrees. `"off"` skips the check and
     * casts, which is faster and is the right choice only when the caller has
     * already validated the body itself.
     */
    validate?: "throw" | "off";
  }>;

/** The query a read is asked with, as strings, after the path parameters are taken out. */
type QueryValue = string | number | boolean | null | undefined;

function fill(spec: OperationSpec, params: Readonly<Record<string, QueryValue>>): string {
  let path = spec.path;
  const query = new URLSearchParams();

  for (const parameter of spec.parameters) {
    const value = params[parameter.name];
    if (parameter.in === "path") {
      if (value === undefined || value === null || value === "") {
        throw new TypeError(`${spec.operationId} needs ${parameter.name}: it is part of the address.`);
      }
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
      continue;
    }
    if (value === undefined || value === null) {
      if (parameter.required) throw new TypeError(`${spec.operationId} needs ${parameter.name}.`);
      continue;
    }
    query.set(parameter.name, String(value));
  }

  /* A parameter the document does not describe is a typo, not an extension: it
     would be dropped silently by the server and the caller would read the
     wrong page without being told. */
  const known = new Set(spec.parameters.map((parameter) => parameter.name));
  const unknown = Object.keys(params).filter((name) => !known.has(name) && params[name] !== undefined);
  if (unknown.length > 0) {
    throw new TypeError(`${spec.operationId} takes no ${unknown.join(", ")}; it takes ${[...known].join(", ") || "no parameters"}.`);
  }

  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export type RyntraClient = Readonly<{
  /** The contract version this build of the package was generated from. */
  contractVersion: string;
  contractMajor: number;
  /** Where to ask, what comes back, and which reads page — the whole surface as data. */
  operations: typeof OPERATIONS;
  /** The transport underneath, for a caller who needs a path this surface does not cover. */
  transport: Transport;

  /** One read. The answer is checked against the contract before it is returned. */
  read: <K extends OperationId>(operation: K, params?: ParamsOf[K]) => Promise<ResponseOf[K]>;

  /**
   * A cursor walked one page at a time, newest page first, stopping when the
   * server says there is no next one. The cursor is the server's: nothing here
   * invents one, and a page is validated like any other read.
   */
  pages: <K extends PagedOperationId>(operation: K, params?: ParamsOf[K]) => AsyncGenerator<ResponseOf[K], void, undefined>;

  /**
   * The whole cursor, flattened by a selector the caller supplies — the client
   * does not guess which field of a page holds its rows. `limit` is a stop
   * against a cursor that never ends; it bounds pages, not rows.
   */
  collect: <K extends PagedOperationId, T>(
    operation: K,
    select: (page: ResponseOf[K]) => readonly T[],
    params?: ParamsOf[K],
    limit?: number,
  ) => Promise<readonly T[]>;
}>;

export function createRyntraClient(options: RyntraClientOptions): RyntraClient {
  const transport = createTransport(options);
  const validate = options.validate ?? "throw";

  async function read<K extends OperationId>(operation: K, params?: ParamsOf[K]): Promise<ResponseOf[K]> {
    const spec: OperationSpec = OPERATIONS[operation];
    const path = fill(spec, (params ?? {}) as Readonly<Record<string, QueryValue>>);
    const body = await transport.request({ method: "GET", path, operationId: spec.operationId });

    if (validate === "throw") {
      const schema = SCHEMAS[spec.response];
      /* A schema the build does not carry would mean the generated half and
         the document disagree, which `--check` prevents; failing loudly beats
         returning an unchecked answer from a method that promises a checked one. */
      if (!schema) throw new RyntraSchemaError({ operationId: spec.operationId, status: 200, schema: spec.response, failures: [{ path: "", message: "this build carries no schema for the answer" }] });
      const failures = check(body, schema);
      if (failures.length > 0) throw new RyntraSchemaError({ operationId: spec.operationId, status: 200, schema: spec.response, failures });
    }

    return body as ResponseOf[K];
  }

  async function* pages<K extends PagedOperationId>(operation: K, params?: ParamsOf[K]): AsyncGenerator<ResponseOf[K], void, undefined> {
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (;;) {
      /* Annotated rather than inferred: `pages` calls `read`, whose answer type
         is chosen by the same generic, and TypeScript reads that as the type
         depending on itself. Saying it once here is cheaper than restructuring
         the loop around the inference. */
      const page: ResponseOf[K] = await read(operation, { ...(params ?? {}), ...(cursor === null ? {} : { [PAGINATION.parameter]: cursor }) } as ParamsOf[K]);
      yield page;
      const next: unknown = (page as Readonly<Record<string, unknown>>)[PAGINATION.nextField];
      if (typeof next !== "string" || next.length === 0) return;
      /* A server that hands back a cursor it already handed back would spin
         this loop for ever; stopping is the only honest reading of it. */
      if (seen.has(next)) return;
      seen.add(next);
      cursor = next;
    }
  }

  async function collect<K extends PagedOperationId, T>(
    operation: K,
    select: (page: ResponseOf[K]) => readonly T[],
    params?: ParamsOf[K],
    limit = 20,
  ): Promise<readonly T[]> {
    const out: T[] = [];
    let walked = 0;
    for await (const page of pages(operation, params)) {
      out.push(...select(page));
      walked += 1;
      if (walked >= limit) break;
    }
    return out;
  }

  return { contractVersion: CONTRACT_VERSION, contractMajor: CONTRACT_MAJOR, operations: OPERATIONS, transport, read, pages, collect };
}
