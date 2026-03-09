const { v4: uuidv4 } = require('uuid');
const MediaLibraryModel = require('../models/mediaLibrary');
const cloudinaryService = require('../services/cloudinaryService');
const ChannelModel = require('../models/channel');

const mediaController = {
    async list(req, res) {
        try {
            const channelId = req.query.channelId;
            if (!channelId) {
                return res.status(400).json({ error: 'channelId is required' });
            }

            const myChannels = await ChannelModel.findByAdminId(req.user.id);
            if (!myChannels.some(c => c.id === channelId)) {
                return res.status(403).json({ error: 'Not authorized for this channel' });
            }

            const media = await MediaLibraryModel.findByChannelId(channelId);
            res.json(media);
        } catch (error) {
            console.error('Error listing media:', error);
            res.status(500).json({ error: error.message });
        }
    },

    async upload(req, res) {
        try {
            const channelId = req.body.channelId;
            if (!channelId) {
                return res.status(400).json({ error: 'channelId is required' });
            }

            const myChannels = await ChannelModel.findByAdminId(req.user.id);
            if (!myChannels.some(c => c.id === channelId)) {
                return res.status(403).json({ error: 'Not authorized for this channel' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            if (!cloudinaryService.isEnabled()) {
                return res.status(500).json({ error: 'Cloudinary must be enabled for Media Library uploads' });
            }

            const id = uuidv4();
            const filename = req.file.originalname.replace(/\s+/g, '_');
            const title = req.body.title || filename;
            const category = req.body.category || 'music';

            console.log(`Uploading custom media (${category}) to Cloudinary: ${filename}`);

            // Upload to cloudinary
            const result = await cloudinaryService.uploadAudio(req.file.buffer, `${id}_${filename}`);
            const cloudUrl = result.url;
            const filesize = req.file.size;

            const media = {
                id,
                channel_id: channelId,
                title,
                category,
                filename,
                cloud_url: cloudUrl,
                filesize,
                duration: 0,
                tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
            };

            await MediaLibraryModel.create(media);
            res.json(media);
        } catch (error) {
            console.error('Media upload error:', error);
            res.status(500).json({ error: error.message });
        }
    },

    async delete(req, res) {
        try {
            const { id } = req.params;
            const mediaItem = await MediaLibraryModel.findById(id);

            if (!mediaItem) {
                return res.status(404).json({ error: 'Media not found' });
            }

            // Verify channel ownership
            const myChannels = await ChannelModel.findByAdminId(req.user.id);
            if (!myChannels.some(c => c.id === mediaItem.channel_id)) {
                return res.status(403).json({ error: 'Not authorized to delete this media' });
            }

            // Delete from cloudinary if possible
            if (cloudinaryService.isEnabled() && mediaItem.cloud_url) {
                try {
                    const publicId = mediaItem.cloud_url.split('/').pop().split('.')[0];
                    await cloudinaryService.deleteAudio(publicId);
                    console.log(`Deleted media ${publicId} from Cloudinary`);
                } catch (e) {
                    console.error("Failed to delete from cloudinary, proceeding with DB deletion", e);
                }
            }

            await MediaLibraryModel.delete(id);
            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting media:', error);
            res.status(500).json({ error: error.message });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { title, category, tags } = req.body;

            const mediaItem = await MediaLibraryModel.findById(id);
            if (!mediaItem) {
                return res.status(404).json({ error: 'Media not found' });
            }

            // Verify channel ownership
            const myChannels = await ChannelModel.findByAdminId(req.user.id);
            if (!myChannels.some(c => c.id === mediaItem.channel_id)) {
                return res.status(403).json({ error: 'Not authorized to edit this media' });
            }

            await MediaLibraryModel.updateMetadata(id, {
                title: title || mediaItem.title,
                category: category || mediaItem.category,
                tags: Array.isArray(tags) ? tags : mediaItem.tags,
                updated_at: new Date().toISOString()
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Error updating media:', error);
            res.status(500).json({ error: error.message });
        }
    },

    async reorder(req, res) {
        try {
            const { channelId, orderedIds } = req.body;
            if (!channelId || !Array.isArray(orderedIds)) {
                return res.status(400).json({ error: 'channelId and orderedIds array are required' });
            }

            // Verify channel ownership
            const myChannels = await ChannelModel.findByAdminId(req.user.id);
            if (!myChannels.some(c => c.id === channelId)) {
                return res.status(403).json({ error: 'Not authorized for this channel' });
            }

            // Since MediaLibraryModel.findByChannelId orders by created_at DESC,
            // we assign the most recent timestamp to the first item (index 0).
            const now = Date.now();
            const promises = orderedIds.map((id, index) => {
                const artificialDate = new Date(now - (index * 1000)).toISOString();
                return MediaLibraryModel.updateMetadata(id, { created_at: artificialDate });
            });

            await Promise.all(promises);

            res.json({ success: true });
        } catch (error) {
            console.error('Error reordering media:', error);
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = mediaController;
