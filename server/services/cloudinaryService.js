const { v2: cloudinary } = require('cloudinary');
const CONFIG = require('../config/constants');

let isConfigured = false;

function configureCloudinary() {
  if (CONFIG.CLOUDINARY_ENABLED && CONFIG.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: CONFIG.CLOUDINARY_CLOUD_NAME,
      api_key: CONFIG.CLOUDINARY_API_KEY,
      api_secret: CONFIG.CLOUDINARY_API_SECRET
    });
    isConfigured = true;
    console.log('Cloudinary configured for:', CONFIG.CLOUDINARY_CLOUD_NAME);
  }
}

async function uploadAudio(buffer, filename) {
  if (!isConfigured) {
    throw new Error('Cloudinary not configured');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        folder: CONFIG.CLOUDINARY_FOLDER,
        public_id: filename.replace(/\.[^/.]+$/, ''),
        format: filename.split('.').pop()
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            size: result.bytes
          });
        }
      }
    );

    uploadStream.end(buffer);
  });
}

async function deleteAudio(publicId) {
  if (!isConfigured) {
    throw new Error('Cloudinary not configured');
  }

  return new Promise((resolve, reject) => {
    // Audio files are usually 'video' resource type in Cloudinary
    cloudinary.uploader.destroy(publicId, { resource_type: 'video' }, (error, result) => {
      if (error) {
        console.error('Cloudinary destroy error:', error);
        reject(error);
      } else {
        console.log('Cloudinary destroy result:', result);
        resolve(result);
      }
    });
  });
}

function isEnabled() {
  return isConfigured;
}

configureCloudinary();

module.exports = {
  uploadAudio,
  deleteAudio,
  isEnabled,
  configureCloudinary
};
