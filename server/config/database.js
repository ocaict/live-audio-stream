const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const CONFIG = require('./constants');

let supabase = null;

async function initializeDatabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    console.error('CRITICAL: Supabase URL or Key not found in environment variables.');
    return;
  }

  try {
    supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    console.log('Supabase client initialized.');
  } catch (e) {
    console.error('Failed to initialize Supabase client:', e.message);
  }
}

function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase client is not initialized. Please check your environment variables (SUPABASE_URL, SUPABASE_KEY).');
  }
  return supabase;
}

function ensureRecordingsDirectory() {
  if (!fs.existsSync(CONFIG.RECORDINGS_DIR)) {
    fs.mkdirSync(CONFIG.RECORDINGS_DIR, { recursive: true });
  }
}

module.exports = {
  supabase: getSupabase, // Shorthand accessor
  initializeDatabase,
  ensureRecordingsDirectory,
  getRecordingsDir: () => CONFIG.RECORDINGS_DIR,
};
