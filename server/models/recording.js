const { supabase: getSupabase } = require('../config/database');

const RecordingModel = {
  async create(recording) {
    const { error } = await getSupabase()
      .from('recordings')
      .insert([{
        id: recording.id,
        filename: recording.filename,
        filepath: recording.filepath,
        filesize: recording.filesize,
        duration: recording.duration,
        channel_id: recording.channel_id || null,
        cloud_url: recording.cloud_url || null,
        created_at: recording.created_at || new Date().toISOString()
      }]);

    if (error) {
      console.error('Error creating recording:', error);
      throw error;
    }
  },

  async findAll() {
    const { data, error } = await getSupabase()
      .from('recordings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching recordings:', error);
      return [];
    }
    return data || [];
  },

  async findByChannelId(channelId) {
    const { data, error } = await getSupabase()
      .from('recordings')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`Error fetching recordings for channel ${channelId}:`, error);
      return [];
    }
    return data || [];
  },

  async findLatestByChannelId(channelId) {
    // Try channel specific first
    const { data, error } = await getSupabase()
      .from('recordings')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!error && data) return data;

    // Fallback to any latest
    return this.findLatest();
  },

  async findLatest() {
    const { data, error } = await getSupabase()
      .from('recordings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Error fetching latest recording:', error);
      return null;
    }
    return data;
  },

  async findById(id) {
    const { data, error } = await getSupabase()
      .from('recordings')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error(`Error finding recording ${id}:`, error);
      return null;
    }
    return data;
  },

  async delete(id) {
    const { error } = await getSupabase()
      .from('recordings')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`Error deleting recording ${id}:`, error);
      throw error;
    }
  },

  async updateFilesize(id, filesize) {
    const { error } = await getSupabase()
      .from('recordings')
      .update({ filesize })
      .eq('id', id);

    if (error) {
      console.error(`Error updating filesize for recording ${id}:`, error);
      throw error;
    }
  },

  async updateDuration(id, duration) {
    const { error } = await getSupabase()
      .from('recordings')
      .update({ duration })
      .eq('id', id);

    if (error) {
      console.error(`Error updating duration for recording ${id}:`, error);
      throw error;
    }
  }
};

module.exports = RecordingModel;
