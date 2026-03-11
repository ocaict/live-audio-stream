require('dotenv').config();

const path = require('path');

const CONFIG = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',

  RECORDINGS_DIR: path.resolve(process.cwd(), process.env.RECORDINGS_DIR || 'recordings'),
  MAX_RECORDING_SIZE_MB: parseInt(process.env.MAX_RECORDING_SIZE_MB) || 500,

  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',

  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,

  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  API_ONLY: process.env.API_ONLY === 'true',
  FRONTEND_URL: process.env.FRONTEND_URL || '',

  // WebRTC Configuration
  ICE_SERVERS: process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : [
    {
      urls: "stun:stun.relay.metered.ca:80"
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "34c4ada2a6750249005f4c44",
      credential: "Mla96sBIVmDrZFSX"
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "34c4ada2a6750249005f4c44",
      credential: "Mla96sBIVmDrZFSX"
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "34c4ada2a6750249005f4c44",
      credential: "Mla96sBIVmDrZFSX"
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "34c4ada2a6750249005f4c44",
      credential: "Mla96sBIVmDrZFSX"
    }
  ],

  // Cloudinary Configuration
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  CLOUDINARY_ENABLED: process.env.CLOUDINARY_ENABLED === 'true',
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER || 'radio-recordings',

  // Supabase Configuration
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',
  METERED_API_KEY: process.env.METERED_API_KEY || '',
  METERED_APP_NAME: process.env.METERED_APP_NAME || 'ocatech-live',
};

CONFIG.validate = () => {
  const mandatory = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'JWT_SECRET'
  ];

  const missing = mandatory.filter(key => !process.env[key] && !CONFIG[key]);
  if (missing.length > 0) {
    console.error(`\n[FATAL] Missing mandatory environment variables: ${missing.join(', ')}`);
    if (CONFIG.NODE_ENV === 'production') process.exit(1);
  }

  if (CONFIG.NODE_ENV === 'production') {
    if (CONFIG.JWT_SECRET === 'change-me-in-production') {
      console.warn('[SECURITY] JWT_SECRET is using the default value. Change it immediately!');
    }
    if (CONFIG.ADMIN_USERNAME === 'admin' && CONFIG.ADMIN_PASSWORD === 'admin123') {
      console.warn('[SECURITY] Using default admin credentials (admin/admin123). This is highly discouraged!');
    }
    if (CONFIG.CORS_ORIGIN === '*') {
      console.warn('[SECURITY] CORS_ORIGIN is set to "*". In production, this should be restricted to your specific domain.');
    }
  }

  if (CONFIG.CLOUDINARY_ENABLED && (!CONFIG.CLOUDINARY_CLOUD_NAME || !CONFIG.CLOUDINARY_API_KEY)) {
    console.error('[FATAL] Cloudinary is enabled but credentials are missing.');
    if (CONFIG.NODE_ENV === 'production') process.exit(1);
  }

  console.log('[Config] Environment validation passed.');
};

module.exports = CONFIG;
