const ChannelModel = require('../models/channel');
const webrtcService = require('../services/webrtcService');

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 50);
}

const channelController = {
  async list(req, res) {
    try {
      const channels = await ChannelModel.findAll();
      const channelsWithStatus = channels.map(ch => ({
        ...ch,
        isLive: webrtcService.isChannelLive(ch.id),
        listenerCount: webrtcService.getChannelListenerCount(ch.id)
      }));
      res.json(channelsWithStatus);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getById(req, res) {
    try {
      const channel = await ChannelModel.findById(req.params.id);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      channel.isLive = webrtcService.isChannelLive(channel.id);
      channel.listenerCount = webrtcService.getChannelListenerCount(channel.id);
      res.json(channel);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getBySlug(req, res) {
    try {
      const channel = await ChannelModel.findBySlug(req.params.slug);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      channel.isLive = webrtcService.isChannelLive(channel.id);
      channel.listenerCount = webrtcService.getChannelListenerCount(channel.id);
      res.json(channel);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async listMyChannels(req, res) {
    try {
      const channels = await ChannelModel.findByAdminId(req.user.id);
      const channelsWithStatus = channels.map(ch => ({
        ...ch,
        isLive: webrtcService.isChannelLive(ch.id),
        listenerCount: webrtcService.getChannelListenerCount(ch.id)
      }));
      res.json(channelsWithStatus);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async create(req, res) {
    try {
      const { name, description, color } = req.body;

      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Channel name is required (min 2 characters)' });
      }

      const slug = generateSlug(name);
      const existingChannel = await ChannelModel.findBySlug(slug);
      if (existingChannel) {
        return res.status(400).json({ error: 'Channel with similar name already exists' });
      }

      const channel = await ChannelModel.create({
        name: name.trim(),
        slug,
        description: description || '',
        adminId: req.user.id,
        color: color || '#e94560'
      });

      res.status(201).json(channel);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async update(req, res) {
    try {
      const channel = await ChannelModel.findById(req.params.id);

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      if (channel.admin_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to update this channel' });
      }

      const { name, description, color } = req.body;
      const updates = {};

      if (name) {
        const newSlug = generateSlug(name);
        const existing = await ChannelModel.findBySlug(newSlug);
        if (existing && existing.id !== channel.id) {
          return res.status(400).json({ error: 'Channel with similar name already exists' });
        }
        updates.slug = newSlug;
        updates.name = name.trim();
      }
      if (description !== undefined) updates.description = description;
      if (color) updates.color = color;

      const updated = await ChannelModel.update(channel.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async delete(req, res) {
    try {
      const channel = await ChannelModel.findById(req.params.id);

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      if (channel.admin_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to delete this channel' });
      }

      if (webrtcService.isChannelLive(channel.id)) {
        return res.status(400).json({ error: 'Cannot delete channel while live. Stop broadcast first.' });
      }

      await ChannelModel.delete(channel.id);
      res.json({ message: 'Channel deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = channelController;
