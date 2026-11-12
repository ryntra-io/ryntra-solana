// CITY-238 · test-only: the made-up range on an engine whose one step never ends (`../../runner/testing/hang-engine.mjs`).
// Only the machine's hard wall stops it.
import hangingEngine from "../../runner/testing/hang-engine.mjs";
import { rigOver } from "./toy-rig.mjs";

export default rigOver(hangingEngine);
