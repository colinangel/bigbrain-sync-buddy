# Fix Sync and Timestamp Bugs

**Date:** 2026-03-01

## What Changed

### 1. Fix sync crash on null playlist items (`app.js:331`)
- **Problem:** `fetchAllPlaylists` filtered playlists with `p.owner.id === userId` but Spotify's API can return `null` items in playlist listings (for deleted/unfollowed playlists). This caused `TypeError: Cannot read properties of null (reading 'owner')`, crashing the entire sync.
- **Fix:** Added null guard: `p && p.owner && p.owner.id === userId`

### 2. Fix incorrect timestamp display (`views/index.ejs`)
- **Problem:** Timestamps for "Last sync", "Last build", and activity log entries were rendered server-side in EJS using `toLocaleString()` / `toLocaleTimeString()`. Node.js may use UTC instead of the user's local timezone, causing displayed times to be incorrect.
- **Fix:** Changed to client-side JavaScript rendering. Timestamps are now embedded as `data-utc` attributes on `<span class="local-time">` elements and converted to local time by the browser on page load.
- **Affected locations:** Last sync time (line 414), activity log entries (line 586), Ron's Radio last build time (line 525)

### 3. Fix broken log file download (`app.js:1140`)
- **Problem:** `fs` was imported as `require('fs').promises` (line 7), but `fs.createReadStream` only exists on the synchronous `fs` module. Any attempt to download a log file via `/logs/:filename` threw `fs.createReadStream is not a function`.
- **Fix:** Added `const fsSync = require('fs')` and changed the streaming call to `fsSync.createReadStream(logPath).pipe(res)`.

### 4. Fix Node.js version check message (`app.js:23`)
- **Problem:** The version warning triggered on Node.js 20 (`majorVersion === 20`) telling users to "upgrade to Node.js 20+" - contradictory since they're already on 20.
- **Fix:** Changed condition to `majorVersion >= 16 && majorVersion < 20` so it correctly warns users on older supported versions.

## Problems Encountered
- No log files or `app-data.json` existed, so diagnosis was done through code analysis rather than runtime log inspection.
- The null playlist guard issue is documented in Spotify's API docs ("Items in this list can be null") but is easy to miss.

## How They Were Resolved
- All four bugs were fixed with targeted edits to `app.js` and `views/index.ejs`.
- Syntax validation (`npm test`) passes after all changes.
