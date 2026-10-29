/**
 * Where the tests run.
 *
 * A few tests hold the code to the development repository's own files beside
 * it — the product specification and planning records under `docs/`, the evidence
 * archive, the design lint and the generators under `scripts/`, the OpenAPI
 * documents. The closed code snapshot that reviewers read carries the code
 * without them, so there each such test is skipped and says what it needs;
 * in the development repository it runs as before.
 */

import { existsSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);

/** True where the development repository's documents and scripts sit beside the code. */
export const inDevelopmentRepository = existsSync(new URL("docs/", ROOT)) && existsSync(new URL("scripts/", ROOT));

/** A test's `skip` option: `false` in the development repository, and elsewhere the reason it cannot run. */
export const needsDevelopmentRepository = (what) =>
  inDevelopmentRepository ? false : `reads ${what}, which the development repository keeps beside the code`;
