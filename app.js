const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');
require('dotenv').config();

// Validate Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion < 16) {
  console.error(`❌ Node.js ${nodeVersion} detected. This app requires Node.js 16 or higher.`);
  console.error('Please upgrade to a supported version: https://nodejs.org/');
  process.exit(1);
}

if (majorVersion < 20) {
  console.warn(`⚠️  Node.js ${nodeVersion} detected. For best performance, upgrade to Node.js 20+`);
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
    // Error logs - separate file for errors only
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
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level.toUpperCase()}] ${message}${stack ? '\n' + stack : ''}`;
        })
      )
    }),
    // Combined logs - all log levels  
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
    // Console output (for development)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      )
    })
  ]
});

// Handle uncaught exceptions and rejections with fallback
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
} catch (error) {
  console.warn('⚠️  Advanced logging features not available, using basic logging');
  // Fallback to console for exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || `http://${HOST}:${PORT}`;

// Storage file path
const STORAGE_FILE = path.join(__dirname, 'app-data.json');

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

// In-memory storage (for simplicity - use database in production)
let appState = {
  sourceToken: null,
  destToken: null,
  sourceUser: null,
  destUser: null,
  isSetup: false,
  syncStats: { playlists: 0, tracks: 0 },
  lastSync: null,
  syncInProgress: false,
  logs: [],
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 30 // Default 30 minutes
};

// Load state from file on startup
async function loadState() {
  try {
    const data = await fs.readFile(STORAGE_FILE, 'utf8');
    const savedState = JSON.parse(data);

    // Merge saved state with default state
    appState = { ...appState, ...savedState };

    // Don't persist syncInProgress state
    appState.syncInProgress = false;

    addLog(`📁 Loaded saved state: ${appState.isSetup ? 'Setup complete' : 'Setup required'}`);

    if (appState.sourceUser) {
      addLog(`👤 Source account: ${appState.sourceUser.display_name}`);
    }
    if (appState.destUser) {
      addLog(`👤 Destination account: ${appState.destUser.display_name}`);
    }

  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading state:', error);
    }
    addLog('📁 No saved state found, starting fresh');
  }
}

// Save state to file
async function saveState() {
  try {
    // Don't save syncInProgress state
    const stateToSave = { ...appState, syncInProgress: false };
    await fs.writeFile(STORAGE_FILE, JSON.stringify(stateToSave, null, 2));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}
// Spotify API configuration
const SPOTIFY_CONFIG = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || `${BASE_URL}/callback`,
  scopes: [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public'
  ].join(' ')
};

// Utility functions
function addLog(message, type = 'info') {
  const log = {
    timestamp: new Date().toISOString(),
    message,
    type
  };
  
  // Add to in-memory logs for UI display (keep last 100)
  appState.logs.unshift(log);
  if (appState.logs.length > 100) {
    appState.logs = appState.logs.slice(0, 100);
  }
  
  // Log to file using winston
  logger.log(type, message);
  
  // Save state after adding log (but don't await to avoid blocking)
  saveState().catch(err => {
    logger.error('Failed to save state after logging', { error: err.message });
  });
}

function getSpotifyAuthUrl(accountType, mode = 'normal') {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    scope: SPOTIFY_CONFIG.scopes,
    state: accountType,
    show_dialog: 'true'  // Force account selection dialog
  });
  
  // Add mode to state parameter for incognito flows
  if (mode === 'incognito') {
    params.set('state', `${accountType}:incognito`);
  }
  
  const authUrl = `https://accounts.spotify.com/authorize?${params}`;
  logger.debug(`Auth URL generated for ${accountType}`, { url: authUrl, mode });
  return authUrl;
}

async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_CONFIG.redirectUri,
        client_id: SPOTIFY_CONFIG.clientId,
        client_secret: SPOTIFY_CONFIG.clientSecret
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // Add token timestamp for expiration tracking
    const tokenData = response.data;
    tokenData.obtained_at = Date.now();

    return tokenData;
  } catch (error) {
    throw new Error('Failed to exchange code for token');
  }
}
async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: SPOTIFY_CONFIG.clientId,
        client_secret: SPOTIFY_CONFIG.clientSecret
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // Add token timestamp for expiration tracking
    const tokenData = response.data;
    tokenData.obtained_at = Date.now();

    return tokenData;
  } catch (error) {
    throw new Error('Failed to refresh token');
  }
}

// Check and refresh tokens if needed
async function ensureValidToken(accountType) {
  const now = Date.now();
  const buffer = 5 * 60 * 1000; // 5 minutes buffer

  if (accountType === 'source') {
    if (appState.sourceTokenExpiry && now >= (appState.sourceTokenExpiry - buffer)) {
      if (appState.sourceRefreshToken) {
        try {
          addLog('🔄 Refreshing source token...');
          const tokenData = await refreshAccessToken(appState.sourceRefreshToken);
          appState.sourceToken = tokenData.access_token;
          if (tokenData.refresh_token) {
            appState.sourceRefreshToken = tokenData.refresh_token;
          }
          appState.sourceTokenExpiry = tokenData.obtained_at + (tokenData.expires_in * 1000);
          await saveState();
          addLog('✅ Source token refreshed');
        } catch (error) {
          addLog('❌ Failed to refresh source token', 'error');
          throw new Error('Source token expired - please re-authenticate');
        }
      } else {
        throw new Error('Source token expired - please re-authenticate');
      }
    }
  } else if (accountType === 'destination') {
    if (appState.destTokenExpiry && now >= (appState.destTokenExpiry - buffer)) {
      if (appState.destRefreshToken) {
        try {
          addLog('🔄 Refreshing destination token...');
          const tokenData = await refreshAccessToken(appState.destRefreshToken);
          appState.destToken = tokenData.access_token;
          if (tokenData.refresh_token) {
            appState.destRefreshToken = tokenData.refresh_token;
          }
          appState.destTokenExpiry = tokenData.obtained_at + (tokenData.expires_in * 1000);
          await saveState();
          addLog('✅ Destination token refreshed');
        } catch (error) {
          addLog('❌ Failed to refresh destination token', 'error');
          throw new Error('Destination token expired - please re-authenticate');
        }
      } else {
        throw new Error('Destination token expired - please re-authenticate');
      }
    }
  }
}

async function makeSpotifyRequest(url, token, method = 'GET', data = null) {
  try {
    logger.debug(`Making ${method} request to Spotify API`, { url, method });
    const config = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    logger.debug(`Spotify API request successful`, { url, status: response.status });
    return response.data;
  } catch (error) {
    logger.error(`Spotify API request failed`, {
      url,
      method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    if (error.response?.status === 401) {
      throw new Error('Token expired - please re-authenticate');
    }
    if (error.response?.status === 403) {
      throw new Error('Access forbidden - check app permissions');
    }
    if (error.response?.status === 429) {
      throw new Error('Rate limited - too many requests');
    }
    throw new Error(`Spotify API error: ${error.response?.status || error.message}`);
  }
}

async function fetchUserProfile(token) {
  return await makeSpotifyRequest('https://api.spotify.com/v1/me', token);
}

async function fetchAllPlaylists(token, userId) {
  let playlists = [];
  let url = 'https://api.spotify.com/v1/me/playlists?limit=50';

  while (url) {
    const data = await makeSpotifyRequest(url, token);
    playlists = playlists.concat(data.items);
    url = data.next;
  }

  // Filter to only user's own playlists
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
    name: name,
    description: description || 'Synced from source account',
    public: false
  });
}

async function addTracksToPlaylist(token, playlistId, trackUris) {
  const chunkSize = 100;

  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

    await makeSpotifyRequest(url, token, 'POST', {
      uris: chunk
    });

    // Small delay between requests
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
    // Test token validity first
    addLog('🔍 Testing source token...');
    await ensureValidToken('source');
    const sourceProfile = await makeSpotifyRequest('https://api.spotify.com/v1/me', appState.sourceToken);
    addLog(`✅ Source account verified: ${sourceProfile.display_name}`);

    addLog('🔍 Testing destination token...');
    await ensureValidToken('destination');
    const destProfile = await makeSpotifyRequest('https://api.spotify.com/v1/me', appState.destToken);
    addLog(`✅ Destination account verified: ${destProfile.display_name}`);

    // Get source playlists
    addLog('📋 Fetching source playlists...');
    const sourcePlaylists = await fetchAllPlaylists(appState.sourceToken, appState.sourceUser.id);
    addLog(`Found ${sourcePlaylists.length} source playlists`);

    // Get destination playlists for comparison
    addLog('📋 Fetching destination playlists...');
    const destPlaylists = await fetchAllPlaylists(appState.destToken, appState.destUser.id);
    const destPlaylistMap = new Map(destPlaylists.map(p => [p.name, p]));
    addLog(`Found ${destPlaylists.length} destination playlists`);

    let totalTracks = 0;
    let syncedPlaylists = 0;
    let newPlaylists = 0;
    let newTracks = 0;

    for (const sourcePlaylist of sourcePlaylists) {
      try {
        // Skip collaborative playlists if user doesn't own them
        if (sourcePlaylist.collaborative && sourcePlaylist.owner.id !== appState.sourceUser.id) {
          continue;
        }

        const tracks = await fetchPlaylistTracks(appState.sourceToken, sourcePlaylist.id);

        if (tracks.length === 0) {
          continue; // Skip empty playlists
        }
        let destPlaylist = destPlaylistMap.get(sourcePlaylist.name);

        if (!destPlaylist) {
          // Create new playlist
          destPlaylist = await createPlaylist(
            appState.destToken,
            appState.destUser.id,
            sourcePlaylist.name,
            sourcePlaylist.description
          );
          addLog(`Created playlist: ${sourcePlaylist.name}`);
          newPlaylists++;
        }

        // Get current tracks in destination playlist
        const currentTracks = await fetchPlaylistTracks(appState.destToken, destPlaylist.id);
        const currentTrackUris = new Set(currentTracks.map(t => t.track.uri));

        // Find new tracks to add
        const tracksToAdd = tracks.filter(t => !currentTrackUris.has(t.track.uri));

        if (tracksToAdd.length > 0) {
          await addTracksToPlaylist(
            appState.destToken,
            destPlaylist.id,
            tracksToAdd.map(t => t.track.uri)
          );
          addLog(`Added ${tracksToAdd.length} tracks to ${sourcePlaylist.name}`);
          newTracks += tracksToAdd.length;
        }

        totalTracks += tracks.length;
        syncedPlaylists++;

      } catch (playlistError) {
        addLog(`Error syncing playlist ${sourcePlaylist.name}: ${playlistError.message}`, 'error');
      }
    }
    const stats = {
      playlists: syncedPlaylists,
      tracks: totalTracks,
      newPlaylists,
      newTracks
    };

    appState.syncStats = stats;
    appState.lastSync = new Date().toISOString();

    // Save state after successful sync
    await saveState();

    addLog(`Sync completed: ${syncedPlaylists} playlists, ${totalTracks} total tracks, ${newTracks} new tracks added`);

    return { success: true, stats };

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
      destination: getSpotifyAuthUrl('destination', mode)
    },
    mode: mode || 'normal',
    appUrl
  });
});

app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log('📥 Callback received:', { code: !!code, state, error, error_description });

  if (error) {
    const errorMsg = `Authentication failed: ${error}${error_description ? ` - ${error_description}` : ''}`;
    addLog(errorMsg, 'error');
    return res.render('error', { error: errorMsg });
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const userProfile = await fetchUserProfile(tokenData.access_token);
    
    // Parse state parameter (might include mode info)
    const [accountType, mode] = state.includes(':') ? state.split(':') : [state, null];
    
    if (accountType === 'source') {
      appState.sourceToken = tokenData.access_token;
      appState.sourceRefreshToken = tokenData.refresh_token;
      appState.sourceTokenExpiry = tokenData.obtained_at + (tokenData.expires_in * 1000);
      appState.sourceUser = userProfile;
      addLog(`Source account connected: ${userProfile.display_name}`);
    } else if (accountType === 'destination') {
      appState.destToken = tokenData.access_token;
      appState.destRefreshToken = tokenData.refresh_token;
      appState.destTokenExpiry = tokenData.obtained_at + (tokenData.expires_in * 1000);
      appState.destUser = userProfile;
      addLog(`Destination account connected: ${userProfile.display_name}`);
    } else {
      const errorMsg = `Invalid state parameter: ${state}`;
      addLog(errorMsg, 'error');
      return res.render('error', { error: errorMsg });
    }

    // Check if both accounts are connected
    if (appState.sourceToken && appState.destToken) {
      appState.isSetup = true;
      addLog('Both accounts connected - ready to sync!');
    }

    // Save state after successful authentication
    await saveState();

    // Check if this is an incognito auth flow
    if (mode === 'incognito') {
      return res.render('auth-success', { 
        accountType,
        userName: userProfile.display_name 
      });
    }

    res.redirect('/');
  } catch (error) {
    addLog(`Authentication error: ${error.message}`, 'error');
    res.render('error', { error: error.message });
  }
});

app.post('/sync', async (req, res) => {
  try {
    logger.info('Manual sync requested');
    const result = await performSync();
    logger.info('Sync completed', { success: result.success, stats: result.stats });
    res.json(result);
  } catch (error) {
    logger.error('Sync endpoint error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown sync error'
    });
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
    syncStats: { playlists: 0, tracks: 0 },
    lastSync: null,
    syncInProgress: false,
    logs: []
  };
  addLog('All accounts disconnected');

  // Save cleared state
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
    logs: appState.logs.slice(0, 20), // Last 20 logs
    syncInterval: appState.syncInterval || 30 // Current sync interval in minutes
  });
});

// Sync interval configuration endpoint
app.post('/sync-interval', async (req, res) => {
  try {
    const { interval } = req.body;
    
    // Validate interval (1 minute to 24 hours = 1440 minutes)
    if (!interval || typeof interval !== 'number' || interval < 1 || interval > 1440) {
      return res.status(400).json({
        success: false,
        error: 'Invalid interval. Must be between 1 minute and 24 hours (1440 minutes).'
      });
    }
    
    // Update the sync interval
    appState.syncInterval = interval;
    
    // Save state
    await saveState();
    
    // Restart the cron job with new interval
    setupAutoSync();
    
    addLog(`Sync interval updated to ${interval} minutes`);
    
    res.json({
      success: true,
      interval: interval,
      message: `Sync interval set to ${interval} minutes`
    });
    
  } catch (error) {
    logger.error('Error updating sync interval', { 
      error: error.message, 
      stack: error.stack,
      interval: req.body.interval 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update sync interval: ' + error.message
    });
  }
});

// Log management endpoint
app.get('/logs', async (req, res) => {
  try {
    const logDir = path.join(__dirname, 'logs');
    const files = await fs.readdir(logDir);
    
    const logFiles = files
      .filter(file => file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: `/logs/${file}`,
        size: 0 // Will be populated by file stats
      }));
    
    // Get file stats
    for (const logFile of logFiles) {
      try {
        const stats = await fs.stat(path.join(logDir, logFile.name));
        logFile.size = stats.size;
        logFile.modified = stats.mtime;
      } catch (err) {
        logger.warn(`Could not get stats for log file ${logFile.name}`, { error: err.message });
      }
    }
    
    res.json({
      logFiles: logFiles.sort((a, b) => b.modified - a.modified),
      logLevel: logger.level,
      logDir: logDir
    });
  } catch (error) {
    logger.error('Error listing log files', { error: error.message });
    res.status(500).json({ error: 'Failed to list log files' });
  }
});

// Serve log files
app.get('/logs/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const logPath = path.join(__dirname, 'logs', filename);
    
    // Security check - ensure file is in logs directory
    const resolvedPath = path.resolve(logPath);
    const logsDir = path.resolve(path.join(__dirname, 'logs'));
    
    if (!resolvedPath.startsWith(logsDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const stats = await fs.stat(logPath);
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    
    const stream = require('fs').createReadStream(logPath);
    stream.pipe(res);
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Log file not found' });
    } else {
      logger.error('Error serving log file', { filename: req.params.filename, error: error.message });
      res.status(500).json({ error: 'Failed to serve log file' });
    }
  }
});

// Debug endpoint to check current state
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

// Test endpoint to validate tokens
app.get('/test-tokens', async (req, res) => {
  try {
    const results = {};

    if (appState.sourceToken) {
      try {
        const sourceProfile = await makeSpotifyRequest('https://api.spotify.com/v1/me', appState.sourceToken);
        results.source = { valid: true, user: sourceProfile.display_name };
      } catch (error) {
        results.source = { valid: false, error: error.message };
      }
    }

    if (appState.destToken) {
      try {
        const destProfile = await makeSpotifyRequest('https://api.spotify.com/v1/me', appState.destToken);
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

// Auto-sync management
let currentCronJob = null;

function setupAutoSync() {
  // Stop existing job if any
  if (currentCronJob) {
    currentCronJob.stop();
    // Note: node-cron doesn't have a destroy method
    currentCronJob = null;
  }

  // Only setup if auto-sync is enabled
  if (process.env.ENABLE_AUTO_SYNC !== 'true') {
    addLog('Auto-sync is disabled');
    return;
  }

  const syncInterval = appState.syncInterval || 30;

  // Create cron pattern based on interval
  let cronPattern;
  if (syncInterval <= 60) {
    // For intervals <= 60 minutes, use minute-based scheduling
    cronPattern = `*/${syncInterval} * * * *`;
  } else {
    // For longer intervals, convert to hours
    const hours = Math.floor(syncInterval / 60);
    cronPattern = `0 */${hours} * * *`;
  }

  try {
    currentCronJob = cron.schedule(cronPattern, async () => {
      if (appState.isSetup && !appState.syncInProgress) {
        addLog('Running scheduled sync...');
        await performSync();
      }
    }, {
      scheduled: true,
      timezone: "America/New_York" // You can make this configurable too
    });
    
    addLog(`Auto-sync scheduled every ${syncInterval} minutes`);
  } catch (error) {
    logger.error('Failed to setup auto-sync', { error: error.message, interval: syncInterval });
    addLog(`Failed to setup auto-sync: ${error.message}`, 'error');
  }
}

// Initialize auto-sync on startup
setupAutoSync();

// Start server
app.listen(PORT, HOST, async () => {
  await loadState(); // Load saved state on startup
  addLog(`BigBrain Spotify Playlist Sync server running on ${BASE_URL}`);
  addLog(`Spotify callback URL configured as: ${SPOTIFY_CONFIG.redirectUri}`);
});