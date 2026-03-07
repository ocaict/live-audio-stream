# OcaTech-Live - Future Features TODO

## Phase 1: Multi-User System (High Priority)

  - [ ] User Registration System
  - [ ] Add `users` table (username, email, password_hash, created_at)
  - [ ] POST `/api/auth/register` endpoint
  - [ ] POST `/api/auth/login` (update to support both admin and users)
  - [ ] POST `/api/auth/logout`
  - [ ] GET `/api/auth/me` (current user info)

- [ ] User Channels
  - [ ] Users can create their own channels
  - [ ] Users can only manage their own channels
  - [ ] Update channel model to link to user_id (not just admin_id)
  - [ ] Update channel routes to enforce ownership

- [ ] User Dashboard UI
  - [ ] Registration form
  - [ ] User login (separate from admin)
  - [ ] User channel management

---

## Phase 2: Enhanced Broadcasting (Medium Priority)

- [ ] TURN Server Configuration
  - [ ] Add TURN server support in RTCConfig
  - [ ] Environment variables for TURN credentials
  - [ ] Support for Twilio, Metered.ca, or coturn

- [x] Auto-reconnect for listeners (Implemented)
- [ ] Auto-Reconnect for Broadcasters
  - [ ] Admin auto-reconnect on network drop
  - [ ] Re-establish WebRTC connection automatically

- [ ] Audio Quality Improvements
  - [ ] Upgrade from ScriptProcessorNode to AudioWorkletNode
  - [ ] Audio level visualization
  - [ ] Noise suppression options

---

## Phase 3: Recording Enhancements (Medium Priority)

- [ ] Recording Metadata
  - [ ] Add title, description, tags to recordings
  - [ ] Edit recording metadata after saving

- [ ] Recording Management
  - [ ] Filter recordings by channel
  - [ ] Search recordings by title/date
  - [ ] Bulk delete recordings

- [ ] Cloud Storage
  - [ ] Complete Cloudinary integration
  - [ ] Support for AWS S3, Google Cloud Storage

---

## Phase 4: Listener Features (Medium Priority)

- [ ] Channel Discovery
  - [ ] Public channel directory page
  - [ ] Channel search/filter
  - [ ] Featured/popular channels

- [ ] Listener Accounts (Optional)
  - [ ] Save favorite channels
  - [ ] Channel subscription notifications
  - [ ] Listening history

- [ ] Social Features
  - [ ] Share channel link
  - [ ] Embed player for external sites

---

## Phase 5: Analytics & Monitoring (Low Priority)

- [ ] Broadcaster Analytics
  - [ ] Listener count over time
  - [ ] Peak listener times
  - [ ] Recording download counts

- [ ] System Monitoring
  - [ ] Dashboard with server stats
  - [ ] Connection health monitoring
  - [ ] Error logging

---

## Phase 6: Scalability (Low Priority)

- [ ] Multi-Server Support
  - [ ] Redis adapter for Socket.IO
  - [ ] Load balancer compatibility
  - [ ] Session affinity

- [ ] SFU Integration (for 500+ listeners)
  - [ ] mediasoup integration
  - [ ] Janus WebRTC Gateway
  - [ ] LiveKit integration option

---

## Phase 7: Security Enhancements (Ongoing)

- [ ] Request Logging
  - [ ] Add morgan for HTTP logging
  - [ ] Log rotation

- [ ] Input Validation (Partially Done)
  - [ ] Validate all API inputs
  - [ ] Sanitize user inputs

- [ ] Security Headers
  - [ ] Add Helmet.js
  - [ ] CSP configuration

- [ ] Rate Limiting (Expand)
  - [ ] Apply to more routes
  - [ ] Per-user rate limits

---

## Phase 8: Code Quality (Ongoing)

- [ ] TypeScript Migration
  - [ ] Add TypeScript to project
  - [ ] Convert models and services
  - [ ] Add type definitions

- [ ] Testing
  - [ ] Set up Jest
  - [ ] Unit tests for models
  - [ ] API endpoint tests

- [ ] Documentation
  - [ ] API documentation (Swagger/OpenAPI)
  - [ ] Deployment guide updates

---

## Phase 9: PWA & Mobile (Future)

- [ ] Progressive Web App
  - [ ] Service worker
  - [ ] Offline support
  - [ ] Installable on mobile

- [ ] Mobile Optimizations
  - [ ] Responsive design improvements
  - [ ] Touch-friendly controls

---

## Phase 10: Advanced Features (Dream)

- [ ] Live Chat
  - [ ] Real-time chat during broadcast
  - [ ] Chat moderation

- [ ] Content Scheduling
  - [ ] Schedule future broadcasts
  - [ ] Automated live/offline

- [ ] Playlist/Replay System
  - [ ] Schedule replay of recordings
  - [ ] AutoDJ functionality

- [ ] Listener Requests
  - [ ] Song/topic requests
  - [ ] Request queue management

- [ ] Push Notifications
  - [ ] Notify when favorite channel goes live
  - [ ] Browser push notifications

---

## Notes

- Priority may change based on user feedback
- Some features depend on each other (e.g., Phase 1 required for Phase 2 user-specific features)
- Scalability features only needed when reaching 500+ concurrent listeners
