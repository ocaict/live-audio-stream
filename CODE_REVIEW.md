# Code Review & Recommendations: ocaTech-live

> **Reviewed:** 2026-03-10  
> **Reviewer:** Kilo Code  
> **Scope:** Full codebase — backend (Node.js/Express/Socket.IO), services, models, routes, and frontend (admin + listener)

---

## 🔴 Critical Issues (Security / Data Integrity)

- [ ] **#1 — Unauthorized Broadcaster Takeover & Socket Event Forgery (High Severity)**  
  `server/sockets/index.js` — Not only does the `broadcaster-ready` event fail to verify channel ownership, but **all** broadcast control events (`start-recording`, `stop-recording`, `audio-chunk`, `stop-broadcasting`) completely lack admin/ownership validation. A malicious listener can connect and freely emit `audio-chunk` to overwrite the live stream, or `stop-broadcasting` to kick the legitimate broadcaster off the air causing Denial of Service.
  **Fix:** Implement a robust `isAdminOrBroadcaster` validation layer inside the socket event handlers.

- [ ] **#2 — DOM-Based Cross-Site Scripting (XSS) in Chat (High Severity)**
  `public/admin/app.js` and `public/listener/app.js` — Chat messages are inserted directly using `innerHTML` (e.g. `div.innerHTML = ... <div class="chat-bubble">${msg.content}</div>`). Because `msg.content` is untrusted database input, any user can post malicious HTML or JavaScript (like `<script>alert('hack')</script>` or `<img src=x onerror=.../>`), which will be executed on all listeners' and broadcasters' browsers!
  **Fix:** Use `textContent` for the message string, or sanitize `msg.content` via a library like `DOMPurify` before injecting it into the DOM.

- [ ] **#3 — Incorrect `is_admin` Flag in Chat Messages**  
  `server/sockets/index.js` (line ~332) — The comment reads *"Verified admin if socket has user attached"*, but the code is `is_admin: !!socket.user`. This marks **every logged-in broadcaster** as an admin in the chat, not just users with `role === 'admin'`.  
  **Fix:** Change to `is_admin: socket.user?.role === 'admin'`.

- [ ] **#4 — `requireChannelOwnership` Bypassed on Recording Upload**  
  `server/routes/recordings.js` — The upload route stores the channel ID on `req.channelId` (from the `X-Channel-Id` header), but the `requireChannelOwnership` middleware reads from `req.params.id || req.body.channelId`. Neither is set for this route, so the ownership check silently passes for any authenticated user.  
  **Fix:** Either pass the channel ID through `req.body.channelId`, or make `requireChannelOwnership` aware of `req.channelId`.

- [ ] **#5 — Unauthenticated Recording Stream Endpoint**  
  `server/routes/recordings.js` — The `GET /:id/stream` route has **no `authenticateToken` middleware**. Any user who knows a recording's UUID can stream it without being logged in.  
  **Fix:** Add `authenticateToken` (and optionally `requireRecordingOwnership`) to the stream route, or make the access model explicit if public streaming is intentional.

- [ ] **#6 — `delete-message` and `clear-chat` Not Restricted to Admins**  
  `server/sockets/index.js` — Both socket handlers check `!!socket.user` (any authenticated user), allowing any broadcaster to delete messages or wipe entire channel chat rooms.  
  **Fix:** Add `socket.user?.role === 'admin'` check, or at minimum verify the user owns the channel.

---

## 🟠 Important Issues (Correctness / Stability)

- [ ] **#7 — AutoDJ Unbounded In-Memory PCM Buffer**  
  `server/services/autoDJService.js` — The `_streamTrack` method accumulates the full decoded PCM of each track with `Buffer.concat([buffer, data])` before drip-feeding it. A 5-minute mono 44.1kHz track = ~26MB per channel in RAM. With many active channels, this is a memory time-bomb.  
  **Fix:** Use a Node.js `PassThrough` stream or a fixed-size ring buffer, and pipe the FFmpeg output in real-time rather than buffering entirely.

- [ ] **#8 — AutoDJ Infinite Error Retry Loop**  
  `server/services/autoDJService.js` — On FFmpeg error, the handler calls `setTimeout(() => this._playNext(channelId), 500)`. If every track in the queue fails (e.g., Cloudinary returns 403 for all), this creates an infinite loop with no circuit breaker or max-retry logic.  
  **Fix:** Track consecutive failures per session and abort/emit an `error` event after a configurable threshold (e.g., 3 consecutive failures).

- [ ] **#9 — `PlaylistModel.updateItems` Is Not Atomic**  
  `server/models/playlist.js` — `updateItems` calls `clearMedia()` then inserts new items as two separate Supabase operations. A concurrent request during the window between clear and re-insert can see an empty playlist.  
  **Fix:** Wrap the operation in a Supabase RPC (stored procedure) or use a database transaction to ensure atomicity.

- [ ] **#10 — Recording Upload Buffers Entire File in RAM**  
  `server/controllers/recordingController.js` — The upload handler collects all request chunks with `for await (const chunk of req)` into a single `Buffer`. A 100MB WAV upload will consume 100MB of server memory.  
  **Fix:** Stream the request body directly to disk or pipe it to the Cloudinary upload stream without accumulating it in memory first.

- [ ] **#11 — `findNextUpcomingSchedule` Makes Up to 8 Sequential Database Queries**  
  `server/models/schedule.js` — The "next show" lookup makes one query for "later today" and then loops through 7 days making individual Supabase calls.  
  **Fix:** Replace with a single SQL query that uses modular arithmetic on `day_of_week` to find the next slot in one round-trip.

---

## 🟡 Moderate Issues (Code Quality / Maintainability)

- [ ] **#12 — Monolithic Frontend JavaScript Files**  
  `public/admin/app.js` is ~84KB (2,200+ lines) and `public/listener/app.js` is ~43KB — both are single-file, fully global scripts with 100+ global variables and no module system.  
  **Recommendation:** Introduce a build step (Vite or esbuild) and split each file into feature modules (e.g., `auth.js`, `webrtc.js`, `recording.js`, `chat.js`, `autodj.js`).

- [ ] **#13 — `server/sockets/index.js` Handles Too Many Responsibilities**  
  At 529 lines, the single socket handler file manages WebRTC signaling, recording lifecycle, Auto-DJ controls, live chat, call-in system, and channel status updates.  
  **Recommendation:** Split into domain-specific socket modules:
  - `sockets/webrtc.js` — offer / answer / ICE
  - `sockets/recording.js` — start-recording / stop-recording / audio-chunk
  - `sockets/chat.js` — send-message / delete-message / clear-chat
  - `sockets/autodj.js` — admin-start-autodj / admin-stop-autodj / skip-track
  - `sockets/callin.js` — request-to-speak / accept-call / reject-call / drop-call

- [ ] **#14 — Inline `require('uuid')` Inside Model Functions**  
  `server/models/playlist.js` (line 8) and `server/models/schedule.js` (line 8) call `require('uuid').v4()` inline at insert time instead of at the top of the file.  
  **Fix:** Add `const { v4: uuidv4 } = require('uuid');` as a top-level import in both files.

- [ ] **#15 — Fragile Cloudinary Public ID Extraction on Delete**  
  `server/controllers/mediaController.js` (line ~97):
  ```js
  const publicId = mediaItem.cloud_url.split('/').pop().split('.')[0];
  ```
  This strips only the filename, losing the folder path (e.g., `radio-recordings/`), so the Cloudinary API deletion call will fail silently for files stored in a subfolder.  
  **Fix:** Store the full `public_id` returned by the Cloudinary upload result in the database, and use that stored value for deletion.

- [ ] **#16 — `twilio` Package Is Installed but Never Used**  
  `package.json` lists `"twilio": "^5.12.2"` but there are no imports or uses of the Twilio SDK in any file. This adds unnecessary weight to `node_modules`.  
  **Action:** Either remove the dependency, or use it to generate short-lived TURN credentials dynamically via the Twilio Network Traversal Service (see #16).

- [ ] **#17 — Public/Free TURN Server Used as Default ICE Config**  
  `server/config/constants.js` — The default ICE config includes `openrelay.metered.ca`, a public free TURN relay with strict rate limits and no SLA. It is not suitable for production under real broadcast load.  
  **Fix:** Use the Twilio NTS REST API (Twilio SDK is already in `package.json`) or another provider to generate short-lived TURN credentials, and serve them from `/api/status/rtc-config`.

- [ ] **#18 — `uncaughtException` Handler Allows Execution to Continue**  
  `server/app.js` (line 128) — Uncaught exceptions are logged but the process **keeps running** in a potentially corrupt state.  
  **Fix:**
  ```js
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1); // Force restart via PM2 / Docker
  });
  ```

---

## 🔵 Recommendations (Improvements / Missing Features)

- [ ] **#19 — Update Outdated Documentation**  
  `README.md` and `SPEC.md` both list `SQLite (better-sqlite3)` as the database, but the project now uses Supabase (PostgreSQL). This is misleading for new contributors.  
  **Action:** Update both files to reflect the current stack (Supabase, Cloudinary, FFmpeg).

- [ ] **#20 — Add Rate Limiting to Socket.IO Events**  
  `express-rate-limit` is applied to HTTP routes, but Socket.IO events have no throttling. A bad actor could flood `send-message` or `audio-chunk` events to exhaust resources.  
  **Recommendation:** Implement a simple per-socket event throttle (e.g., max 5 messages/second for `send-message`). Libraries like `socket.io-rate-limiter` or a manual `Map<socketId, lastEventTime>` approach both work.

- [ ] **#21 — Add Pagination to Recordings Endpoints**  
  `server/models/recording.js` — `findAll()` and `findByChannelId()` return all records with no limit. A station with thousands of recordings will return a very large, slow payload.  
  **Fix:** Add `limit` and `offset` (or cursor-based) pagination to both queries and expose it in the API.

- [ ] **#22 — Add Test Infrastructure**  
  There are no unit tests, integration tests, or CI configuration. Critical paths (recording lifecycle, AutoDJ queue transitions, auth token validation) have zero test coverage.  
  **Recommendation:** Add Jest or Vitest for:
  - Unit tests for services (`autoDJService`, `recordingService`, `webrtcService`)
  - Integration tests for key API routes (`/api/auth`, `/api/recordings`, `/api/channels`)
  - A GitHub Actions workflow for automated test runs on PRs

- [ ] **#23 — Improve the Health Check Endpoint**  
  `server/app.js` — `/api/health` always returns `{ status: 'ok' }` regardless of whether the database or FFmpeg is available.  
  **Fix:** Verify Supabase connectivity and FFmpeg availability inside the health handler so load balancers and monitoring tools can detect a degraded state.

- [ ] **#24 — Upgrade Cloudinary SDK**  
  `package.json` uses `"cloudinary": "^1.41.3"` (v1). The code already imports `{ v2: cloudinary }` from it, but the native v2 package (`cloudinary` ≥ 2.x) has a cleaner API and better TypeScript support.  
  **Action:** Upgrade to `cloudinary` v2.x once `v1` usage has been removed.

- [ ] **#25 — Add a Dockerfile and Docker Compose**  
  There is no containerization configuration in the project. A `Dockerfile` (Node + FFmpeg) and `docker-compose.yml` would enable consistent, reproducible deployments and simplify local environment setup for new contributors.  
  **Recommendation:** Create a simple `Dockerfile` based on `node:18-bullseye-slim` that installs `ffmpeg`, and a `docker-compose.yml` to spin up the application structure easily.

- [ ] **#26 — Replace `console.log` with Structured Logging**  
  The entire codebase uses `console.log` / `console.error` for all logging. In production, this makes it very difficult to filter, search, or route logs.  
  **Recommendation:** Adopt a structured logger like `pino` or `winston` that supports log levels (debug / info / warn / error), JSON output, and integration with log aggregation tools (Datadog, Papertrail, Logtail).

- [ ] **#27 — Plan for WebRTC Scalability (SFU)**  
  The current P2P WebRTC architecture saturates the broadcaster's uplink at approximately 50–100 simultaneous listeners. This is already identified in Phase 6 of the roadmap.  
  **Recommendation:** The existing HTTP chunked stream endpoint (`/api/stream/:channelId` in `server/routes/stream.js`) can serve as an immediate lightweight fallback for large audiences (browser `<audio>` elements with chunked WebM). For the full SFU upgrade, Mediasoup or LiveKit are both well-documented.

- [ ] **#28 — Split Monolithic Frontend Files**  
  `public/admin/app.js` is over 2,400 lines long, handling everything from DOM lookups to WebRTC negotiation. This will quickly become unmaintainable.  
  **Recommendation:** Adopt a lightweight build tool like **Vite** to break the code into ES Modules (e.g., `api.js`, `webrtc.js`, `ui.js`, `chat.js`), or consider migrating the frontend to a component-based framework like Svelte, Vue, or React.

---

## 🎨 Design & UX 

- [ ] **#29 — Button Feedback States**  
  Ensure buttons receive distinct visual loading spinners and become disabled when async tasks (like `startBroadcast` or `uploadMedia`) are executing to prevent accidental double actions.

---

## ✅ What Is Done Well

- **Audio Constraints Visibility** — Exposing "Echo Cancellation", "Noise Suppression", and "Auto Gain" toggles on the frontend is a massive plus for audio professionals who might use external mixers.
- **Clean server-side MVC structure** — controllers, models, services, and routes are clearly separated with no cross-layer leaks.
- **Auth system** — JWT + httpOnly cookies, rate-limited login, UUID session validation, and ownership middleware are solid and correctly layered.
- **Auto-DJ scheduling logic** — Priority-layered queue (active schedule → general library fallback) with automatic jingle injection is well-designed and thoughtful.
- **Broadcaster reconnection grace period** — The 15-second `requestStopBroadcast` timeout in `server/services/webrtcService.js` prevents false "station offline" events on browser refresh or minor network drops.
- **ICE config served dynamically** — Frontend fetches ICE servers from `/api/status/rtc-config` instead of hardcoding them, keeping credentials server-side.
- **Recording finalization** — The `WriteStream 'finish'` event is properly awaited before FFmpeg conversion begins, preventing data races on the temporary `.webm` file.
- **Cloudinary upload fallback** — If Cloudinary upload fails, the recording is retained locally. Good defensive programming.
- **Input validation** — `express-validator` is used on auth routes with clear, structured error responses.
- **Environment validation on startup** — `CONFIG.validate()` checks for missing secrets and warns about default credentials before the server begins accepting traffic.
