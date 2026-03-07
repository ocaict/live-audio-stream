const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const RecordingModel = require('../models/recording');
const { getRecordingsDir } = require('../config/database');
const cloudinaryService = require('../services/cloudinaryService');
const CONFIG = require('../config/constants');

const recordingController = {
  list(req, res) {
    try {
      const recordings = RecordingModel.findAll();
      res.json(recordings);
    } catch (error) {
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
        cloudUrl,
        filesize,
        duration: 0,
        created_at: new Date().toISOString()
      };

      RecordingModel.create(recording);
      res.json({ id, filename, filesize, url: cloudUrl });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  stream(req, res) {
    try {
      const { id } = req.params;
      const recording = RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      // If cloud URL exists, redirect to it
      if (recording.cloudUrl) {
        return res.redirect(recording.cloudUrl);
      }

      const filePath = recording.filepath;
      if (!fs.existsSync(filePath)) {
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

  download(req, res) {
    try {
      const { id } = req.params;
      const recording = RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      // If cloud URL exists, redirect to it
      if (recording.cloudUrl) {
        return res.redirect(recording.cloudUrl);
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

  delete(req, res) {
    try {
      const { id } = req.params;
      const recording = RecordingModel.findById(id);

      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }

      // Delete from Cloudinary if was uploaded there
      if (recording.cloudUrl && cloudinaryService.isEnabled()) {
        // Cloudinary deletion would require additional SDK call
        console.log('Recording was on Cloudinary:', recording.cloudUrl);
      }

      // Delete local file if exists
      if (recording.filepath && !recording.cloudUrl && fs.existsSync(recording.filepath)) {
        fs.unlinkSync(recording.filepath);
      }

      RecordingModel.delete(id);
      res.json({ message: 'Recording deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getLatest(req, res) {
    try {
      const recording = RecordingModel.findLatest();
      if (!recording) {
        return res.status(404).json({ error: 'No recordings found' });
      }
      res.json(recording);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getLatestByChannel(req, res) {
    try {
      const { channelId } = req.params;
      const recording = RecordingModel.findLatestByChannelId(channelId);
      if (!recording) {
        return res.status(404).json({ error: 'No recordings found for this channel' });
      }
      res.json(recording);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = recordingController;
