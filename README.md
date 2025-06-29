# 🎵 BigBrain Sync Buddy

A Node.js web application that automatically syncs playlists from one Spotify account to another with one-way synchronization.

## 📋 **System Requirements**

### **Node.js Version Support**
- ✅ **Node.js 20.x LTS** (Active LTS - Recommended)
- ✅ **Node.js 22.x** (Current - Supported)
- ✅ **Node.js 24.x** (Future releases - Supported)
- ❌ Node.js 18.x (End of Life April 2025)
- ❌ Node.js 16.x (End of Life September 2023)

### **Dependency Versions (Latest)**
- **Express 5.0.1** - Latest major version with performance improvements
- **Axios 1.7.9** - Latest with security patches
- **node-cron 3.0.3** - Current stable
- **dotenv 16.4.7** - Latest with Node 20+ optimizations
- **ejs 3.1.10** - Current stable template engine

### **Why These Versions?**
- **Security**: Latest patches for known vulnerabilities
- **Performance**: Optimized for modern Node.js features
- **Long-term Support**: Versions with active maintenance
- **Compatibility**: Tested with Node.js 20+ LTS releases

## ✨ Features

- **One-Way Sync**: Source → Destination account only
- **Auto-Discovery**: Finds all playlists automatically
- **Smart Sync**: Only adds new tracks, avoids duplicates
- **Scheduled Sync**: Configurable automatic syncing (default: 30 minutes)
- **Real-Time Status**: Web dashboard with live sync progress
- **Activity Logs**: Detailed logging of all sync operations
- **Clean UI**: Modern, Spotify-inspired web interface
- **Version Validation**: Automatic Node.js version checking

## 🚀 Quick Start

### 1. Prerequisites

#### **All Platforms**
- Node.js 20+ (LTS) installed
- npm 10+ installed (comes with Node.js)
- Spotify Premium account (recommended for both accounts)
- Spotify Developer App credentials

#### **Installing Node.js**

**macOS:**
```bash
# Option 1: Download from nodejs.org
# Visit https://nodejs.org and download the LTS version

# Option 2: Using Homebrew
brew install node

# Option 3: Using MacPorts
sudo port install nodejs20
```

**Windows:**
```bash
# Option 1: Download from nodejs.org
# Visit https://nodejs.org and download the LTS version (.msi installer)

# Option 2: Using Chocolatey (run as Administrator)
choco install nodejs-lts

# Option 3: Using Scoop
scoop install nodejs-lts
```

### 2. Spotify App Setup
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Note your **Client ID** and **Client Secret**
4. Add redirect URI: `http://127.0.0.1:3000/callback`

### 3. Installation

#### **macOS Installation**

```bash
# Check Node.js version (requires 20+)
node --version

# Check npm version (requires 10+)
npm --version

# Clone or download the project files
# Navigate to the project directory in Terminal
cd /path/to/bigbrain-sync-buddy

# Install dependencies (with version check)
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your Spotify credentials (using nano, vim, or any text editor)
nano .env
# Or open in VS Code
code .env
```

#### **Windows Installation**

```bash
# Open Command Prompt or PowerShell as Administrator

# Check Node.js version (requires 20+)
node --version

# Check npm version (requires 10+)
npm --version

# Clone or download the project files
# Navigate to the project directory
cd C:\path\to\bigbrain-sync-buddy

# Install dependencies (with version check)
npm install

# Copy environment template (Command Prompt)
copy .env.example .env

# Or in PowerShell
Copy-Item .env.example .env

# Edit .env with your Spotify credentials
# Option 1: Open in Notepad
notepad .env

# Option 2: Open in VS Code
code .env
```
### 4. Configure Environment

Edit `.env` file:
```bash
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
PORT=3000
SYNC_INTERVAL_MINUTES=30
ENABLE_AUTO_SYNC=true
```

### 5. Run the Application

#### **macOS/Linux**
```bash
# Start the server
npm start

# For development (auto-restart)
npm run dev
```

#### **Windows**
```bash
# Start the server (Command Prompt or PowerShell)
npm start

# For development (auto-restart)
npm run dev

# If you encounter permission issues, run as Administrator
```

### 6. Setup Accounts

1. Open http://127.0.0.1:3000 in your browser
2. Connect your **Source** Spotify account
3. Connect your **Destination** Spotify account
4. Click "Sync Now" to start initial sync

## 📖 How It Works

### Sync Process
1. **Discovery**: Scans source account for all owned playlists
2. **Comparison**: Checks destination account for existing playlists
3. **Creation**: Creates missing playlists on destination account
4. **Track Sync**: Adds new tracks from source to destination playlists
5. **Scheduling**: Automatically repeats based on configured interval

### What Gets Synced
- ✅ All playlists owned by the source user
- ✅ Playlist names and descriptions
- ✅ All tracks in each playlist
- ❌ Collaborative playlists not owned by source user
- ❌ Playlist order/position
- ❌ Playlist artwork (uses Spotify defaults)

## 🛠️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPOTIFY_CLIENT_ID` | - | Your Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | - | Your Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:3000/callback` | OAuth redirect URI |
| `PORT` | `3000` | Server port |
| `SYNC_INTERVAL_MINUTES` | `30` | Auto-sync frequency |
| `ENABLE_AUTO_SYNC` | `true` | Enable scheduled syncing |

### Sync Frequency
The app automatically syncs every 30 minutes by default. You can change this by:
1. Modifying `SYNC_INTERVAL_MINUTES` in `.env`
2. Restarting the application
## 🔧 API Endpoints

- `GET /` - Main dashboard
- `GET /callback` - Spotify OAuth callback
- `POST /sync` - Trigger manual sync
- `POST /disconnect` - Disconnect all accounts
- `GET /status` - Get current sync status (JSON)

## 📱 Usage Tips

### For Best Results
- Use Spotify Premium accounts for both source and destination
- Ensure both accounts have good internet connectivity
- Let the initial sync complete before making changes
- Monitor the activity log for any issues

### Troubleshooting
- **Token Expired**: Re-authenticate affected account
- **Sync Fails**: Check logs for specific error messages
- **Missing Playlists**: Ensure source user owns the playlist
- **Duplicate Tracks**: The app prevents duplicates automatically

## 🔒 Security & Privacy

- **Local Storage**: All data stored locally on your machine
- **No Persistent Storage**: Uses in-memory storage (data resets on restart)
- **Secure Auth**: Uses official Spotify OAuth 2.0 flow
- **No Data Collection**: App doesn't collect or transmit personal data

## 🏗️ Production Deployment

For production use:

1. **Database**: Replace in-memory storage with Redis/PostgreSQL
2. **Security**: Use HTTPS and secure session management
3. **Monitoring**: Add proper logging and error tracking
4. **Scaling**: Consider rate limiting and concurrent sync handling

## 📦 Project Structure

```
bigbrain-sync-buddy/
├── app.js              # Main application server
├── package.json        # Dependencies and scripts
├── .env.example        # Environment template
├── .vscode/            # VS Code configuration
│   ├── launch.json     # Debug configurations
│   ├── settings.json   # Workspace settings
│   ├── tasks.json      # Build tasks
│   └── extensions.json # Recommended extensions
├── views/
│   ├── index.ejs       # Main dashboard
│   └── error.ejs       # Error page
└── README.md          # This file
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - feel free to use this project for personal or commercial use.

## ⚠️ Disclaimer

This application is not affiliated with Spotify. Use responsibly and respect Spotify's Terms of Service and API rate limits.