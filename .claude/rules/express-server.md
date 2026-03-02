---
description: Rules for the Express 5 web server and EJS views
globs: app.js, views/**/*.ejs
---

# Express Server Rules

## Server Configuration
- Express 5.0.1 — use Express 5 patterns (no callback-style error handling)
- Binds to HOST from `.env` (default 127.0.0.1)
- EJS templates in `views/` directory

## Route Conventions
- `GET /` renders dashboard, must pass: `appState`, `authUrls`, `mode`, `appUrl`, `version`
- `GET /status` returns JSON for UI polling — keep lightweight
- `POST` routes for mutations (sync, disconnect, interval changes)
- Always pass `version: APP_VERSION` to any rendered view that uses it

## State Management
- All state lives in the `appState` object (in-memory)
- Persisted to `app-data.json` via `saveState()` — called after any state mutation
- Loaded on startup via `loadState()`
- `app-data.json` must be in `.gitignore` and `nodemon.json` ignore list

## Logging
- Use `logger` (Winston) for all server logging, not `console.log`
- `addLog(message, type)` adds to both Winston and the in-memory log buffer for UI display
- Log levels: error, warn, info, debug

## File Streams
- Use `fsSync.createReadStream()` for streaming responses (e.g., log file downloads)
- Do NOT use the async `fs` module for stream operations
