import assert from "node:assert/strict";
import { test } from "node:test";
import { gitEnvironment, validateSyncConfiguration } from "../scripts/syncJimsMowing.mjs";

test("the default source is the owner's Orbit Ops Subdivision repository", async () => {
  const source = await import("node:fs/promises");
  const script = await source.readFile(new URL("../scripts/syncJimsMowing.mjs", import.meta.url), "utf8");
  assert.match(script, /thristyares2468\/Orbit-Ops-Subdivision\.git/);
});

test("Jim's private repository token is supplied through an in-memory Git header", () => {
  const token = "test-token-never-log-this";
  const environment = gitEnvironment({ SAFE_VALUE: "kept" }, token);

  assert.equal(environment.SAFE_VALUE, "kept");
  assert.equal(environment.GIT_CONFIG_COUNT, "1");
  assert.equal(environment.GIT_CONFIG_KEY_0, "http.extraHeader");
  assert.match(environment.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
  assert.equal(environment.GIT_CONFIG_VALUE_0.includes(token), false);
  assert.equal(Buffer.from(environment.GIT_CONFIG_VALUE_0.split(" ").at(-1), "base64").toString(), `x-access-token:${token}`);
});

test("Render builds fail early with a useful message when the private token is missing", () => {
  assert.throws(
    () => validateSyncConfiguration({ RENDER: "true" }),
    /JIMS_GITHUB_TOKEN is required on Render/
  );
  assert.doesNotThrow(() => validateSyncConfiguration({ RENDER: "true", JIMS_GITHUB_TOKEN: "configured" }));
  assert.doesNotThrow(() => validateSyncConfiguration({}));
});
