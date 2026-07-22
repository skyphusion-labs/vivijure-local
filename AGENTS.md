# AGENTS.md

## Cursor Cloud specific instructions

Standard scripts are in `package.json` (and `CLAUDE.md`). Non-obvious VM gotchas:

- **Run the JS toolchain under Node 24.** The VM's default `node` is a wrapper
  (`/exec-daemon/node`, v22.14) that shadows nvm; `tsx`/bare-`node` `.ts` execution
  needs Node >= 22.18. Use Node 24 (installed via nvm by the environment update
  script): `export PATH="$HOME/.nvm/versions/node/v24"*"/bin:$PATH"`.
- **Install deps with the default Node 22 `npm` (v10), not Node 24's `npm` (v11).**
  npm 11 blocks the `esbuild`/`workerd` postinstall (native binaries wrangler/tsx/
  vitest need) behind an interactive allow-scripts prompt. Run `npm ci` on the
  default PATH, then run tooling under Node 24. If you see an `allow-scripts` warning
  after install, `rm -rf node_modules` and reinstall with the default Node 22 npm.
- `npm run typecheck` and `npm test` also run the sibling `../vivijure-core`
  package, so `vivijure-core` must be checked out and installed alongside this repo
  (the update script installs both). `npm test` runs the unit (vitest) suite; the
  `test:e2e` (Playwright), `compose:*`, and `migrate*` targets need Docker/secrets
  not provisioned here.

Verified in this environment (Node 24): `npm ci`, `npm run typecheck`,
`npm test` (this repo's vitest suite + vivijure-core's 269) all pass.
