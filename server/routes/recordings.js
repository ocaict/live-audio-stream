const express = require('express');
const router = express.Router();
const recordingController = require('../controllers/recordingController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.get('/', authenticateToken, requireAdmin, recordingController.list);
router.post('/upload', authenticateToken, requireAdmin, recordingController.upload);
router.get('/:id/stream', recordingController.stream);
router.get('/:id/download', authenticateToken, requireAdmin, recordingController.download);
router.delete('/:id', authenticateToken, requireAdmin, recordingController.delete);

module.exports = router;
