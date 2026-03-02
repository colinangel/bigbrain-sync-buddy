# 2026-03-01 - Sync Latest Codebase and Fix Startup Config

## What Changed

### 1. Copied latest code from `repo/` to project root
- `app.js`: Updated from 623 lines (v1.0.0) to 1,213 lines (v1.2.18)
- `views/`: Updated all EJS templates with new dashboard UI
- `package.json` and `package-lock.json`: Updated to v1.2.18
- `CLAUDE.md`: Updated with new endpoints and documentation

### 2. Added `nodemon.json` to project root
- Copied from `repo/nodemon.json` to fix a restart loop
- Ignores `app-data.json`, `logs/*`, `*.log`, and `node_modules/*`
- Without this, nodemon detected `app-data.json` writes on startup and entered an infinite restart cycle

### 3. Updated `Spotify.bat` on Desktop
- Changed `cd /d \BigBrain\bigbrain-sync-buddy\repo` to `cd /d \BigBrain\bigbrain-sync-buddy`
- The batch file now starts the server from the project root where the latest code lives

## Why
The project root was running an outdated v1.0.0 codebase while the `repo/` subdirectory contained v1.2.18 with significant features including Ron's Radio, track removal sync, configurable sync intervals, HOST configuration, and search API.

## Problems Encountered

### Nodemon restart loop
- **Symptom**: `npm run dev` caused nodemon to restart endlessly
- **Cause**: No `nodemon.json` at the project root, so nodemon watched all files including `app-data.json` which gets written on every startup
- **Fix**: Created `nodemon.json` at the root with proper ignore rules

### Spotify.bat pointing to wrong directory
- **Symptom**: The desktop shortcut was launching from `repo/` instead of the project root
- **Fix**: Updated the `cd /d` path in the batch file

### Stale server process on port 3000
- **Symptom**: After starting via `Spotify.bat`, the view threw `ReferenceError: version is not defined` — old code was still serving on `127.0.0.1:3000`
- **Cause**: An old Node process (PID 50204) was still listening on `127.0.0.1:3000` with the pre-update code. The new process started on `192.168.0.200:3000` due to HOST config
- **Fix**: Killed both Node processes and restarted clean

### Spotify OAuth error on 192.168.0.200
- **Symptom**: Spotify returned an error when authenticating via `192.168.0.200:3000`
- **Cause**: The `.env` had `HOST=192.168.0.200` and `SPOTIFY_REDIRECT_URI=http://192.168.0.200:3000/callback`, but the Spotify Developer Dashboard only had `http://127.0.0.1:3000/callback` whitelisted
- **Fix**: Reverted `.env` to `HOST=127.0.0.1` and `SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback`

## Verification
- Ran `npm test` (syntax check) — passed
- Started server via `npm run dev` — stable, no restart loop
- Started server via `Spotify.bat` — confirmed running v1.2.18
- Hit `/status` endpoint — confirmed new fields (`removedTracks`, `syncInterval`) present
- Server running on `http://127.0.0.1:3000` with Spotify OAuth working correctly
