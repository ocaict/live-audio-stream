# 🔐 OcaTech-Live Authentication Implementation Checklist

This document outlines the step-by-step transition from an anonymous platform to a secure, role-based identity system using **Supabase Auth** and **JWT**.

---

## 🛠 Phase 0: Infrastructure Prep
- [ ] **Configure Supabase Auth Settings**:
    - Enable 'Email/Password' and 'Magic Link' in the Supabase Dashboard.
    - Configure 'Google' OAuth Provider with Client ID and Secret.
- [ ] **Database Schema Updates**:
    - [ ] Create a `profiles` table to store extra user metadata (displayName, avatarUrl, role).
    - [ ] Set up a `handle_new_user()` database function/trigger to automatically create a profile record on sign-up.
- [ ] **Dependency Setup**:
    - [ ] Install `@supabase/supabase-js` in the listener and admin frontends.
    - [ ] Add `jsonwebtoken` and `cookie-parser` to the Node.js server.

---

## 🎧 Phase 1: Listener Progressive Identity
- [ ] **Unified Auth Modal**:
    - Build a premium, glassmorphic login modal within the listener app.
    - Implement "Continue with Google" for zero-friction access.
- [ ] **Session Management**:
    - Store the Supabase session in a cookie or localStorage.
    - Sync the `chatUsername` stored in state with the verified `profile.display_name` if logged in.
- [ ] **Member-Only Features**:
    - [ ] Add a "Verified" badge next to logged-in users in the Chat.
    - [ ] Lock the "Request to Speak" (Call-In) feature behind a login requirement to prevent abuse.
    - [ ] Implement "Favorite Stations" persistence for logged-in accounts.

---

## 🎙 Phase 2: Broadcaster & Admin Hardening
- [ ] **Protected Routes**:
    - Implement a Server-Side Middleware to check JWT/Session for any `/admin` or `/api/admin` requests.
    - Redirect unauthenticated users to a dedicated `/login` page.
- [ ] **RBAC (Role-Based Access Control)**:
    - [ ] Logic to check if `user.role === 'admin'` or `'broadcaster'` before allowing stream management.
- [ ] **Secure Cookie Handling**:
    - Switch from local storage to `HttpOnly` and `SameSite=Strict` cookies for Admin sessions to prevent XSS credential theft.

---

## ⚡ Phase 3: Real-time Integration (Socket.io)
- [ ] **Socket Authentication Handshake**:
    - Update `socket.io` server to expect an `auth` token during connection.
    - Verify the token against Supabase/JWT before allowing the connection to move from "Guest" to "Authenticated" status.
- [ ] **Identity Propagation**:
    - When a user sends a message, pull the `user_id` from the socket session rather than relying on client-sent metadata.

---

## 💅 Phase 4: UX Polish & Progressive Disclosure
- [ ] **Auth Navigation States**: 
    - Update the bottom nav or header to show the user's avatar when logged in.
- [ ] **Graceful Downgrades**:
    - Ensure the audio player STILL works if the user is not logged in.
    - Show friendly "sign in to join the conversation" prompts in the chat box.

---

## ✅ Success Criteria
1. **Security**: Admins cannot be spoofed; user sessions are verified server-side.
2. **Friction**: New listeners can hear music in < 1 second without logging in.
3. **Identity**: Users can switch from mobile to desktop and keep their "Favorites" and "Display Name."
