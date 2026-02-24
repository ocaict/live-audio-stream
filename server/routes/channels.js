const express = require('express');
const router = express.Router();
const channelController = require('../controllers/channelController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', channelController.list);
router.get('/:id', channelController.getById);
router.get('/slug/:slug', channelController.getBySlug);

router.post('/', authenticateToken, channelController.create);
router.put('/:id', authenticateToken, channelController.update);
router.delete('/:id', authenticateToken, channelController.delete);

router.get('/my/channels', authenticateToken, channelController.listMyChannels);

module.exports = router;
