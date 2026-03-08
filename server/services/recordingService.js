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
    this.currentRecording = null;
    this.tempFile = null;
  }

  startRecording(channelId) {
    if (this.currentRecording) {
      throw new Error('Recording already in progress');
    }

    const id = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    const recordingsDir = getRecordingsDir();

    const channelFolder = channelId || 'default';
    const dateDir = path.join(recordingsDir, channelFolder, today);

    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    const tempPath = path.join(dateDir, `${id}.webm`);
    const writeStream = fs.createWriteStream(tempPath);

    this.currentRecording = {
      id,
      channelId,
      tempPath,
      writeStream,
      startTime: Date.now()
    };

    console.log('Recording started:', id, 'on channel:', channelId);
    return { id, channelId };
  }

  writeChunk(chunk) {
    if (!this.currentRecording || !this.currentRecording.writeStream) {
      return;
    }

    try {
      // Ensure chunk is a buffer
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.currentRecording.writeStream.write(buffer);
    } catch (error) {
      console.error('Error writing recording chunk:', error.message);
    }
  }

  async stopRecording(channelId) {
    if (!this.currentRecording) {
      throw new Error('No recording in progress');
    }

    const { id, tempPath, startTime, channelId: recChannelId, writeStream } = this.currentRecording;
    const duration = Math.round((Date.now() - startTime) / 1000);
    const actualChannelId = channelId || recChannelId;

    console.log(`Stopping recording ${id}. Finalizing file...`);

    // Wait for the stream to finish properly
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', (err) => {
        console.error('WriteStream error during stop:', err);
        reject(err);
      });
      writeStream.end();
    });

    this.currentRecording = null;

    const today = new Date().toISOString().split('T')[0];
    const recordingsDir = getRecordingsDir();
    const channelFolder = actualChannelId || 'default';
    const dateDir = path.join(recordingsDir, channelFolder, today);
    const mp3Path = path.join(dateDir, `${id}.mp3`);

    try {
      console.log(`Converting ${tempPath} to MP3...`);
      await ffmpegService.convertWebMToMp3(tempPath, mp3Path);

      // Verification: Check if file exists and has content
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

      // Upload to Cloudinary if enabled
      if (cloudinaryService.isEnabled()) {
        try {
          console.log(`Uploading ${id}.mp3 to Cloudinary...`);
          const fileBuffer = fs.readFileSync(mp3Path);
          const uploadResult = await cloudinaryService.uploadAudio(fileBuffer, `${id}.mp3`);
          cloudUrl = uploadResult.url;
          cloudId = uploadResult.publicId;
          console.log(`Cloudinary upload successful: ${cloudUrl}`);
        } catch (cloudError) {
          console.error('Cloudinary upload failed, keeping local file:', cloudError.message);
        }
      }

      const recording = {
        id,
        filename: `${id}.mp3`,
        filepath: cloudId || mp3Path, // Use cloudId as filepath for cloud recordings
        filesize,
        duration,
        channel_id: actualChannelId,
        cloud_url: cloudUrl,
        created_at: new Date().toISOString()
      };

      await RecordingModel.create(recording);

      // Cleanup
      ffmpegService.deleteFile(tempPath);

      // If we have a cloud URL, we could theoretically delete the local MP3, 
      // but let's keep it for now as a local cache/fallback unless storage is an issue.
      // On Render free tier, it will be deleted anyway on restart.

      console.log('Recording finalized and saved:', cloudUrl || mp3Path);
      return recording;
    } catch (error) {
      console.error('Error finalizing recording:', error.message);
      // Attempt cleanup even on failure
      if (fs.existsSync(tempPath)) ffmpegService.deleteFile(tempPath);
      throw error;
    }
  }

  getCurrentRecording() {
    return this.currentRecording;
  }

  isRecording() {
    return !!this.currentRecording;
  }
}

module.exports = new RecordingService();
