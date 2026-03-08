# 📋 Implementation Checklist: ocaTech-live

This checklist outlines the recommended improvements for the Radio Live Stream application, prioritized by their impact on reliability, security, and scalability.

## 🔴 Phase 0: Critical Reliability & Security (Immediate Priority)

### 1. Real-time Recording Migration
*   [ ] **Admin UI Refactor**: Remove in-memory `Float32Array` buffering in `public/admin/app.js`.
*   [ ] **Socket Streaming**: Implement `socket.emit('audio-chunk', chunk)` using `MediaRecorder` or `AudioWorklet`.
*   [ ] **Server-side Writer**: Update `RecordingService.js` to handle concurrent streams and write directly to disk.
*   [ ] **Data Safety**: Ensure recordings are recoverable if the server or client disconnects unexpectedly.

### 2. Guard Against SQL Injection
*   [ ] **Audit Models**: Review `server/models/channel.js` and others for template literal queries.
*   [ ] **Parameterize All Queries**: Replace all `${var}` in SQL strings with `?` and pass variables via the params array in `db.run()` and `db.exec()`.

### 3. Socket.IO Authentication
*   [ ] **Middleware Implementation**: Add a middleware to `server/sockets/index.js` that verifies the JWT from the connection's cookies.
*   [ ] **Role-based Actions**: Ensure only users with 'admin' roles can emit `broadcaster-ready` or `start-recording`.

---

## 🟡 Phase 1: Architectural Robustness (Medium Priority)

### 4. Support Concurrent Recordings
*   [ ] **Map-based State**: Refactor `RecordingService.js` to store active recordings in a `Map<channelId, recordingContext>`.
*   [ ] **Namespace/Room Cleanup**: Ensure that stopping a broadcast on one channel does not affect recordings on another.

### 5. Web Audio API Modernization
*   [ ] **AudioWorklet Migration**: Replace the deprecated `ScriptProcessorNode` with an `AudioWorkletNode` for lower-latency and thread-safe audio processing.
*   [ ] **Buffered Playback (Listeners)**: Improve listener buffer management to handle minor network jitter without audio dropouts.

### 6. Environment & Startup Validation
*   [ ] **Fail-Fast Checks**: Update `server/app.js` to validate that all required `.env` variables (JWT_SECRET, CLOUDINARY if enabled, etc.) are present before starting.

---

## 🔵 Phase 2: User Experience & Analytics (Enhancement)

### 7. Admin Dashboard Polish
*   [ ] **Real-time Stats**: Add a simple time-series chart for listener counts using Chart.js or similar.
*   [ ] **Audio Quality Toggle**: Add UI switches for Echo Cancellation, Noise Suppression, and Auto Gain Control.
*   [ ] **Channel Meta Editor**: Allow admins to update channel names/colors without a page refresh.

### 8. Listener UX Improvements
*   [ ] **Seamless Handover**: Better transition when a channel goes from "Offline" to "Live" while the listener tab is open.
*   [ ] **Volume Persistence**: Save the listener's volume preference in `localStorage`.

---

## 🟢 Phase 3: Scalability (Future Growth)

### 9. Media Server Integration (SFU)
*   [ ] **Mediasoup/Janus Research**: Plan for a transition from P2P to an SFU architecture if concurrent listeners exceed 100 per channel.
*   [ ] **Load Balancing**: Implement a Redis adapter for Socket.IO to support multiple node server instances.

---

> [!TIP]
> **Priority Recommendation**: Start with **Task 1 (Real-time Recording Migration)**. It is the single most important change to prevent data loss and browser instability for your broadcasters.
