const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getRecordingsDir } = require('../config/database');
const RecordingModel = require('../models/recording');
const ffmpegService = require('./ffmpegService');
const ChannelModel = require('../models/channel');
const cloudinaryService = require('./cloudinaryService');

class RecordingService {
  constructor() {
    this.recordings = new Map();
  }

  startRecording(channelId) {
    if (!channelId) {
      throw new Error('Channel ID is required to start recording');
    }

    if (this.recordings.has(channelId)) {
      throw new Error('Recording already in progress for this channel');
    }

    const id = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    const recordingsDir = getRecordingsDir();

    const channelFolder = channelId;
    const dateDir = path.join(recordingsDir, channelFolder, today);

    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    const tempPath = path.join(dateDir, `${id}.webm`);
    const writeStream = fs.createWriteStream(tempPath);

    const recordingContext = {
      id,
      channelId,
      tempPath,
      writeStream,
      startTime: Date.now()
    };

    this.recordings.set(channelId, recordingContext);

    console.log('Recording started:', id, 'on channel:', channelId);
    return { id, channelId };
  }

  writeChunk(channelId, chunk) {
    const recording = this.recordings.get(channelId);
    if (!recording || !recording.writeStream) {
      return;
    }

    try {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      recording.writeStream.write(buffer);
    } catch (error) {
      console.error(`Error writing recording chunk for channel ${channelId}:`, error.message);
    }
  }

  async stopRecording(channelId) {
    const recordingContext = this.recordings.get(channelId);
    if (!recordingContext) {
      throw new Error('No recording in progress for this channel');
    }

    // Immediately remove from map so new recording can't conflict while finalizing
    this.recordings.delete(channelId);

    const { id, tempPath, startTime, writeStream } = recordingContext;
    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`Stopping recording ${id} on channel ${channelId}. Finalizing file...`);

    // Wait for the stream to finish properly
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', (err) => {
        console.error(`WriteStream error during stop for channel ${channelId}:`, err);
        reject(err);
      });
      writeStream.end();
    });

    const today = new Date().toISOString().split('T')[0];
    const recordingsDir = getRecordingsDir();
    const dateDir = path.join(recordingsDir, channelId, today);
    const mp3Path = path.join(dateDir, `${id}.mp3`);

    try {
      console.log(`Converting ${tempPath} to MP3 (Normalized)...`);
      await ffmpegService.convertWebMToMp3(tempPath, mp3Path, true);

      if (!fs.existsSync(mp3Path)) {
        throw new Error('Conversion failed: Output file does not exist');
      }

      const stats = fs.statSync(mp3Path);
      const filesize = stats.size;

      if (filesize === 0) {
        throw new Error('Conversion failed: Output file is empty');
      }

      let cloudUrl = null;
      let cloudId = null;

      if (cloudinaryService.isEnabled()) {
        try {
          console.log(`Uploading ${id}.mp3 to Cloudinary...`);
          const fileBuffer = fs.readFileSync(mp3Path);
          const uploadResult = await cloudinaryService.uploadAudio(fileBuffer, `${id}.mp3`);
          cloudUrl = uploadResult.url;
          cloudId = uploadResult.publicId;
          console.log(`Cloudinary upload successful for channel ${channelId}: ${cloudUrl}`);
        } catch (cloudError) {
          console.error(`Cloudinary upload failed for channel ${channelId}, keeping local file:`, cloudError.message);
        }
      }

      const recording = {
        id,
        filename: `${id}.mp3`,
        filepath: cloudId || mp3Path,
        filesize,
        duration,
        channel_id: channelId,
        cloud_url: cloudUrl,
        created_at: new Date().toISOString()
      };

      await RecordingModel.create(recording);

      // Cleanup local files
      ffmpegService.deleteFile(tempPath);
      if (cloudUrl && fs.existsSync(mp3Path)) {
        ffmpegService.deleteFile(mp3Path);
      }

      console.log(`Recording finalized and saved for channel ${channelId}:`, cloudUrl || mp3Path);
      return recording;
    } catch (error) {
      console.error(`Error finalizing recording for channel ${channelId}:`, error.message);
      if (fs.existsSync(tempPath)) ffmpegService.deleteFile(tempPath);
      throw error;
    }
  }

  getCurrentRecording(channelId) {
    return this.recordings.get(channelId);
  }

  isRecording(channelId) {
    if (channelId) {
      return this.recordings.has(channelId);
    }
    return this.recordings.size > 0;
  }
}

module.exports = new RecordingService();
