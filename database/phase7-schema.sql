-- Phase 7: Media Library & Auto-DJ System

-- Create the custom media table
CREATE TABLE IF NOT EXISTS public.media_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('music', 'show', 'jingle', 'ad')),
  filename TEXT NOT NULL,
  cloud_url TEXT NOT NULL,
  filesize BIGINT,
  duration INT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: Applying similar permissions to the existing system.
-- If you need Row Level Security (RLS) enabled, run the lines below.
-- However, since RLS was previously disabled on users to ease login, 
-- we will explicitly disable RLS on this table as well to prevent permission errors.

ALTER TABLE public.media_library DISABLE ROW LEVEL SECURITY;
