# 2026-03-01 - Apply BigBrain Best Practices

## What
Aligned bigbrain-sync-buddy with the conventions established in the mudry project.

## Why
The project was missing several standard BigBrain repo conventions (MEMORY.md, .claude/rules/, dotfiles). Adopting these ensures consistent AI-assisted development across all BigBrain projects.

## Changes Made

### New Files
| File | Purpose |
|------|---------|
| `MEMORY.md` | Persistent AI context — version, environment, key decisions, gotchas, user preferences |
| `.claude/rules/spotify-api.md` | Domain rules for Spotify API integration (auth, sync, rate limiting) |
| `.claude/rules/express-server.md` | Domain rules for Express server and EJS views (routes, state, logging) |
| `.gitattributes` | LF line ending normalization, binary file declarations |
| `.npmrc` | `engine-strict=true`, `save-exact=true` |
| `.nvmrc` | Pins Node.js 24 |

### Modified Files
| File | Changes |
|------|---------|
| `.gitignore` | Removed duplicate entries (logs, node_modules, .env listed twice), added selective `.claude/` tracking (`!.claude/rules/`), added `nul` to ignores, cleaned up unused framework patterns |

### Deleted Files
| File | Reason |
|------|--------|
| `nul` | Stray 0-byte Windows artifact at project root |

### Status Line
- Updated `~/.claude/status-line/progress.cjs` to fall back to `package.json` for projects without MEMORY.md
- Status line now shows `bigbrain-sync-buddy v1.2.19`

### Also This Session
- Pulled latest code for both `bigbrain-sync-buddy` and `mudry` repos
- Copied updated files from `repo/` to root (v1.2.18 → v1.2.19)
- Stashed and pulled mudry (local `package-lock.json` conflict)

## Conventions Adopted from Mudry

| Convention | Status |
|------------|--------|
| MEMORY.md with decisions, gotchas, environment | Added |
| .claude/rules/ with domain-specific markdown | Added (2 rule files) |
| .gitattributes (LF normalization) | Added |
| .npmrc (engine-strict, save-exact) | Added |
| .nvmrc (Node version pin) | Added |
| .gitignore selective .claude/ tracking | Added |
| history/ with yyyy-mm-dd naming | Already existed |
| CLAUDE.md with architecture + commands | Already existed |
| .env.example | Already existed |

## Environment Note
SHELBY (this machine) and ROCKET (source of truth) are on the same LAN. This means best-practice files can be synchronized between machines even if they are gitignored (e.g., `.claude/settings.local.json`, `.env`, `nodemon.json`). Git is not the only distribution mechanism — LAN copy is available for any config that shouldn't be committed but should be consistent across machines.
