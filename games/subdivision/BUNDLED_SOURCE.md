# Bundled Subdivision runtime

This directory is the Subdivision game runtime bundled into the Orbit Ops
repository. It was imported from `thristyares2468/Orbit-Ops-Subdivision` at
commit `27ce6bd` on 27 August 2026.

The two games share a deployment and launch screen, but they do not share
account data:

- Orbit Ops reads only the parent process `DATABASE_URL`.
- Subdivision runs as a child process and receives only
  `SUBDIVISION_DATABASE_URL` as its `DATABASE_URL`.
- The parent installs this directory's production dependencies during its build.

Generated dependencies and macOS metadata are intentionally not bundled. Run
`pnpm run subdivision:install` from the repository root after cloning.

Future Subdivision changes belong in this directory so a single commit can
deploy both games. The former `JIMS_*` environment names are accepted only as a
temporary compatibility fallback.
