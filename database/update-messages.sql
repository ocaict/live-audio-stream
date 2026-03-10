-- Run this SQL in your Supabase SQL Editor to support the new chat features
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
