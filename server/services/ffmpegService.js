const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/constants');

ffmpeg.setFfmpegPath(CONFIG.FFMPEG_PATH);

class FFmpegService {
  convertWebMToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(44100)
        .on('start', (commandLine) => {
          console.log('FFmpeg started:', commandLine);
        })
        .on('progress', (progress) => {
          console.log('Processing:', Math.round(progress.percent), '% done');
        })
        .on('end', () => {
          console.log('Conversion complete:', outputPath);
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(err);
        })
        .save(outputPath);
    });
  }

  async getDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(Math.round(metadata.format.duration || 0));
        }
      });
    });
  }

  deleteFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Deleted file:', filePath);
      }
    } catch (error) {
      console.error('Error deleting file:', error.message);
    }
  }
}

module.exports = new FFmpegService();
