# Playlist Scheduling Implementation Guide 🗓️

To enable Playlist Scheduling and structured Auto-DJ sessions, you must first create the following tables in your **Supabase SQL Editor**.

### 1. Run this SQL in Supabase

```sql
-- 1. Playlists Table
CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Playlist Media (Join Table for ordering)
CREATE TABLE playlist_media (
  playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
  media_id UUID REFERENCES media_library(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, media_id)
);

-- 3. Schedules Table
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup during Auto-DJ boot
CREATE INDEX idx_schedules_active ON schedules (channel_id, day_of_week, is_enabled);
```

### 2. Implementation Checklist
- [x] Create `PlaylistModel` for grouping media.
- [x] Create `ScheduleModel` for time-slot management.
- [ ] Update `AutoDJService` to check for active schedules.
- [ ] Create API Routes for Admin UI to manage Playlists.
- [ ] Create API Routes for Admin UI to manage Schedules.
- [ ] Update Admin Dashboard UI with a "Schedules" tab.

---
**Status:** I have already created the `PlaylistModel` and `ScheduleModel`. I am now ready to update the `AutoDJService` once you've confirmed the tables are set up (or I can proceed with the code changes if you'd like me to finish the logic first).
