import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  resolveJimsGameRoot,
  resolveSubdivisionConfiguration
} from "../server/jimsGateway.js";

test("Subdivision is bundled into the Orbit Ops repository", async () => {
  const root = new URL("../games/subdivision/", import.meta.url);
  await Promise.all([
    access(new URL("server.js", root)),
    access(new URL("package.json", root)),
    access(new URL("package-lock.json", root)),
    access(new URL("index.html", root)),
    access(new URL("assets/", root))
  ]);

  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(packageJson.scripts.start, "node server.js");
  assert.equal(resolveJimsGameRoot(fileURLToPath(new URL("..", import.meta.url))), fileURLToPath(root).replace(/\/$/u, ""));
});

test("Subdivision has a separate database configuration with legacy migration aliases", () => {
  const current = resolveSubdivisionConfiguration({
    SUBDIVISION_DATABASE_URL: "postgresql://subdivision/current",
    SUBDIVISION_ADMIN_TOKEN: "current-admin",
    SUBDIVISION_DEVICE_SECRET: "current-device",
    JIMS_DATABASE_URL: "postgresql://legacy/ignored"
  });
  assert.equal(current.databaseUrl, "postgresql://subdivision/current");
  assert.equal(current.adminToken, "current-admin");
  assert.equal(current.deviceSecret, "current-device");

  const legacy = resolveSubdivisionConfiguration({
    JIMS_DATABASE_URL: "postgresql://subdivision/legacy",
    JIMS_ADMIN_TOKEN: "legacy-admin",
    JIMS_DEVICE_SECRET: "legacy-device"
  });
  assert.equal(legacy.databaseUrl, "postgresql://subdivision/legacy");
  assert.equal(legacy.adminToken, "legacy-admin");
  assert.equal(legacy.deviceSecret, "legacy-device");
});

test("the combined deployment no longer needs a repository access token", async () => {
  const [render, packageJson] = await Promise.all([
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(render, /JIMS_GITHUB_TOKEN|jims:sync/u);
  assert.match(render, /pnpm run subdivision:install/u);
  assert.match(packageJson, /"subdivision:install"/u);
});
