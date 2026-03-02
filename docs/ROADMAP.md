# BigBrain Sync Buddy — Roadmap

> Retroactively built from codebase analysis (v1.2.19, 2026-03-01).
> Completed phases document what already exists. Future phases propose logical next steps.

---

## Phase 0 — Foundation (Complete)

Core infrastructure that makes everything else possible.

- [x] **0.1** Express 5 server with EJS templating
- [x] **0.2** Spotify OAuth 2.0 (authorization code flow, automatic token refresh)
- [x] **0.3** In-memory state with JSON file persistence (`app-data.json`)
- [x] **0.4** Winston logging with daily rotation (`logs/`)
- [x] **0.5** Environment-driven configuration (`.env`)
- [x] **0.6** Node.js version guard (exits <16, warns 16-19)

---

## Phase 1 — Playlist Sync (Complete)

One-way playlist synchronization between two Spotify accounts.

- [x] **1.1** Dual-account authentication (source + destination)
- [x] **1.2** Automatic playlist discovery (user-owned only)
- [x] **1.3** One-way sync: add new tracks, remove deleted tracks
- [x] **1.4** Create missing playlists on destination
- [x] **1.5** Delete orphaned playlists on destination
- [x] **1.6** Duplicate prevention (check before adding)
- [x] **1.7** Null-safe playlist filtering (`p && p.owner && p.owner.id`)
- [x] **1.8** Batch operations (100-track chunks per Spotify API limits)

---

## Phase 2 — Dashboard & Monitoring (Complete)

Web UI for controlling sync and viewing status.

- [x] **2.1** Dashboard with account connection status
- [x] **2.2** Manual sync trigger button
- [x] **2.3** Sync statistics display (playlists, tracks, additions, removals)
- [x] **2.4** Activity log viewer (20 most recent entries, color-coded)
- [x] **2.5** Auto-sync scheduler with configurable interval (1-1440 min)
- [x] **2.6** Status polling (10-second interval)
- [x] **2.7** Log file listing and download
- [x] **2.8** Client-side local timezone rendering
- [x] **2.9** Responsive layout (mobile breakpoint at 600px)
- [x] **2.10** Toast notifications for success/error feedback
- [x] **2.11** Disconnect / reset all state

---

## Phase 3 — Ron's Radio (Complete)

Genre-filtered "best of" playlist builder.

- [x] **3.1** Scan all "Best Of" playlists for genres
- [x] **3.2** Genre consolidation into categories (rock, pop, hip-hop, etc.)
- [x] **3.3** Multi-select genre UI with select all / clear
- [x] **3.4** Build "Ron's Radio" playlist filtered by selected genres
- [x] **3.5** Artist metadata fetching in batches of 50
- [x] **3.6** Persistent genre selection across restarts

---

## Phase 4 — Create Playlist from Song List (Complete)

Build a playlist from a text file of song titles.

- [x] **4.1** Text/CSV/TSV file upload with format detection
- [x] **4.2** Spotify search for each track (title + artist)
- [x] **4.3** Fallback search (title-only) when exact match fails
- [x] **4.4** Results display with Spotify link and "not found" list

---

## Phase 5 — Hardening & Reliability

Stability improvements before adding new features. The app works well for normal use, but has gaps around error recovery and edge cases.

- [ ] **5.1** Rate-limit retry with backoff
  - `makeSpotifyRequest()` currently throws on 429 errors
  - Implement automatic retry using Spotify's `Retry-After` header
  - Add exponential backoff with jitter for resilience

- [ ] **5.2** State file integrity
  - Add schema version to `app-data.json` for future migrations
  - Write to temp file then rename (atomic write) to prevent corruption
  - Add file locking to prevent race conditions during concurrent saves

- [ ] **5.3** Sync error recovery
  - Track partial sync progress so interrupted syncs can resume
  - Log per-playlist success/failure in sync results
  - Surface partial failure clearly in the UI (not just "sync complete")

- [ ] **5.4** Token encryption at rest
  - Tokens currently stored in plaintext in `app-data.json`
  - Encrypt with a machine-specific key before writing to disk

- [ ] **5.5** Security headers
  - Add `helmet` middleware for standard security headers
  - Add CSRF protection on POST endpoints (even though local-only)

- [ ] **5.6** Input validation
  - Validate playlist name length/chars on create-from-list
  - Validate genre strings format on save
  - Validate sync interval produces valid cron pattern

---

## Phase 6 — Modularization

Break the monolithic `app.js` (1,214 lines) into focused modules. This makes the codebase easier to navigate, test, and extend.

- [ ] **6.1** Extract logging (`lib/logger.js`)
  - Winston config, `addLog()` helper, log ring buffer

- [ ] **6.2** Extract state management (`lib/state.js`)
  - `appState` schema, `loadState()`, `saveState()`

- [ ] **6.3** Extract Spotify API layer (`lib/spotify.js`)
  - `makeSpotifyRequest()`, `ensureValidToken()`, `getAllPaginatedItems()`
  - Playlist operations: fetch, add tracks, remove tracks, unfollow

- [ ] **6.4** Extract sync engine (`lib/sync.js`)
  - `performSync()` and supporting logic

- [ ] **6.5** Extract Ron's Radio (`lib/rons-radio.js`)
  - Genre management, playlist building

- [ ] **6.6** Extract route handlers (`routes/`)
  - `routes/auth.js` — OAuth callback, token exchange
  - `routes/sync.js` — sync trigger, status, interval
  - `routes/playlists.js` — Ron's Radio, create-from-list
  - `routes/logs.js` — log listing, download
  - `routes/debug.js` — token debug endpoints

- [ ] **6.7** Wire up modular `app.js`
  - Slim entry point that imports modules and mounts routes

---

## Phase 7 — Testing

The project has zero tests beyond syntax checking. A test suite would prevent regressions and make refactoring safer.

- [ ] **7.1** Test framework setup
  - Add Vitest (or Jest) with coverage reporting
  - Add test script to `package.json`

- [ ] **7.2** Unit tests for pure logic
  - Genre consolidation / matching
  - Song list parsing (CSV/TSV/text)
  - State schema validation
  - Cron pattern generation from interval

- [ ] **7.3** Integration tests with mocked Spotify API
  - Token refresh flow
  - Playlist sync (add, remove, create, delete)
  - Rate-limit retry behavior
  - Error handling paths

- [ ] **7.4** End-to-end smoke test
  - Start server, hit `/status`, verify JSON shape
  - Render dashboard, verify no template errors

---

## Phase 8 — Feature Enhancements

New capabilities that build on the solid foundation.

- [ ] **8.1** Selective playlist sync
  - UI to choose which playlists to sync (instead of all)
  - Persist selection in app state
  - Sync exclusion patterns (regex, e.g., `Archive.*`)

- [ ] **8.2** Dry-run / preview mode
  - Simulate sync and show what would change (adds, removes, creates)
  - User confirms before applying

- [ ] **8.3** Sync history and statistics
  - Store last N sync results with timestamps
  - Show trends: tracks added/removed over time
  - Genre distribution chart for synced playlists

- [ ] **8.4** Ron's Radio improvements
  - Genre weighting (prioritize some genres over others)
  - Cross-playlist deduplication (same track in multiple "Best Of" lists)
  - Artist favoriting / blocklisting

- [ ] **8.5** Configurable "Ron's Radio" name
  - Allow user to set the playlist name (currently hardcoded)

- [ ] **8.6** Log search and filtering
  - Search/filter activity log by type (error, warn, info)
  - Date range filter
  - Export logs as CSV

- [ ] **8.7** Webhook / notification support
  - POST to external URL on sync events
  - Configurable webhook URL in settings

---

## Architecture Notes

### Current Stack
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24+ |
| Framework | Express 5.0.1 |
| Templates | EJS |
| HTTP Client | Axios |
| Logging | Winston + daily-rotate-file |
| Scheduler | node-cron |
| State | In-memory + JSON file |

### File Structure (current)
```
bigbrain-sync-buddy/
├── app.js              # All server logic (1,214 lines)
├── views/
│   ├── index.ejs       # Dashboard (1,168 lines)
│   ├── auth-success.ejs
│   └── error.ejs
├── logs/               # Daily-rotated log files
├── app-data.json       # Runtime state (gitignored)
├── .env                # Spotify credentials (gitignored)
├── nodemon.json        # Dev server config
└── docs/
    └── ROADMAP.md      # This file
```

### Proposed Modular Structure (Phase 6)
```
bigbrain-sync-buddy/
├── app.js              # Slim entry point (~50 lines)
├── lib/
│   ├── logger.js       # Winston config + addLog
│   ├── state.js        # State management + persistence
│   ├── spotify.js      # API wrapper + token management
│   ├── sync.js         # Sync engine
│   └── rons-radio.js   # Genre management + playlist builder
├── routes/
│   ├── auth.js         # OAuth endpoints
│   ├── sync.js         # Sync + status endpoints
│   ├── playlists.js    # Ron's Radio + create-from-list
│   ├── logs.js         # Log file endpoints
│   └── debug.js        # Debug/token endpoints
├── views/
│   ├── index.ejs
│   ├── auth-success.ejs
│   └── error.ejs
└── docs/
    └── ROADMAP.md
```

### Key Constraints
- **No database** — JSON file persistence is intentional and appropriate for single-user
- **Local-only** — Binds to 127.0.0.1; Spotify redirect URI is whitelisted for this only
- **One-way sync** — Source playlists are read-only by design
- **Monolithic is OK** — Phase 6 modularization is for maintainability, not scale
