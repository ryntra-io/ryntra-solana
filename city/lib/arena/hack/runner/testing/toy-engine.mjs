// CITY-225 · test-only: the made-up engine of the sandbox (`../../sandbox/toy.ts`) as a module the worker imports by
// path. Its default export is an `EngineFactory`. Never a production engine — the deployment points at LiteSVM.
import "../../../../../../lib/world/testing/hooks.mjs";

const toy = await import("../../sandbox/toy.ts");

export default toy.createToyEngine;
