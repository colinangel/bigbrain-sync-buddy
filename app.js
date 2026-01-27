// app.js - BigBrain Sync Buddy with playlist duplicate fix applied

const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');
require('dotenv').config();

// Load app version from package.json
const { version: APP_VERSION } = require('./package.json');

// Validate Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion < 16) {
  console.error(`❌ Node.js ${nodeVersion} detected. This app requires Node.js 16 or higher.`);
  console.error('Please upgrade to a supported version: https://nodejs.org/');
  process.exit(1);
}
if (majorVersion === 20) {
  console.warn(`⚠️ Node.js ${nodeVersion} detected. For best performance, upgrade to Node.js 20+`);
}
console.log(`✅ Node.js ${nodeVersion} - Compatible`);

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'spotify-sync' },
  transports: [
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      compress: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) =>
          `${timestamp} [${level.toUpperCase()}] ${message}${stack ? '\n' + stack : ''}`)
      )
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      compress: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let output = `${timestamp} [${level.toUpperCase()}] ${message}`;
          if (Object.keys(meta).length > 0 && meta.service !== 'spotify-sync') {
            output += ' ' + JSON.stringify(meta);
          }
          return output;
        })
      )
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
      )
    })
  ]
});

// Handle uncaught exceptions and rejections
try {
  logger.exceptions.handle(
    new winston.transports.DailyRotateFile({
      filename: 'logs/exceptions-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      compress: true
    })
  );
  logger.rejections.handle(
    new winston.transports.DailyRotateFile({
      filename: 'logs/rejections-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      compress: true
    })
  );
} catch {
  console.warn('⚠️ Advanced logging features not available, falling back to console');
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();

// Add explicit views directory path here:
app.set('views', path.join(__dirname, 'views'));

app.set('view engine', 'ejs');

app.use(express.static('public'));
app.use(express.json());

const PORT = process.env.PORT || 3000;

let appState = {
  sourceToken: null,
  destToken: null,
  sourceRefreshToken: null,
  destRefreshToken: null,
  sourceTokenExpiry: null,
  destTokenExpiry: null,
  sourceUser: null,
  destUser: null,
  isSetup: false,
  syncStats: { playlists: 0, tracks: 0, newPlaylists: 0, newTracks: 0, removedTracks: 0 },
  lastSync: null,
  syncInProgress: false,
  logs: []
};

async function loadState() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'app-data.json'), 'utf8');
    const savedState = JSON.parse(data);
    appState = { ...appState, ...savedState };
    appState.syncInProgress = false;
    addLog(`📁 Loaded saved state: ${appState.isSetup ? 'Setup complete' : 'Setup required'}`);
    if (appState.sourceUser) addLog(`👤 Source account: ${appState.sourceUser.display_name}`);
    if (appState.destUser) addLog(`👤 Destination account: ${appState.destUser.display_name}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading state:', error);
    }
    addLog('📁 No saved state found, starting fresh');
  }
}

async function saveState() {
  try {
    const stateToSave = { ...appState, syncInProgress: false };
    await fs.writeFile(path.join(__dirname, 'app-data.json'), JSON.stringify(stateToSave, null, 2));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}

function addLog(message, type = 'info') {
  const log = { timestamp: new Date().toISOString(), message, type };
  appState.logs.unshift(log);
  if (appState.logs.length > 100) appState.logs = appState.logs.slice(0, 100);
  logger.log(type, message);
  saveState().catch(err => logger.error('Failed to save state after logging: ' + err.message));
}

const SPOTIFY_CONFIG = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  scopes: [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public'
  ].join(' ')
};

function getSpotifyAuthUrl(accountType, mode = 'normal') {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    scope: SPOTIFY_CONFIG.scopes,
    state: accountType,
    show_dialog: 'true'
  });
  if (mode === 'incognito') params.set('state', accountType + ':incognito');
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_CONFIG.redirectUri,
      client_id: SPOTIFY_CONFIG.clientId,
      client_secret: SPOTIFY_CONFIG.clientSecret
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const tokenData = response.data;
    tokenData.obtained_at = Date.now();
    return tokenData;
  } catch {
    throw new Error('Failed to exchange code for token');
  }
}

async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: SPOTIFY_CONFIG.clientId,
      client_secret: SPOTIFY_CONFIG.clientSecret
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const tokenData = response.data;
    tokenData.obtained_at = Date.now();
    return tokenData;
  } catch {
    throw new Error('Failed to refresh token');
  }
}

async function ensureValidToken(accountType) {
  const now = Date.now();
  const buffer = 5 * 60 * 1000;
  if (accountType === 'source') {
    if (appState.sourceTokenExpiry && now >= (appState.sourceTokenExpiry - buffer)) {
      if (!appState.sourceRefreshToken) throw new Error('Source token expired - please re-authenticate');
      try {
        addLog('🔄 Refreshing source token...');
        const tokenData = await refreshAccessToken(appState.sourceRefreshToken);
        appState.sourceToken = tokenData.access_token;
        if (tokenData.refresh_token) appState.sourceRefreshToken = tokenData.refresh_token;
        appState.sourceTokenExpiry = tokenData.obtained_at + tokenData.expires_in * 1000;
        await saveState();
        addLog('✅ Source token refreshed');
      } catch {
        addLog('❌ Failed to refresh source token', 'error');
        throw new Error('Source token expired - please re-authenticate');
      }
    }
  } else if (accountType === 'destination') {
    if (appState.destTokenExpiry && now >= (appState.destTokenExpiry - buffer)) {
      if (!appState.destRefreshToken) throw new Error('Destination token expired - please re-authenticate');
      try {
        addLog('🔄 Refreshing destination token...');
        const tokenData = await refreshAccessToken(appState.destRefreshToken);
        appState.destToken = tokenData.access_token;
        if (tokenData.refresh_token) appState.destRefreshToken = tokenData.refresh_token;
        appState.destTokenExpiry = tokenData.obtained_at + tokenData.expires_in * 1000;
        await saveState();
        addLog('✅ Destination token refreshed');
      } catch {
        addLog('❌ Failed to refresh destination token', 'error');
        throw new Error('Destination token expired - please re-authenticate');
      }
    }
  }
}

async function makeSpotifyRequest(url, token, method = 'GET', data = null) {
  try {
    logger.debug(`Making ${method} request to Spotify API: ${url}`);
    const config = { method, url, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
    if (data) config.data = data;
    const response = await axios(config);
    logger.debug(`Spotify API request successful: ${url} (${response.status})`);
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    logger.error(`Spotify API request failed: ${url} ${method} ${status} - ${error.message}`);
    if (status === 401) throw new Error('Token expired - please re-authenticate');
    if (status === 403) throw new Error('Access forbidden - check app permissions');
    if (status === 429) throw new Error('Rate limited - too many requests');
    throw new Error(`Spotify API error ${status} - ${error.message}`);
  }
}

async function fetchUserProfile(token) {
  return await makeSpotifyRequest('https://api.spotify.com/v1/me', token);
}

async function fetchAllPlaylists(token, userId) {
  let playlists = [];
  let url = `https://api.spotify.com/v1/me/playlists?limit=50`;
  while (url) {
    const data = await makeSpotifyRequest(url, token);
    playlists = playlists.concat(data.items);
    url = data.next;
  }
  return playlists.filter(p => p.owner.id === userId);
}

async function fetchPlaylistTracks(token, playlistId) {
  let tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
  while (url) {
    const data = await makeSpotifyRequest(url, token);
    tracks = tracks.concat(data.items);
    url = data.next;
  }
  return tracks.filter(t => t.track && t.track.uri);
}

async function createPlaylist(token, userId, name, description) {
  const url = `https://api.spotify.com/v1/users/${userId}/playlists`;
  return await makeSpotifyRequest(url, token, 'POST', {
    name,
    description: description || 'Synced from source account',
    public: false
  });
}

async function addTracksToPlaylist(token, playlistId, trackUris) {
  const chunkSize = 100;
  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
    await makeSpotifyRequest(url, token, 'POST', { uris: chunk });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function removeTracksFromPlaylist(token, playlistId, trackUris) {
  const chunkSize = 100;
  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
    await makeSpotifyRequest(url, token, 'DELETE', { tracks: chunk.map(uri => ({ uri })) });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function performSync() {
  if (appState.syncInProgress) {
    addLog('Sync already in progress, skipping...', 'warn');
    return { success: false, error: 'Sync already in progress' };
  }
  if (!appState.sourceToken || !appState.destToken) {
    addLog('Missing authentication tokens', 'error');
    return { success: false, error: 'Missing authentication tokens' };
  }

  appState.syncInProgress = true;
  addLog('Starting playlist sync...');

  try {
    await ensureValidToken('source');
    const sourceProfile = await fetchUserProfile(appState.sourceToken);
    addLog(`Source account verified: ${sourceProfile.display_name}`);

    await ensureValidToken('destination');
    const destProfile = await fetchUserProfile(appState.destToken);
    addLog(`Destination account verified: ${destProfile.display_name}`);

    const sourcePlaylists = await fetchAllPlaylists(appState.sourceToken, appState.sourceUser.id);
    addLog(`Found ${sourcePlaylists.length} source playlists`);

    const destPlaylists = await fetchAllPlaylists(appState.destToken, appState.destUser.id);
    addLog(`Found ${destPlaylists.length} destination playlists`);

    const destPlaylistMap = new Map(destPlaylists.map(p => [p.name.trim().toLowerCase(), p]));

    let totalTracks = 0, syncedPlaylists = 0, newPlaylists = 0, newTracks = 0, removedTracks = 0;

    for (const sourcePlaylist of sourcePlaylists) {
      try {
        if (sourcePlaylist.collaborative && sourcePlaylist.owner.id !== appState.sourceUser.id) continue;

        const tracks = await fetchPlaylistTracks(appState.sourceToken, sourcePlaylist.id);
        if (tracks.length === 0) continue;

        const normalizedName = sourcePlaylist.name.trim().toLowerCase();
        let destPlaylist = destPlaylistMap.get(normalizedName);

        if (!destPlaylist) {
          destPlaylist = await createPlaylist(appState.destToken, appState.destUser.id, sourcePlaylist.name, sourcePlaylist.description);
          addLog(`Created playlist: ${sourcePlaylist.name}`);
          newPlaylists++;
          destPlaylistMap.set(normalizedName, destPlaylist);
        }

        const currentTracks = await fetchPlaylistTracks(appState.destToken, destPlaylist.id);
        const currentTrackUris = new Set(currentTracks.map(t => t.track.uri));
        const sourceTrackUris = new Set(tracks.map(t => t.track.uri));

        // Add tracks that are in source but not in destination
        const tracksToAdd = tracks.filter(t => !currentTrackUris.has(t.track.uri));
        if (tracksToAdd.length > 0) {
          await addTracksToPlaylist(appState.destToken, destPlaylist.id, tracksToAdd.map(t => t.track.uri));
          addLog(`Added ${tracksToAdd.length} tracks to ${sourcePlaylist.name}`);
          newTracks += tracksToAdd.length;
        }

        // Remove tracks that are in destination but not in source
        const tracksToRemove = currentTracks.filter(t => !sourceTrackUris.has(t.track.uri));
        if (tracksToRemove.length > 0) {
          await removeTracksFromPlaylist(appState.destToken, destPlaylist.id, tracksToRemove.map(t => t.track.uri));
          addLog(`Removed ${tracksToRemove.length} tracks from ${sourcePlaylist.name}`);
          removedTracks += tracksToRemove.length;
        }

        totalTracks += tracks.length;
        syncedPlaylists++;
      } catch (e) {
        addLog(`Error syncing playlist ${sourcePlaylist.name}: ${e.message}`, 'error');
      }
    }

    appState.syncStats = { playlists: syncedPlaylists, tracks: totalTracks, newPlaylists, newTracks, removedTracks };
    appState.lastSync = new Date().toISOString();
    await saveState();

    addLog(`Sync completed: ${syncedPlaylists} playlists, ${totalTracks} tracks, ${newTracks} added, ${removedTracks} removed`);
    return { success: true, stats: appState.syncStats };
  } catch (error) {
    addLog(`Sync failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  } finally {
    appState.syncInProgress = false;
  }
}

// Routes

app.get('/', (req, res) => {
  const { mode } = req.query;
  const appUrl = `${req.protocol}://${req.get('host')}`;
  res.render('index', {
    appState,
    authUrls: {
      source: getSpotifyAuthUrl('source', mode),
      destination: getSpotifyAuthUrl('destination', mode),
    },
    mode: mode || 'normal',
    appUrl,
    version: APP_VERSION,
  });
});

app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    const errorMsg = `Authentication failed: ${error}${error_description ? ` - ${error_description}` : ''}`;
    addLog(errorMsg, 'error');
    return res.render('error', { error: errorMsg });
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const userProfile = await fetchUserProfile(tokenData.access_token);

    const [accountType, mode] = state.includes(':') ? state.split(':') : [state, null];

    if (accountType === 'source') {
      appState.sourceToken = tokenData.access_token;
      appState.sourceRefreshToken = tokenData.refresh_token;
      appState.sourceTokenExpiry = tokenData.obtained_at + tokenData.expires_in * 1000;
      appState.sourceUser = userProfile;
      addLog(`Source account connected: ${userProfile.display_name}`);
    } else if (accountType === 'destination') {
      appState.destToken = tokenData.access_token;
      appState.destRefreshToken = tokenData.refresh_token;
      appState.destTokenExpiry = tokenData.obtained_at + tokenData.expires_in * 1000;
      appState.destUser = userProfile;
      addLog(`Destination account connected: ${userProfile.display_name}`);
    } else {
      const errorMsg = `Invalid state parameter: ${state}`;
      addLog(errorMsg, 'error');
      return res.render('error', { error: errorMsg });
    }

    if (appState.sourceToken && appState.destToken) {
      appState.isSetup = true;
      addLog('Both accounts connected - ready to sync!');
    }

    await saveState();

    if (mode === 'incognito') {
      return res.render('auth-success', { accountType, userName: userProfile.display_name });
    }

    res.redirect('/');
  } catch (err) {
    addLog(`Authentication error: ${err.message}`, 'error');
    return res.render('error', { error: err.message });
  }
});

app.post('/sync', async (req, res) => {
  try {
    const result = await performSync();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Unknown sync error' });
  }
});

app.post('/disconnect', async (req, res) => {
  appState = {
    sourceToken: null,
    destToken: null,
    sourceRefreshToken: null,
    destRefreshToken: null,
    sourceTokenExpiry: null,
    destTokenExpiry: null,
    sourceUser: null,
    destUser: null,
    isSetup: false,
    syncStats: { playlists: 0, tracks: 0, newPlaylists: 0, newTracks: 0, removedTracks: 0 },
    lastSync: null,
    syncInProgress: false,
    logs: []
  };
  addLog('All accounts disconnected');
  await saveState();
  res.json({ success: true });
});

app.get('/status', (req, res) => {
  res.json({
    isSetup: appState.isSetup,
    sourceConnected: !!appState.sourceToken,
    destConnected: !!appState.destToken,
    syncInProgress: appState.syncInProgress,
    stats: appState.syncStats,
    lastSync: appState.lastSync,
    logs: appState.logs.slice(0, 20)
  });
});

app.get('/logs', async (req, res) => {
  try {
    const logDir = path.join(__dirname, 'logs');
    const files = await fs.readdir(logDir);
    const logFiles = [];
    for (const file of files) {
      if (file.endsWith('.log')) {
        const stats = await fs.stat(path.join(logDir, file));
        logFiles.push({ name: file, size: stats.size, modified: stats.mtime });
      }
    }
    res.json({ logFiles: logFiles.sort((a, b) => b.modified - a.modified), logLevel: logger.level });
  } catch (error) {
    logger.error('Error listing log files', { error: error.message });
    res.status(500).json({ error: 'Failed to list log files' });
  }
});

app.get('/logs/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const logPath = path.join(__dirname, 'logs', filename);
    const resolvedPath = path.resolve(logPath);
    const logsDir = path.resolve(path.join(__dirname, 'logs'));
    if (!resolvedPath.startsWith(logsDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const stats = await fs.stat(logPath);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    fs.createReadStream(logPath).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Log file not found' });
    } else {
      logger.error('Error serving log file', { filename: req.params.filename, error: error.message });
      res.status(500).json({ error: 'Failed to serve log file' });
    }
  }
});

app.get('/debug', (req, res) => {
  res.json({
    hasSourceToken: !!appState.sourceToken,
    hasDestToken: !!appState.destToken,
    sourceUser: appState.sourceUser?.display_name || null,
    destUser: appState.destUser?.display_name || null,
    isSetup: appState.isSetup,
    tokenExpiries: {
      source: appState.sourceTokenExpiry ? new Date(appState.sourceTokenExpiry).toISOString() : null,
      dest: appState.destTokenExpiry ? new Date(appState.destTokenExpiry).toISOString() : null
    }
  });
});

app.get('/test-tokens', async (req, res) => {
  try {
    const results = {};
    if (appState.sourceToken) {
      try {
        const sourceProfile = await fetchUserProfile(appState.sourceToken);
        results.source = { valid: true, user: sourceProfile.display_name };
      } catch (error) {
        results.source = { valid: false, error: error.message };
      }
    }
    if (appState.destToken) {
      try {
        const destProfile = await fetchUserProfile(appState.destToken);
        results.destination = { valid: true, user: destProfile.display_name };
      } catch (error) {
        results.destination = { valid: false, error: error.message };
      }
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto sync setup
if (process.env.ENABLE_AUTO_SYNC === 'true') {
  const syncInterval = parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 30;
  let cronPattern;
  if (syncInterval <= 60) {
    cronPattern = `*/${syncInterval} * * * *`;
  } else {
    const hours = Math.floor(syncInterval / 60);
    cronPattern = `0 */${hours} * * *`;
  }

  cron.schedule(cronPattern, async () => {
    if (appState.isSetup && !appState.syncInProgress) {
      addLog('Running scheduled sync...');
      await performSync();
    }
  });

  addLog(`Auto-sync scheduled every ${syncInterval} minutes`);
}

app.listen(PORT, '127.0.0.1', async () => {
  await loadState();
  addLog(`BigBrain Spotify Playlist Sync server running on http://127.0.0.1:${PORT}`);
});
