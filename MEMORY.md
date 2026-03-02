# BigBrain Sync Buddy - Memory

## Current Position
- **Version:** 1.2.19
- **Status:** Stable, running in production on SHELBY
- **Last Session:** 2026-03-01 — Synced latest codebase from `repo/` to root, fixed startup config

## Environment
- **SHELBY** (this machine): Windows 11, Node.js 24.x, development & runtime
- **ROCKET**: Source of truth for git repos; same LAN as SHELBY
- **LAN sync**: Both machines on same network — can synchronize best-practice files (`.claude/settings.local.json`, `.env`, etc.) even if gitignored
- **Spotify Dashboard**: Redirect URI whitelisted for `http://127.0.0.1:3000/callback` only
- **Startup**: `Spotify.bat` on Desktop runs `npm start` from `C:\BigBrain\bigbrain-sync-buddy`
- **Git repo**: Lives in `repo/` subdirectory; root is the runtime copy

## Key Architectural Decisions
- **No database** (2025-06): State stored in-memory with `app-data.json` file persistence
- **Monolithic app.js** (2025-06): All server logic in single file — appropriate for project scope
- **One-way sync** (2025-06): Source playlists are read-only; destination gets additions and removals
- **Winston logging** (2025-06): Daily-rotated log files in `logs/` directory
- **Express 5** (2025-06): Using Express 5.0.1, latest major version
- **HOST=127.0.0.1** (2026-03): Must match Spotify redirect URI; 192.168.0.200 causes OAuth errors

## Known Gotchas
- **Nodemon restart loop**: Must have `nodemon.json` at root ignoring `app-data.json` — otherwise infinite restarts on startup
- **Dual code locations**: `repo/` has the git-tracked code; root has the runtime copy. After `git pull` in `repo/`, must copy files to root
- **Spotify redirect URI**: Changing HOST requires updating both `.env` AND the Spotify Developer Dashboard
- **Stale processes**: Always check for existing Node processes on port 3000 before starting (`netstat -ano | grep :3000`)
- **fs.createReadStream**: Use `fsSync` (not async `fs`) for stream operations (fixed in v1.2.19)

## User Preferences
- Always adhere to best practices
- Create history logs at `history/yyyy-mm-dd - Task Description.md`
- Platform: Windows — use `pwsh` (PowerShell 7+)
- Fix CI failures immediately before other work

## Feature Status
- Playlist sync (bidirectional discovery, one-way sync): Working
- Ron's Radio (genre-filtered playlist builder): Working
- Configurable sync interval (1-1440 min): Working
- Token persistence across restarts: Working
- Log file viewer/download: Working
- Local timezone display: Working (v1.2.19)
