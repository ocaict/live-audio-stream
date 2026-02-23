# Radio Live Stream

Real-time radio streaming web application with WebRTC, recording system, and admin dashboard.

## Features

- **Live Broadcasting**: Admin broadcasts audio via WebRTC
- **Ultra-low Latency**: Target <12 seconds using peer-to-peer WebRTC
- **Recording System**: Capture live audio, convert to MP3 via FFmpeg
- **Admin Dashboard**: Manage broadcast and recordings
- **Public Listeners**: No login required, instant access

## Tech Stack

- Node.js + Express.js
- Socket.IO (signaling + real-time updates)
- WebRTC (peer-to-peer audio)
- FFmpeg (audio conversion)
- SQLite (database)
- bcrypt (password hashing)

## Prerequisites

- Node.js 18+
- FFmpeg installed on system

## Installation

```bash
# Clone and install dependencies
npm install

# Create environment file
cp .env.example .env

# Install FFmpeg (see below for your OS)

# Start the server
npm start
```

## Install FFmpeg

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install ffmpeg
```

### Linux (CentOS/RHEL)
```bash
sudo yum install ffmpeg
```

### macOS
```bash
brew install ffmpeg
```

### Windows
Download from https://ffmpeg.org/download.html and add to PATH, or use:
```bash
choco install ffmpeg
```

## Usage

### Default Credentials
- Username: `admin`
- Password: `admin123`

**Change password after first login!**

### URLs
- Listener: http://localhost:3000/listen
- Admin: http://localhost:3000/admin
- API: http://localhost:3000/api

## Recording & Conversion Workflow

1. **Capture**: WebRTC audio chunks captured via MediaRecorder
2. **Store**: Temp WebM file written to disk
3. **Convert**: FFmpeg converts WebM → MP3 on stop
4. **Cleanup**: Temp WebM deleted after conversion
5. **Metadata**: Recording info stored in SQLite

## WebRTC Signaling

```
Admin (Broadcaster)                    Server                    Listeners
    |                                      |                          |
    |-- broadcaster-ready (socket) -----> |                          |
    |                                      |-- live-status (broadcast)|
    |                                      |                          |
    |                                      | <-- join-as-listener --- |
    |                                      |                          |
    |                                      | <---- offer (sdp) -------|
    |                                      |
    | <----------------------------------- |-- offer (sdp) ----------|
    |                                      |                          |
    | ---- answer (sdp) -----------------> |                          |
    |                                      | ---- answer (sdp) ----->|
    |                                      |                          |
    | <--- ice-candidate (async) -------- |                          |
    |                                      |                          |
    | ---- ice-candidate (async) ------> |                          |
    |                                      | ---- ice-candidate ---->|
    |                                      |                          |
    |==================================== WebRTC P2P Audio =========>|
```

## Security

- JWT in httpOnly cookies
- bcrypt password hashing (cost factor 10)
- Rate limiting on auth routes
- Path traversal protection
- Admin-only recording access

## Production Deployment

### Using PM2
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server/app.js --name radio-stream

# Setup auto-restart
pm2 startup
pm2 save
```

### Environment Variables (.env)
```env
PORT=3000
NODE_ENV=production
JWT_SECRET=your-secure-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
RECORDINGS_DIR=./recordings
FFMPEG_PATH=ffmpeg
```

### Nginx Reverse Proxy (Recommended)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Scaling Considerations

- For >500 concurrent listeners, consider:
  - Media server (SFU) like mediasoup or Janus
  - CDN for static files
  - Load balancer with sticky sessions
  - Redis adapter for Socket.IO

## License

MIT
