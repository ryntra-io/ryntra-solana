// CITY-225 · test-only: the order's check for the made-up program, as a module the worker imports by path. Its default
// export builds the checks from the snapshot and a plain argument — here `{ vault }`, the vault the check reads.
import "../../../../../../lib/world/testing/hooks.mjs";

const toy = await import("../../sandbox/toy.ts");

export default function checks(_snapshot, arg) {
  if (!arg || typeof arg.vault !== "string") throw new TypeError("the toy check needs { vault }");
  return [toy.conservedCheck(arg.vault)];
}
