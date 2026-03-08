const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireBroadcasterOrAdmin } = require('../middleware/auth');
const mediaController = require('../controllers/mediaController');

// Configure multer for memory storage 
// because we upload directly to Cloudinary from the buffer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit for custom media
    }
});

// Require auth for all media management
router.use(requireBroadcasterOrAdmin);

router.get('/', mediaController.list);
router.post('/upload', upload.single('mediaFile'), mediaController.upload);
router.patch('/:id/metadata', mediaController.update);
router.delete('/:id', mediaController.delete);

module.exports = router;
