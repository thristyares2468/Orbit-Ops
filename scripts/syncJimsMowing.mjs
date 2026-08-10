import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const orbitRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(orbitRoot, ".render", "jims-mowing");
const repository = process.env.JIMS_GAME_REPOSITORY || "https://github.com/leot46627-spec/fpsshooterserver.git";
const branch = process.env.JIMS_GAME_REF || "main";
const githubToken = String(process.env.JIMS_GITHUB_TOKEN || "").trim();

export function gitEnvironment(environment = process.env, token = githubToken) {
  if (!token) return environment;
  const credential = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...environment,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credential}`
  };
}

function run(command, args, cwd = orbitRoot, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

export function validateSyncConfiguration(environment = process.env) {
  if (environment.RENDER && !String(environment.JIMS_GITHUB_TOKEN || "").trim()) {
    throw new Error(
      "JIMS_GITHUB_TOKEN is required on Render because the Jim's Mowing repository is private. " +
      "Create a fine-grained GitHub token with read-only Contents access to that repository and add it as a secret Render environment variable."
    );
  }
}

function main() {
  try {
    validateSyncConfiguration();
  } catch (error) {
    console.error(`[jims:sync] ${error.message}`);
    process.exit(2);
  }

  const authenticatedGitEnvironment = gitEnvironment();
  if (existsSync(join(target, ".git"))) {
    run("git", ["pull", "--ff-only", "origin", branch], target, authenticatedGitEnvironment);
  } else {
    run("git", ["clone", "--depth=1", "--branch", branch, repository, target], orbitRoot, authenticatedGitEnvironment);
  }
  run("npm", ["install", "--omit=dev"], target);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
