const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// Validate Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion < 20) {
  console.error(`❌ Node.js ${nodeVersion} detected. This app requires Node.js 20 or higher.`);
  console.error('Please upgrade to a supported version: https://nodejs.org/');
  process.exit(1);
}

console.log(`✅ Node.js ${nodeVersion} - Compatible`);

const app = express();
const PORT = process.env.PORT || 3000;

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
  logs: []
};
// Spotify API configuration
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

// Utility functions
function addLog(message, type = 'info') {
  const log = {
    timestamp: new Date().toISOString(),
    message,
    type
  };
  appState.logs.unshift(log);
  if (appState.logs.length > 100) {
    appState.logs = appState.logs.slice(0, 100);
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function getSpotifyAuthUrl(accountType) {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    scope: SPOTIFY_CONFIG.scopes,
    state: accountType
  });
  return `https://accounts.spotify.com/authorize?${params}`;
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
    return response.data;
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
    return response.data;
  } catch (error) {
    throw new Error('Failed to refresh token');
  }
}

async function makeSpotifyRequest(url, token, method = 'GET', data = null) {
  try {
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
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Token expired - please re-authenticate');
    }
    throw error;
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
    // Get source playlists
    const sourcePlaylists = await fetchAllPlaylists(appState.sourceToken, appState.sourceUser.id);
    addLog(`Found ${sourcePlaylists.length} source playlists`);
    
    // Get destination playlists for comparison
    const destPlaylists = await fetchAllPlaylists(appState.destToken, appState.destUser.id);
    const destPlaylistMap = new Map(destPlaylists.map(p => [p.name, p]));
    
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
  res.render('index', { 
    appState,
    authUrls: {
      source: getSpotifyAuthUrl('source'),
      destination: getSpotifyAuthUrl('destination')
    }
  });
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    return res.render('error', { error: 'Authentication failed' });
  }
  
  try {
    const tokenData = await exchangeCodeForToken(code);
    const userProfile = await fetchUserProfile(tokenData.access_token);    
    if (state === 'source') {
      appState.sourceToken = tokenData.access_token;
      appState.sourceUser = userProfile;
      addLog(`Source account connected: ${userProfile.display_name}`);
    } else if (state === 'destination') {
      appState.destToken = tokenData.access_token;
      appState.destUser = userProfile;
      addLog(`Destination account connected: ${userProfile.display_name}`);
    }
    
    // Check if both accounts are connected
    if (appState.sourceToken && appState.destToken) {
      appState.isSetup = true;
      addLog('Both accounts connected - ready to sync!');
    }
    
    res.redirect('/');
  } catch (error) {
    addLog(`Authentication error: ${error.message}`, 'error');
    res.render('error', { error: error.message });
  }
});

app.post('/sync', async (req, res) => {
  const result = await performSync();
  res.json(result);
});

app.post('/disconnect', (req, res) => {
  appState = {
    sourceToken: null,
    destToken: null,
    sourceUser: null,
    destUser: null,
    isSetup: false,
    syncStats: { playlists: 0, tracks: 0 },
    lastSync: null,
    syncInProgress: false,
    logs: []
  };
  addLog('All accounts disconnected');
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
    logs: appState.logs.slice(0, 20) // Last 20 logs
  });
});

// Auto-sync setup
if (process.env.ENABLE_AUTO_SYNC === 'true') {
  const syncInterval = process.env.SYNC_INTERVAL_MINUTES || 30;
  cron.schedule(`*/${syncInterval} * * * *`, async () => {
    if (appState.isSetup && !appState.syncInProgress) {
      addLog('Running scheduled sync...');
      await performSync();
    }
  });
  addLog(`Auto-sync scheduled every ${syncInterval} minutes`);
}

// Start server
app.listen(PORT, '127.0.0.1', () => {
  addLog(`Spotify Playlist Sync server running on http://127.0.0.1:${PORT}`);
});