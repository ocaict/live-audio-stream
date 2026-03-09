const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const RecordingModel = require('../models/recording');
const ChannelModel = require('../models/channel');
const MediaLibraryModel = require('../models/mediaLibrary');
const { getRecordingsDir } = require('../config/database');
const cloudinaryService = require('../services/cloudinaryService');
const CONFIG = require('../config/constants');

const recordingController = {
  async list(req, res) {
    try {
      let recordings;
      if (req.user && req.user.role === 'admin') {
        console.log('Admin user requesting all recordings.');
        recordings = await RecordingModel.findAll();
      } else if (req.user) {
        // Broadcaster: only see recordings for their channels
        console.log(`User ${req.user.id} (role: ${req.user.role}) requesting recordings for their channels.`);
        const myChannels = await ChannelModel.findByAdminId(req.user.id);
        const channelIds = myChannels.map(c => c.id);
        console.log(`Found channels for user ${req.user.id}: ${channelIds}`);
        recordings = await RecordingModel.findByChannelIds(channelIds);
      } else {
        console.log('Unauthorized access attempt to list recordings.');
        return res.status(401).json({ error: 'Unauthorized' });
      }
      res.json(recordings);
    } catch (error) {
      console.error('Error listing recordings:', error);
      res.status(500).json({ error: error.message });
    }
  },

  async upload(req, res) {
    try {
      const id = uuidv4();
      const filename = `${id}.wav`;

      // Collect chunks
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      let filePath = '';
      let filesize = buffer.length;
      let cloudUrl = '';

      // Upload to Cloudinary if enabled
      if (cloudinaryService.isEnabled()) {
        try {
          console.log('Uploading to Cloudinary...');
          const result = await cloudinaryService.uploadAudio(buffer, filename);
          cloudUrl = result.url;
          filePath = result.publicId; // Store public_id for deletion
          console.log('Uploaded to Cloudinary:', cloudUrl);
        } catch (cloudError) {
          console.error('Cloudinary upload failed:', cloudError);
          // Fall back to local storage
          cloudUrl = '';
        }
      }

      // If Cloudinary failed or not enabled, save locally
      if (!cloudUrl) {
        const today = new Date().toISOString().split('T')[0];
        const recordingsDir = getRecordingsDir();
        const dateDir = path.join(recordingsDir, today);

        if (!fs.existsSync(dateDir)) {
          fs.mkdirSync(dateDir, { recursive: true });
        }

        filePath = path.join(dateDir, filename);
        fs.writeFileSync(filePath, buffer);
      }

      const recording = {
        id,
        filename,
        filepath: filePath,
        cloud_url: cloudUrl,
        filesize,
        duration: 0,
        channel_id: req.channelId || null,
        created_at: new Date().toISOString()
      };

      await RecordingModel.create(recording);
      res.json({ id, filename, filesize, url: cloudUrl });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  async stream(req, res) {
    try {
      const { id } = req.params;
      const recording = await RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      // If cloud URL exists, redirect to it
      if (recording.cloud_url) {
        return res.redirect(recording.cloud_url);
      }

      const filePath = recording.filepath;

      // Fallback: If it looks like a Cloudinary path but cloud_url is missing
      if (!recording.cloud_url && filePath.startsWith(CONFIG.CLOUDINARY_FOLDER)) {
        console.log('Detected Cloudinary path but missing cloud_url, constructing URL (raw)...');
        const cloudUrl = `https://res.cloudinary.com/${CONFIG.CLOUDINARY_CLOUD_NAME}/raw/upload/${filePath}`;
        return res.redirect(cloudUrl);
      }

      if (!fs.existsSync(filePath)) {
        console.error('File not found on disk:', filePath);
        return res.status(404).json({ error: 'File not found on disk' });
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      const contentType = filePath.endsWith('.wav') ? 'audio/wav' :
        filePath.endsWith('.webm') ? 'audio/webm' : 'audio/mpeg';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        res.writeHead(206, {
          'Content-Type': contentType,
          'Content-Length': chunksize,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes'
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes'
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async download(req, res) {
    try {
      const { id } = req.params;
      const recording = await RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      // If cloud URL exists, redirect to it
      if (recording.cloud_url) {
        return res.redirect(recording.cloud_url);
      }

      const filePath = recording.filepath;
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found on disk' });
      }

      res.download(filePath, recording.filename);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async delete(req, res) {
    try {
      const { id } = req.params;
      const recording = await RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      // Delete from Cloudinary if was uploaded there
      if (recording.cloud_url && cloudinaryService.isEnabled() && recording.filepath) {
        try {
          console.log('Deleting from Cloudinary:', recording.filepath);
          await cloudinaryService.deleteAudio(recording.filepath);
        } catch (cloudError) {
          console.error('Cloudinary deletion failed:', cloudError.message);
        }
      }

      // Delete local file if exists
      if (recording.filepath && !recording.cloud_url && fs.existsSync(recording.filepath)) {
        try {
          fs.unlinkSync(recording.filepath);
        } catch (localError) {
          console.error('Local file deletion failed:', localError.message);
        }
      }

      await RecordingModel.delete(id);
      res.json({ message: 'Recording deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async updateMetadata(req, res) {
    try {
      const { id } = req.params;
      const { title, description, tags } = req.body;

      // Extract only the fields we want to update
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : [];

      await RecordingModel.updateMetadata(id, updates);
      res.json({ message: 'Metadata updated successfully' });
    } catch (error) {
      console.error('[RecordingController] Error updating metadata:', error);
      res.status(500).json({ error: error.message });
    }
  },

  async getLatest(req, res) {
    try {
      const recording = await RecordingModel.findLatest();
      if (!recording) {
        return res.status(404).json({ error: 'No recordings found' });
      }
      res.json(recording);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getLatestByChannel(req, res) {
    try {
      const { channelId } = req.params;
      const recording = await RecordingModel.findLatestByChannelId(channelId);
      if (!recording) {
        return res.status(404).json({ error: 'No recordings found for this channel' });
      }
      res.json(recording);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async promoteToMedia(req, res) {
    try {
      const { id } = req.params;
      const recording = await RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      if (!recording.cloud_url) {
        return res.status(400).json({ error: 'Only recordings stored in the cloud can be promoted to the Auto-DJ rotation.' });
      }

      // Create a media item from the recording
      const newMedia = {
        id: uuidv4(),
        channel_id: recording.channel_id,
        title: recording.title || `Recording: ${recording.filename}`,
        category: 'show', // Default category for recordings
        filename: recording.filename,
        cloud_url: recording.cloud_url,
        filesize: recording.filesize,
        duration: recording.duration || 0,
        tags: recording.tags || []
      };

      await MediaLibraryModel.create(newMedia);
      res.json({ message: 'Recording successfully promoted to Auto-DJ rotation!', mediaId: newMedia.id });
    } catch (error) {
      console.error('[RecordingController] Promotion failed:', error);
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = recordingController;
