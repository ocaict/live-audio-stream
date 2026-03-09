const { supabase: getSupabase } = require('../config/database');

const MessageModel = {
    async create(message) {
        const { data, error } = await getSupabase()
            .from('messages')
            .insert([{
                channel_id: message.channel_id,
                username: message.username,
                content: message.content
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating message:', error);
            throw error;
        }
        return data;
    },

    async findByChannelId(channelId, limit = 50) {
        const { data, error } = await getSupabase()
            .from('messages')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error(`Error fetching messages for channel ${channelId}:`, error);
            return [];
        }
        return (data || []).reverse(); // Oldest first for chat UI
    },

    async deleteByChannelId(channelId) {
        const { error } = await getSupabase()
            .from('messages')
            .delete()
            .eq('channel_id', channelId);

        if (error) {
            console.error(`Error deleting messages for channel ${channelId}:`, error);
            throw error;
        }
    },

    async deleteById(messageId) {
        const { error } = await getSupabase()
            .from('messages')
            .delete()
            .eq('id', messageId);

        if (error) {
            console.error(`Error deleting message ${messageId}:`, error);
            throw error;
        }
    }
};

module.exports = MessageModel;
