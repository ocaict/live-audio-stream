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

  // Cloudinary Configuration
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  CLOUDINARY_ENABLED: process.env.CLOUDINARY_ENABLED === 'true',
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER || 'radio-recordings',
};

module.exports = CONFIG;
