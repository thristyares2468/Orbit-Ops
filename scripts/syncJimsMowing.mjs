import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const orbitRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(orbitRoot, ".render", "jims-mowing");
const repository = process.env.JIMS_GAME_REPOSITORY || "https://github.com/leot46627-spec/fpsshooterserver.git";
const branch = process.env.JIMS_GAME_REF || "main";

function run(command, args, cwd = orbitRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (existsSync(join(target, ".git"))) {
  run("git", ["pull", "--ff-only", "origin", branch], target);
} else {
  run("git", ["clone", "--depth=1", "--branch", branch, repository, target]);
}
run("npm", ["install", "--omit=dev"], target);
