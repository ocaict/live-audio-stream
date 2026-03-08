const express = require('express');
const router = express.Router();
const recordingController = require('../controllers/recordingController');
const { authenticateToken, requireAdmin, requireChannelOwnership, requireRecordingOwnership } = require('../middleware/auth');
const { recordingIdValidation } = require('../middleware/validation');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const uploadValidation = (req, res, next) => {
  const contentType = req.headers['content-type'];
  const allowedTypes = ['audio/wav', 'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/flac'];

  if (!contentType) {
    return res.status(400).json({ error: 'Content-Type header required' });
  }

  if (!allowedTypes.includes(contentType.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid content type. Allowed: audio/wav, audio/webm, audio/mpeg, audio/mp3, audio/ogg, audio/flac' });
  }

  const contentLength = parseInt(req.headers['content-length'], 10);
  if (contentLength > MAX_FILE_SIZE) {
    return res.status(400).json({ error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` });
  }

  next();
};

router.get('/', authenticateToken, recordingController.list);
router.post('/upload', authenticateToken, (req, res, next) => {
  req.channelId = req.headers['x-channel-id'];
  if (!req.channelId) return res.status(400).json({ error: 'X-Channel-Id header required' });
  next();
}, requireChannelOwnership, uploadValidation, recordingController.upload);
router.get('/latest/:channelId', recordingController.getLatestByChannel);
router.get('/latest', recordingController.getLatest);
router.get('/:id/stream', recordingIdValidation, recordingController.stream);
router.get('/:id/download', authenticateToken, requireRecordingOwnership, recordingIdValidation, recordingController.download);
router.delete('/:id', authenticateToken, requireRecordingOwnership, recordingIdValidation, recordingController.delete);

module.exports = router;
