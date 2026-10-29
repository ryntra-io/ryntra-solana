import assert from "node:assert/strict";
import test from "node:test";

import { NO_CLUSTER_CHECK } from "./honest-count.ts";

test("without a signal key the city counts nothing that names a party", async () => {
  const { cityWalletClusters } = await import("./clusters.server.ts");
  const clusters = cityWalletClusters({});
  assert.equal(clusters, NO_CLUSTER_CHECK);
});
