# Add CI Pipeline and ESLint

**Date:** 2026-03-03

## What Changed

### New Files
- **`.github/workflows/ci.yml`** — GitHub Actions CI workflow that runs on push to `main` and PRs targeting `main`. Steps: checkout, setup Node (from `.nvmrc`), `npm ci`, `npm test` (syntax check), `npm run lint`.
- **`eslint.config.js`** — ESLint 9 flat config using `@eslint/js` recommended rules. CommonJS, ecmaVersion 2022, Node.js globals. `no-unused-vars` allows `_`-prefixed args. Ignores `node_modules/` and `_Achive/`.

### Modified Files
- **`package.json`** — Added `lint` script (`eslint .`), added devDependencies: `eslint`, `@eslint/js`, `globals`.
- **`app.js`** — Fixed 4 `preserve-caught-error` findings in `makeSpotifyRequest()` by adding `{ cause: error }` to re-thrown errors, preserving the original stack trace.

## Why

The project had zero automated quality checks beyond `node --check` syntax validation. Adding CI with ESLint:
- Catches real bugs (undefined variables, unreachable code, etc.) on every push/PR
- Enforces best practices like preserving error causes when re-throwing
- Prevents regressions from reaching `main`

## Problems Encountered

- **ESLint 10 `preserve-caught-error` rule**: New rule not present in ESLint 9. The `makeSpotifyRequest` catch block was re-throwing new errors without preserving the original error as `{ cause: error }`. Fixed by adding the cause option to all 4 throw statements.
- **Archive directory linted**: The `_Achive/` directory (legacy archived code) was being linted and produced errors. Added it to the ESLint ignores list since archived code shouldn't block CI.

## Verification

- `npm test` — syntax check passes
- `npm run lint` — zero findings
