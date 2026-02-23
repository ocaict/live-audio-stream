# Radio Live Stream - Technical Specification

## Project Overview
- **Project Name**: Radio Live Stream
- **Type**: Real-time audio streaming web application
- **Core Functionality**: Admin broadcasting via WebRTC, listeners consuming live audio with <12s latency, recording system with FFmpeg conversion
- **Target Users**: Radio station admins (broadcasters) and public listeners

---

## Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Real-time**: Socket.IO (signaling + status updates)
- **Media**: WebRTC (peer-to-peer audio)
- **Conversion**: FFmpeg (WebM → MP3)
- **Database**: SQLite (better-sqlite3)
- **Auth**: bcrypt + JWT
- **Hosting**: Linux VPS compatible

---

## UI/UX Specification

### Layout Structure

#### Admin Dashboard (`/admin`)
- **Header**: Logo, broadcast status indicator, logout button
- **Main Area**:
  - Broadcast controls (Start/Stop)
  - Recording controls (Start/Stop Recording)
  - Microphone permission prompt
  - Connection status
- **Recordings Section**:
  - Table/list of past recordings
  - Play, Download, Delete actions per recording

#### Listener Page (`/listen`)
- **Header**: Station name, live indicator
- **Main Area**: Large "Listen Live" button
- **Player**: Audio player with live status
- **Info**: Current listener count

### Visual Design
- **Primary Color**: `#1a1a2e` (dark navy)
- **Accent Color**: `#e94560` (coral red)
- **Success Color**: `#00d9a5` (teal green)
- **Text Colors**: `#ffffff` (white), `#a0a0a0` (gray)
- **Font**: System sans-serif (Inter/Roboto fallback)
- **Spacing**: 8px base unit

### Components
- Buttons: Rounded corners (4px), hover states
- Status indicators: Pulsing dot for live
- Recording table: Sortable columns
- Audio player: Native HTML5 audio

---

## Functionality Specification

### 1. Admin Authentication
- **Login**: POST `/api/auth/login` with username/password
- **Session**: JWT stored in httpOnly cookie (24h expiry)
- **Middleware**: `authenticateToken` for protected routes
- **Logout**: POST `/api/auth/logout` clears cookie

### 2. Live Broadcasting (WebRTC)
- **Start Broadcast**: Admin clicks "Start Broadcast"
  - Request microphone via `getUserMedia({ audio: true })`
  - Create WebRTC peer connection
  - Socket.IO: Emit `broadcaster-ready` event
- **Listener Connection**:
  - Listener connects to Socket.IO room
  - WebRTC offer/answer exchange via Socket.IO
  - Audio streams peer-to-peer
- **Status Updates**:
  - Socket.IO: `live-status` with boolean
  - Socket.IO: `listener-count` updates

### 3. Recording System
- **Toggle**: Start/Stop recording buttons
- **Constraint**: Recording only allowed while broadcast is live
- **Process**:
  1. Capture audio chunks from WebRTC data channel
  2. Write to temporary WebM file
  3. On stop: FFmpeg convert to MP3
  4. Delete temp WebM file
- **Storage Path**: `/recordings/yyyy-mm-dd/recording-id.mp3`
- **Metadata**: Store in SQLite (id, filename, filepath, filesize, duration, created_at)

### 4. Recordings Management
- **List**: GET `/api/recordings` (admin only)
- **Stream**: GET `/api/recordings/:id/stream`
- **Download**: GET `/api/recordings/:id/download`
- **Delete**: DELETE `/api/recordings/:id` (file + DB record)

### 5. Public Listener Experience
- **Access**: No login required
- **Listen**: Click "Listen Live" → WebRTC connection
- **Latency Target**: <12 seconds (achieved via WebRTC)

### 6. Replay Streaming
- **Route**: Express static or stream route
- **Headers**: `Content-Type: audio/mpeg`, `Content-Length`, `Accept-Ranges: bytes`
- **Seeking**: Support Range requests

---

## Database Schema

### Table: admins
```sql
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table: recordings
```sql
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  filesize INTEGER,
  duration INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### Auth
- `POST /api/auth/login` - Admin login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/check` - Check auth status

### Recordings (Admin)
- `GET /api/recordings` - List all recordings
- `GET /api/recordings/:id/stream` - Stream recording
- `GET /api/recordings/:id/download` - Download recording
- `DELETE /api/recordings/:id` - Delete recording

### Status
- `GET /api/status` - Get live status + listener count

---

## Socket.IO Events

### Client → Server (Admin)
- `start-broadcast` - Admin starts broadcasting
- `stop-broadcast` - Admin stops broadcasting
- `start-recording` - Start recording
- `stop-recording` - Stop recording

### Server → Client
- `live-status` - Broadcast status (boolean)
- `listener-count` - Number of listeners
- `recording-started` - Recording ID
- `recording-stopped` - Recording details

### WebRTC Signaling
- `offer` - SDP offer from listener
- `answer` - SDP answer from broadcaster
- `ice-candidate` - ICE candidate exchange

---

## Security

- **Passwords**: bcrypt hash (cost factor 10)
- **JWT**: httpOnly cookie, 24h expiry
- **Rate Limiting**: express-rate-limit on auth routes
- **Path Traversal**: Validate recording IDs, use absolute paths
- **File Access**: Restrict to `/recordings/` directory only

---

## Performance

- **WebRTC**: Peer-to-peer, minimal server load
- **Recording**: Stream to disk, not RAM
- **Cleanup**: Proper disconnect handlers, garbage collection
- **FFmpeg**: Async conversion, non-blocking

---

## Folder Structure
```
/server
  /config
    database.js
    constants.js
  /routes
    auth.js
    recordings.js
    status.js
  /controllers
    authController.js
    recordingController.js
    statusController.js
  /services
    webrtcService.js
    recordingService.js
    ffmpegService.js
    authService.js
  /sockets
    index.js
  /models
    admin.js
    recording.js
  app.js
/public
  /admin
    index.html
    styles.css
    app.js
  /listener
    index.html
    styles.css
    app.js
recordings/
package.json
.env.example
README.md
```

---

## Acceptance Criteria

1. ✅ Admin can log in with username/password
2. ✅ Admin can start/stop live broadcast
3. ✅ Listeners can hear broadcast with <12s latency
4. ✅ Admin can start/stop recording (only when live)
5. ✅ Recordings converted to MP3 and stored properly
6. ✅ Admin can view, play, download, delete recordings
7. ✅ Public listeners can access live stream without login
8. ✅ All routes properly secured
9. ✅ Production-ready error handling
10. ✅ Deployment documentation provided
