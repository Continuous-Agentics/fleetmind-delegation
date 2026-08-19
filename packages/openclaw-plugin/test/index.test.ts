import assert from "node:assert/strict";
import { test } from "node:test";
import { pluginPackageName } from "../src/index.js";

test("plugin package is wired to the workspace", () => {
  assert.equal(pluginPackageName, "@continuous-agentics/openclaw-fleetmind-delegation");
});
