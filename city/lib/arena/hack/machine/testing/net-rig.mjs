// CITY-238 · test-only: the made-up range on an engine whose step reaches for the network
// (`../../runner/testing/net-engine.mjs`). The sandbox's own wall inside the machine refuses the whole run.
import reachingEngine from "../../runner/testing/net-engine.mjs";
import { rigOver } from "./toy-rig.mjs";

export default rigOver(reachingEngine);
