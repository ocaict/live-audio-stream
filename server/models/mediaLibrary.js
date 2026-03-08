const { supabase: getSupabase } = require('../config/database');

const MediaLibraryModel = {
    async create(media) {
        const { error } = await getSupabase()
            .from('media_library')
            .insert([{
                id: media.id,
                channel_id: media.channel_id,
                title: media.title,
                category: media.category,
                filename: media.filename,
                cloud_url: media.cloud_url,
                filesize: media.filesize,
                duration: media.duration || 0,
                tags: media.tags || [],
                created_at: new Date().toISOString()
            }]);

        if (error) {
            console.error('Error creating custom media:', error);
            throw error;
        }
    },

    async findByChannelId(channelId) {
        const { data, error } = await getSupabase()
            .from('media_library')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error(`Error fetching custom media for channel ${channelId}:`, error);
            return [];
        }
        return data || [];
    },

    async findById(id) {
        const { data, error } = await getSupabase()
            .from('media_library')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.error(`Error finding custom media ${id}:`, error);
            return null;
        }
        return data;
    },

    async delete(id) {
        const { error } = await getSupabase()
            .from('media_library')
            .delete()
            .eq('id', id);

        if (error) {
            console.error(`Error deleting custom media ${id}:`, error);
            throw error;
        }
    },

    async updateMetadata(id, updates) {
        const { error } = await getSupabase()
            .from('media_library')
            .update(updates)
            .eq('id', id);

        if (error) {
            console.error(`Error updating custom media ${id}:`, error);
            throw error;
        }
    }
};

module.exports = MediaLibraryModel;
