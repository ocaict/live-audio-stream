const { supabase: getSupabase } = require('../config/database');

const PlaylistModel = {
    async create(playlist) {
        const { data, error } = await getSupabase()
            .from('playlists')
            .insert([{
                id: playlist.id || require('uuid').v4(),
                channel_id: playlist.channel_id,
                name: playlist.name,
                description: playlist.description || '',
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating playlist:', error);
            throw error;
        }
        return data;
    },

    async findByChannelId(channelId) {
        const { data, error } = await getSupabase()
            .from('playlists')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error(`Error fetching playlists for channel ${channelId}:`, error);
            return [];
        }
        return data || [];
    },

    async findById(id) {
        const { data, error } = await getSupabase()
            .from('playlists')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.error(`Error finding playlist ${id}:`, error);
            return null;
        }
        return data;
    },

    async delete(id) {
        const { error } = await getSupabase()
            .from('playlists')
            .delete()
            .eq('id', id);

        if (error) {
            console.error(`Error deleting playlist ${id}:`, error);
            throw error;
        }
    },

    // --- Playlist Items Mangement ---

    async addMedia(playlistId, mediaId, position = 0) {
        const { error } = await getSupabase()
            .from('playlist_media')
            .insert([{
                playlist_id: playlistId,
                media_id: mediaId,
                position: position
            }]);

        if (error) {
            console.error(`Error adding media ${mediaId} to playlist ${playlistId}:`, error);
            throw error;
        }
    },

    async getMedia(playlistId) {
        const { data, error } = await getSupabase()
            .from('playlist_media')
            .select(`
                position,
                media_library:media_id (*)
            `)
            .eq('playlist_id', playlistId)
            .order('position', { ascending: true });

        if (error) {
            console.error(`Error fetching media for playlist ${playlistId}:`, error);
            return [];
        }
        return data || [];
    },

    async clearMedia(playlistId) {
        const { error } = await getSupabase()
            .from('playlist_media')
            .delete()
            .eq('playlist_id', playlistId);

        if (error) {
            console.error(`Error clearing media for playlist ${playlistId}:`, error);
            throw error;
        }
    },

    async updateItems(playlistId, mediaIds) {
        // Atomic update: clear and re-insert
        await this.clearMedia(playlistId);

        if (mediaIds.length === 0) return;

        const items = mediaIds.map((id, index) => ({
            playlist_id: playlistId,
            media_id: id,
            position: index
        }));

        const { error } = await getSupabase()
            .from('playlist_media')
            .insert(items);

        if (error) {
            console.error(`Error updating items for playlist ${playlistId}:`, error);
            throw error;
        }
    }
};

module.exports = PlaylistModel;
