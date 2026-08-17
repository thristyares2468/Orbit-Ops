// Which build of the server this process is. Clients compare it across
// reconnects: a socket that comes back to a different build is talking to a
// deployment that has moved on, and the page it is running is stale.

export function resolveBuildId(environment = globalThis.process?.env ?? {}) {
  // Render sets this to the deployed commit, which is the truest identity a
  // build has - two deploys of the same commit really are the same code.
  const commit = String(environment.RENDER_GIT_COMMIT ?? "").trim();
  if (commit) return commit.slice(0, 12);
  // Any other host can name its own build.
  const explicit = String(environment.ORBIT_BUILD_ID ?? "").trim();
  if (explicit) return explicit.slice(0, 40);
  // Local development: a restart is the closest thing to a deploy, and picking
  // up the restart is exactly the behaviour you want while editing.
  return `dev-${Date.now().toString(36)}`;
}

export const BUILD_ID = resolveBuildId();
