---
description: Rules for working with the Spotify Web API integration
globs: app.js
---

# Spotify API Rules

## Authentication
- OAuth 2.0 Authorization Code flow with automatic token refresh
- Tokens stored in `appState.sourceToken` and `appState.destToken`
- Always call `ensureValidToken(account)` before any API request
- Token refresh uses the refresh token — never re-prompt the user

## API Request Pattern
- All Spotify API calls go through `makeSpotifyRequest(url, token, method, body)`
- This wrapper handles rate limiting (429) with automatic retry after `Retry-After` header
- Pagination: use `getAllPaginatedItems()` for endpoints returning paged results
- Batch operations: chunk into groups of 100 (Spotify's max per request)

## Playlist Sync Rules
- **One-way only**: Never modify source account playlists during sync
- **Duplicate prevention**: Check existing tracks before adding
- **Track removal**: Remove tracks from destination that no longer exist in source
- **Playlist matching**: Match by name between source and destination accounts
- Filter to user-owned playlists only: `p.owner.id === userId`
- Null-safe filtering: always check `p && p.owner && p.owner.id`

## Redirect URI
- Must be `http://127.0.0.1:3000/callback` — hardcoded in Spotify Developer Dashboard
- Changing HOST to anything else (e.g., 192.168.0.200) will break OAuth
