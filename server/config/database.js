const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const CONFIG = require('./constants');

let supabase = null;

async function initializeDatabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    console.warn('⚠️ Supabase URL or Key not found in environment variables.');
    return;
  }

  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  console.log('Supabase client initialized.');
}

function getSupabase() {
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
