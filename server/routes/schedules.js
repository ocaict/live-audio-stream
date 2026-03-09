const express = require('express');
const router = express.Router();
const ScheduleModel = require('../models/schedule');
const { authenticateToken } = require('../middleware/auth');

// Get all schedules for a channel (Public)
router.get('/channel/:channelId', async (req, res) => {
    try {
        const schedules = await ScheduleModel.findByChannelId(req.params.channelId);
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin/Moderator routes below are protected
router.use(authenticateToken);

// Create a new schedule slot
router.post('/', async (req, res) => {
    try {
        const { channelId, playlistId, dayOfWeek, startTime, endTime } = req.body;
        const schedule = await ScheduleModel.create({
            channel_id: channelId,
            playlist_id: playlistId,
            day_of_week: dayOfWeek,
            start_time: startTime,
            end_time: endTime
        });
        res.status(201).json(schedule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update or disable a schedule
router.put('/:id', async (req, res) => {
    try {
        const schedule = await ScheduleModel.update(req.params.id, req.body);
        res.json({ success: true, schedule });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a schedule slot
router.delete('/:id', async (req, res) => {
    try {
        await ScheduleModel.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
