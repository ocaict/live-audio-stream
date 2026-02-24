const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getRecordingsDir } = require('../config/database');
const RecordingModel = require('../models/recording');
const ffmpegService = require('./ffmpegService');
const ChannelModel = require('../models/channel');

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
    this.currentRecording.writeStream.write(chunk);
  }

  async stopRecording(channelId) {
    if (!this.currentRecording) {
      throw new Error('No recording in progress');
    }

    const { id, tempPath, startTime, channelId: recChannelId } = this.currentRecording;
    const duration = Math.round((Date.now() - startTime) / 1000);
    const actualChannelId = channelId || recChannelId;

    this.currentRecording.writeStream.end();
    this.currentRecording = null;

    const today = new Date().toISOString().split('T')[0];
    const recordingsDir = getRecordingsDir();
    const channelFolder = actualChannelId || 'default';
    const dateDir = path.join(recordingsDir, channelFolder, today);
    const mp3Path = path.join(dateDir, `${id}.mp3`);

    try {
      await ffmpegService.convertWebMToMp3(tempPath, mp3Path);
      ffmpegService.deleteFile(tempPath);

      const stats = fs.statSync(mp3Path);
      const filesize = stats.size;

      const recording = {
        id,
        filename: `${id}.mp3`,
        filepath: mp3Path,
        filesize,
        duration,
        channel_id: actualChannelId,
        created_at: new Date().toISOString()
      };

      RecordingModel.create(recording);
      console.log('Recording saved:', mp3Path);

      return recording;
    } catch (error) {
      console.error('Error converting recording:', error);
      ffmpegService.deleteFile(tempPath);
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
