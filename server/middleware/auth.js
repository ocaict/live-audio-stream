const AuthService = require('../services/authService');
const ChannelModel = require('../models/channel');
const RecordingModel = require('../models/recording');

const authenticateToken = (req, res, next) => {
  let token = req.cookies?.token;

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = AuthService.verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireChannelOwnership = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  // Admins bypass ownership checks
  if (req.user.role === 'admin') return next();

  const channelId = req.params.id || req.body.channelId || req.query.channelId || req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  try {
    const channel = await ChannelModel.findById(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    if (String(channel.admin_id) !== String(req.user.id)) {
      console.warn(`[AUTH] User ${req.user.id} attempted to access restricted channel ${channelId}`);
      return res.status(403).json({ error: 'Access denied: You do not own this channel' });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Ownership verification failed' });
  }
};

const requireRecordingOwnership = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  if (req.user.role === 'admin') return next();

  const recordingId = req.params.id;
  if (!recordingId) return res.status(400).json({ error: 'Recording ID required' });

  try {
    const recording = await RecordingModel.findById(recordingId);
    if (!recording) return res.status(404).json({ error: 'Recording not found' });

    if (!recording.channel_id) {
      return res.status(403).json({ error: 'Access denied: Orphaned recording' });
    }

    const channel = await ChannelModel.findById(recording.channel_id);
    if (!channel) return res.status(404).json({ error: 'Associated channel not found' });

    if (String(channel.admin_id) !== String(req.user.id)) {
      console.warn(`[AUTH] User ${req.user.id} attempted to access restricted recording ${recordingId}`);
      return res.status(403).json({ error: 'Access denied: You do not own the channel for this recording' });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Recording ownership verification failed' });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireChannelOwnership,
  requireRecordingOwnership
};
