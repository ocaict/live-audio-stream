const express = require('express');
const router = express.Router();
const PlaylistModel = require('../models/playlist');
const { authenticateToken } = require('../middleware/auth');

// All routes here should be protected
router.use(authenticateToken);

// Get all playlists for a channel
router.get('/channel/:channelId', async (req, res) => {
    try {
        const playlists = await PlaylistModel.findByChannelId(req.params.channelId);
        res.json(playlists);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a new playlist
router.post('/', async (req, res) => {
    try {
        const { channelId, name, description } = req.body;
        const playlist = await PlaylistModel.create({ channel_id: channelId, name, description });
        res.status(201).json(playlist);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get playlist by ID (including items)
router.get('/:id', async (req, res) => {
    try {
        const playlist = await PlaylistModel.findById(req.params.id);
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

        const items = await PlaylistModel.getMedia(req.params.id);
        res.json({ ...playlist, items });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update playlist items (the core ordering logic)
router.put('/:id/items', async (req, res) => {
    try {
        const { mediaIds } = req.body; // Array of media IDs in order
        await PlaylistModel.updateItems(req.params.id, mediaIds);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a playlist
router.delete('/:id', async (req, res) => {
    try {
        await PlaylistModel.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
